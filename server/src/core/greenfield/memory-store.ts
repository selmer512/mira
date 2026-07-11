import fs from 'node:fs'
import path from 'node:path'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from 'node:crypto'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import type { IdentityContext, MemoryCandidate } from './contracts'
import {
  MEMORY_PURGE_CAPABILITY,
  type CreateMemoryCandidateInput,
  type CreateMemoryPurgePlanInput,
  type DecideMemoryCandidateInput,
  type DecideMemoryPurgePlanInput,
  type DurableMemoryRecord,
  type ExecuteMemoryPurgePlanInput,
  type MemoryCandidateChallenge,
  type MemoryCandidatePersistenceReceipt,
  type MemoryDecisionReceipt,
  type MemoryExportBundle,
  type MemoryPurgeApproval,
  type MemoryPurgePlan,
  type MemoryPurgeReceipt,
  type MemorySearchResult,
  type MemoryTimeScope,
  type StoredMemoryCandidate
} from './memory-contracts'
import { MEMORY_MIGRATIONS } from './memory-migrations'

const MEMORY_ENCRYPTION_INFO = Buffer.from('mira-greenfield-memory-v1')
const MEMORY_INDEX_INFO = Buffer.from('mira-greenfield-memory-index-v1')
const MAX_MEMORY_SCOPE = 100
const MAX_SEARCH_RESULTS = 20
const KEY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const REASON_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export interface EncryptedMemoryStoreConfig {
  enabled: boolean
  databasePath: string
  masterKeyBase64: string
  ownerLookupKeyBase64: string
  keyVersion: string
  candidateTtlSeconds: number
  purgePlanTtlSeconds: number
}

interface CandidateSecretPayload {
  ownerId: string
  title: string
  content: string
  sourceRefs: string[]
  observedAt: string
  validFrom: string | null
  validUntil: string | null
  retentionPolicy: string
  derivationLinks: string[]
  contradictionLinks: string[]
  supersessionLinks: string[]
}

interface CandidateRow {
  candidate_id: string
  stable_owner_hash: string
  trace_id: string
  memory_class: MemoryCandidate['memory_class']
  temporal_status: MemoryCandidate['temporal_status']
  privacy_zone: string
  confidence: number
  salience: number
  content_hash: string
  challenge_hash: string
  created_at: number
  expires_at: number
  encryption_key_id: string
  record_hash: string
  ciphertext: Uint8Array
  initialization_vector: Uint8Array
  authentication_tag: Uint8Array
}

interface MemorySecretPayload {
  ownerId: string
  title: string
  content: string
  sourceRefs: string[]
  retentionPolicy: string
  embeddingVersion: string | null
  derivedFrom: string[]
  contradicts: string[]
  supersedes: string[]
}

interface MemoryRow {
  memory_id: string
  stable_owner_hash: string
  memory_class: MemoryCandidate['memory_class']
  temporal_status: MemoryCandidate['temporal_status']
  privacy_zone: string
  confidence: number
  salience: number
  observed_at: number
  valid_from: number | null
  valid_until: number | null
  content_hash: string
  created_by_trace_id: string
  created_at: number
  modified_at: number
  encryption_key_id: string
  record_hash: string
  ciphertext: Uint8Array
  initialization_vector: Uint8Array
  authentication_tag: Uint8Array
}

interface PurgePlanSecretPayload {
  ownerId: string
  deviceId: string
  authSessionId: string
  memoryIds: string[]
  recordHashes: string[]
  reasonCode: string
  verificationCriteria: string[]
  rollbackLimitations: string[]
}

interface PurgePlanRow {
  plan_id: string
  action_id: string
  trace_id: string
  stable_owner_hash: string
  device_hash: string
  auth_session_hash: string
  scope_hash: string
  record_count: number
  reason_code: string
  challenge_hash: string
  created_at: number
  expires_at: number
  encryption_key_id: string
  plan_hash: string
  ciphertext: Uint8Array
  initialization_vector: Uint8Array
  authentication_tag: Uint8Array
}

type MemoryEventType =
  | 'candidate_created'
  | 'candidate_confirmed'
  | 'candidate_rejected'
  | 'candidate_rolled_back'
  | 'memory_created'
  | 'memory_searched'
  | 'purge_planned'
  | 'purge_approved'
  | 'purge_rejected'
  | 'purge_executed'
  | 'purge_failed'

interface MemoryEventChainVerification {
  valid: boolean
  eventCount: number
  issue: string | null
}

export class MemoryStoreError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'MemoryStoreError'
  }
}

function parseSeconds(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Number(value || fallback)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback
  }
  return parsed
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    )
  }
  return value
}

function canonicalHash(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)))
}

function decodeKey(value: string, variableName: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== 32) {
    throw new MemoryStoreError(
      'memory.key_invalid',
      `${variableName} must contain a base64-encoded 32-byte key.`,
      503
    )
  }
  return decoded
}

function deriveOwnerKey(masterKey: Buffer, ownerId: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      masterKey,
      Buffer.from(ownerId),
      MEMORY_ENCRYPTION_INFO,
      32
    )
  )
}

function deriveIndexKey(masterKey: Buffer, ownerId: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      masterKey,
      Buffer.from(ownerId),
      MEMORY_INDEX_INFO,
      32
    )
  )
}

function keyedIdentifier(key: Buffer, kind: string, value: string): string {
  return createHmac('sha256', key).update(`${kind}:${value}`).digest('hex')
}

function numberValue(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value)
}

function nullableNumberValue(value: unknown): number | null {
  return value == null ? null : numberValue(value)
}

function stringValue(value: unknown): string {
  return value == null ? '' : String(value)
}

function nullableStringValue(value: unknown): string | null {
  return value == null ? null : String(value)
}

function bytesValue(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value
  }
  throw new MemoryStoreError(
    'memory.storage_corrupt',
    'Encrypted memory storage contains an invalid binary value.',
    500
  )
}

function parseJsonArray(value: unknown): string[] {
  const parsed = JSON.parse(stringValue(value) || '[]') as unknown
  return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
}

function challengeMatches(provided: string, expectedHash: string): boolean {
  const providedHash = Buffer.from(sha256(provided), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return (
    providedHash.length === expected.length &&
    timingSafeEqual(providedHash, expected)
  )
}

function normalizeContent(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

function tokenize(value: string): string[] {
  const tokens = normalizeContent(value).match(/[\p{L}\p{N}]+/gu) || []
  return [...new Set(tokens.filter((token) => token.length >= 2))].slice(0, 128)
}

function clampLimit(value: number): number {
  if (!Number.isInteger(value)) return 10
  return Math.min(MAX_SEARCH_RESULTS, Math.max(1, value))
}

function timestampValue(value: string | null): number | null {
  if (value === null) return null
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new MemoryStoreError(
      'memory.timestamp_invalid',
      'Memory timestamps must use valid ISO 8601 date-time values.',
      400,
      value
    )
  }
  return parsed
}

function mapCandidateRow(row: Record<string, unknown>): CandidateRow {
  return {
    candidate_id: stringValue(row['candidate_id']),
    stable_owner_hash: stringValue(row['stable_owner_hash']),
    trace_id: stringValue(row['trace_id']),
    memory_class: stringValue(row['memory_class']) as MemoryCandidate['memory_class'],
    temporal_status: stringValue(row['temporal_status']) as MemoryCandidate['temporal_status'],
    privacy_zone: stringValue(row['privacy_zone']),
    confidence: numberValue(row['confidence']),
    salience: numberValue(row['salience']),
    content_hash: stringValue(row['content_hash']),
    challenge_hash: stringValue(row['challenge_hash']),
    created_at: numberValue(row['created_at']),
    expires_at: numberValue(row['expires_at']),
    encryption_key_id: stringValue(row['encryption_key_id']),
    record_hash: stringValue(row['record_hash']),
    ciphertext: bytesValue(row['ciphertext']),
    initialization_vector: bytesValue(row['initialization_vector']),
    authentication_tag: bytesValue(row['authentication_tag'])
  }
}

function mapMemoryRow(row: Record<string, unknown>): MemoryRow {
  return {
    memory_id: stringValue(row['memory_id']),
    stable_owner_hash: stringValue(row['stable_owner_hash']),
    memory_class: stringValue(row['memory_class']) as MemoryCandidate['memory_class'],
    temporal_status: stringValue(row['temporal_status']) as MemoryCandidate['temporal_status'],
    privacy_zone: stringValue(row['privacy_zone']),
    confidence: numberValue(row['confidence']),
    salience: numberValue(row['salience']),
    observed_at: numberValue(row['observed_at']),
    valid_from: nullableNumberValue(row['valid_from']),
    valid_until: nullableNumberValue(row['valid_until']),
    content_hash: stringValue(row['content_hash']),
    created_by_trace_id: stringValue(row['created_by_trace_id']),
    created_at: numberValue(row['created_at']),
    modified_at: numberValue(row['modified_at']),
    encryption_key_id: stringValue(row['encryption_key_id']),
    record_hash: stringValue(row['record_hash']),
    ciphertext: bytesValue(row['ciphertext']),
    initialization_vector: bytesValue(row['initialization_vector']),
    authentication_tag: bytesValue(row['authentication_tag'])
  }
}

function mapPurgePlanRow(row: Record<string, unknown>): PurgePlanRow {
  return {
    plan_id: stringValue(row['plan_id']),
    action_id: stringValue(row['action_id']),
    trace_id: stringValue(row['trace_id']),
    stable_owner_hash: stringValue(row['stable_owner_hash']),
    device_hash: stringValue(row['device_hash']),
    auth_session_hash: stringValue(row['auth_session_hash']),
    scope_hash: stringValue(row['scope_hash']),
    record_count: numberValue(row['record_count']),
    reason_code: stringValue(row['reason_code']),
    challenge_hash: stringValue(row['challenge_hash']),
    created_at: numberValue(row['created_at']),
    expires_at: numberValue(row['expires_at']),
    encryption_key_id: stringValue(row['encryption_key_id']),
    plan_hash: stringValue(row['plan_hash']),
    ciphertext: bytesValue(row['ciphertext']),
    initialization_vector: bytesValue(row['initialization_vector']),
    authentication_tag: bytesValue(row['authentication_tag'])
  }
}

function buildCandidateAAD(
  row: Omit<
    CandidateRow,
    | 'record_hash'
    | 'ciphertext'
    | 'initialization_vector'
    | 'authentication_tag'
  >
): Buffer {
  return Buffer.from(
    JSON.stringify({
      candidate_id: row.candidate_id,
      stable_owner_hash: row.stable_owner_hash,
      trace_id: row.trace_id,
      memory_class: row.memory_class,
      temporal_status: row.temporal_status,
      privacy_zone: row.privacy_zone,
      confidence: row.confidence,
      salience: row.salience,
      content_hash: row.content_hash,
      challenge_hash: row.challenge_hash,
      created_at: row.created_at,
      expires_at: row.expires_at,
      encryption_key_id: row.encryption_key_id
    })
  )
}

function buildMemoryAAD(
  row: Omit<
    MemoryRow,
    | 'record_hash'
    | 'ciphertext'
    | 'initialization_vector'
    | 'authentication_tag'
  >
): Buffer {
  return Buffer.from(
    JSON.stringify({
      memory_id: row.memory_id,
      stable_owner_hash: row.stable_owner_hash,
      memory_class: row.memory_class,
      temporal_status: row.temporal_status,
      privacy_zone: row.privacy_zone,
      confidence: row.confidence,
      salience: row.salience,
      observed_at: row.observed_at,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      content_hash: row.content_hash,
      created_by_trace_id: row.created_by_trace_id,
      created_at: row.created_at,
      modified_at: row.modified_at,
      encryption_key_id: row.encryption_key_id
    })
  )
}

function buildPurgePlanAAD(
  row: Omit<
    PurgePlanRow,
    | 'plan_hash'
    | 'ciphertext'
    | 'initialization_vector'
    | 'authentication_tag'
  >
): Buffer {
  return Buffer.from(
    JSON.stringify({
      plan_id: row.plan_id,
      action_id: row.action_id,
      trace_id: row.trace_id,
      stable_owner_hash: row.stable_owner_hash,
      device_hash: row.device_hash,
      auth_session_hash: row.auth_session_hash,
      scope_hash: row.scope_hash,
      record_count: row.record_count,
      reason_code: row.reason_code,
      challenge_hash: row.challenge_hash,
      created_at: row.created_at,
      expires_at: row.expires_at,
      encryption_key_id: row.encryption_key_id
    })
  )
}

function encryptedRecordHash(
  aad: Uint8Array,
  ciphertext: Uint8Array,
  initializationVector: Uint8Array,
  authenticationTag: Uint8Array
): string {
  return createHash('sha256')
    .update(aad)
    .update(initializationVector)
    .update(authenticationTag)
    .update(ciphertext)
    .digest('hex')
}

export class EncryptedSqliteMemoryStore {
  private database: DatabaseSync | null = null
  private masterKey: Buffer | null = null
  private ownerLookupKey: Buffer | null = null

  public constructor(private readonly config: EncryptedMemoryStoreConfig) {}

  public static fromProcessEnv(
    env: NodeJS.ProcessEnv = process.env
  ): EncryptedSqliteMemoryStore {
    return new EncryptedSqliteMemoryStore({
      enabled:
        env['MIRA_GREENFIELD_ENABLED'] === 'true' &&
        env['MIRA_GREENFIELD_MEMORY'] === 'true',
      databasePath:
        env['MIRA_GREENFIELD_MEMORY_DB_PATH'] ||
        path.join(process.cwd(), 'core', 'data', 'greenfield', 'memory.sqlite'),
      masterKeyBase64: env['MIRA_GREENFIELD_MEMORY_MASTER_KEY'] || '',
      ownerLookupKeyBase64: env['MIRA_GREENFIELD_OWNER_LOOKUP_KEY'] || '',
      keyVersion: env['MIRA_GREENFIELD_MEMORY_KEY_VERSION'] || 'v1',
      candidateTtlSeconds: parseSeconds(
        env['MIRA_GREENFIELD_MEMORY_CANDIDATE_TTL_SECONDS'],
        900,
        60,
        86_400
      ),
      purgePlanTtlSeconds: parseSeconds(
        env['MIRA_GREENFIELD_MEMORY_PURGE_TTL_SECONDS'],
        300,
        60,
        1_800
      )
    })
  }

  public createCandidate(input: CreateMemoryCandidateInput): MemoryCandidateChallenge {
    const database = this.ensureDatabase()
    const ownerKey = this.ownerKey(input.identity.owner_id)
    const stableOwnerHash = this.stableOwnerHash(input.identity.owner_id)
    const createdAt = input.createdAt.getTime()
    const expiresAt = createdAt + this.config.candidateTtlSeconds * 1_000
    const contentHash = keyedIdentifier(
      ownerKey,
      'content',
      normalizeContent(`${input.draft.title}\n${input.draft.content}`)
    )
    database
      .prepare(
        `DELETE FROM greenfield_memory_candidates
         WHERE stable_owner_hash = ? AND expires_at <= ?`
      )
      .run(stableOwnerHash, createdAt)
    const existing = database
      .prepare(
        `SELECT candidate_id FROM greenfield_memory_candidates
         WHERE stable_owner_hash = ? AND content_hash = ? AND expires_at > ?
         LIMIT 1`
      )
      .get(stableOwnerHash, contentHash, createdAt) as
      | Record<string, unknown>
      | undefined
    const durable = database
      .prepare(
        `SELECT memory_id FROM greenfield_memory_records
         WHERE stable_owner_hash = ? AND content_hash = ? LIMIT 1`
      )
      .get(stableOwnerHash, contentHash) as Record<string, unknown> | undefined
    if (existing || durable) {
      throw new MemoryStoreError(
        'memory.duplicate',
        'An equivalent pending or durable memory already exists for this owner.',
        409,
        existing
          ? { candidate_id: stringValue(existing['candidate_id']) }
          : { memory_id: stringValue(durable?.['memory_id']) }
      )
    }

    this.assertLinkedMemoriesOwned(
      database,
      stableOwnerHash,
      [
        ...input.draft.derivation_links,
        ...input.draft.contradiction_links,
        ...input.draft.supersession_links
      ]
    )

    const approvalToken = randomBytes(32).toString('base64url')
    const challengeHash = sha256(approvalToken)
    const encryptionKeyId = this.encryptionKeyId()
    const payload: CandidateSecretPayload = {
      ownerId: input.identity.owner_id,
      title: input.draft.title,
      content: input.draft.content,
      sourceRefs: [...input.draft.source_refs],
      observedAt: input.draft.observed_at,
      validFrom: input.draft.valid_from,
      validUntil: input.draft.valid_until,
      retentionPolicy: input.draft.retention_policy,
      derivationLinks: [...input.draft.derivation_links],
      contradictionLinks: [...input.draft.contradiction_links],
      supersessionLinks: [...input.draft.supersession_links]
    }
    const publicRow = {
      candidate_id: input.candidateId,
      stable_owner_hash: stableOwnerHash,
      trace_id: input.traceId,
      memory_class: input.draft.memory_class,
      temporal_status: input.draft.temporal_status,
      privacy_zone: input.draft.privacy_zone,
      confidence: input.draft.confidence,
      salience: input.draft.salience,
      content_hash: contentHash,
      challenge_hash: challengeHash,
      created_at: createdAt,
      expires_at: expiresAt,
      encryption_key_id: encryptionKeyId
    }
    const aad = buildCandidateAAD(publicRow)
    const initializationVector = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', ownerKey, initializationVector)
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final()
    ])
    const authenticationTag = cipher.getAuthTag()
    const recordHash = encryptedRecordHash(
      aad,
      ciphertext,
      initializationVector,
      authenticationTag
    )

    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare(
          `INSERT INTO greenfield_memory_candidates (
             candidate_id, stable_owner_hash, trace_id, memory_class,
             temporal_status, privacy_zone, confidence, salience,
             content_hash, challenge_hash, created_at, expires_at,
             encryption_key_id, record_hash, ciphertext,
             initialization_vector, authentication_tag
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.candidateId,
          stableOwnerHash,
          input.traceId,
          input.draft.memory_class,
          input.draft.temporal_status,
          input.draft.privacy_zone,
          input.draft.confidence,
          input.draft.salience,
          contentHash,
          challengeHash,
          createdAt,
          expiresAt,
          encryptionKeyId,
          recordHash,
          ciphertext,
          initializationVector,
          authenticationTag
        )
      this.appendEvent(database, {
        stableOwnerHash,
        traceId: input.traceId,
        candidateId: input.candidateId,
        memoryId: null,
        eventType: 'candidate_created',
        occurredAt: createdAt,
        metadata: {
          candidate_id: input.candidateId,
          record_hash: recordHash,
          expires_at: expiresAt
        }
      })
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      if (error instanceof MemoryStoreError) throw error
      throw new MemoryStoreError(
        'memory.candidate_persistence_failed',
        'The encrypted memory candidate could not be persisted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }

    const candidate: MemoryCandidate = {
      candidate_id: input.candidateId,
      owner_id: input.identity.owner_id,
      trace_id: input.traceId,
      memory_class: input.draft.memory_class,
      title: input.draft.title,
      content_ref: `memory-candidate://${input.candidateId}`,
      source_refs: [...input.draft.source_refs],
      observed_at: input.draft.observed_at,
      valid_from: input.draft.valid_from,
      valid_until: input.draft.valid_until,
      temporal_status: input.draft.temporal_status,
      confidence: input.draft.confidence,
      confirmation_status: 'pending',
      privacy_zone: input.draft.privacy_zone,
      salience: input.draft.salience,
      retention_policy: input.draft.retention_policy,
      embedding_version: null,
      derivation_links: [...input.draft.derivation_links],
      contradiction_links: [...input.draft.contradiction_links],
      supersession_links: [...input.draft.supersession_links]
    }
    const persistence: MemoryCandidatePersistenceReceipt = {
      candidate_id: input.candidateId,
      trace_id: input.traceId,
      record_hash: recordHash,
      content_hash: contentHash,
      created_at: new Date(createdAt).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
      encryption_key_id: encryptionKeyId,
      confirmation_required: true
    }
    return {
      candidate,
      content: input.draft.content,
      approval_token: approvalToken,
      persistence
    }
  }

  public readCandidate(
    ownerId: string,
    candidateId: string
  ): StoredMemoryCandidate | null {
    const database = this.ensureDatabase()
    const row = database
      .prepare(
        `SELECT * FROM greenfield_memory_candidates
         WHERE candidate_id = ? AND stable_owner_hash = ? LIMIT 1`
      )
      .get(candidateId, this.stableOwnerHash(ownerId)) as
      | Record<string, unknown>
      | undefined
    if (!row) return null
    const mapped = mapCandidateRow(row)
    const payload = this.decryptCandidate(ownerId, mapped)
    return {
      candidate: {
        candidate_id: mapped.candidate_id,
        owner_id: ownerId,
        trace_id: mapped.trace_id,
        memory_class: mapped.memory_class,
        title: payload.title,
        content_ref: `memory-candidate://${mapped.candidate_id}`,
        source_refs: payload.sourceRefs,
        observed_at: payload.observedAt,
        valid_from: payload.validFrom,
        valid_until: payload.validUntil,
        temporal_status: mapped.temporal_status,
        confidence: mapped.confidence,
        confirmation_status: 'pending',
        privacy_zone: mapped.privacy_zone,
        salience: mapped.salience,
        retention_policy: payload.retentionPolicy,
        embedding_version: null,
        derivation_links: payload.derivationLinks,
        contradiction_links: payload.contradictionLinks,
        supersession_links: payload.supersessionLinks
      },
      content: payload.content,
      content_hash: mapped.content_hash,
      record_hash: mapped.record_hash,
      created_at: new Date(mapped.created_at).toISOString(),
      expires_at: new Date(mapped.expires_at).toISOString()
    }
  }

  public rollbackCandidate(
    ownerId: string,
    candidateId: string,
    traceId: string,
    rolledBackAt = new Date()
  ): void {
    const database = this.ensureDatabase()
    const stableOwnerHash = this.stableOwnerHash(ownerId)
    database.exec('BEGIN IMMEDIATE')
    try {
      const result = database
        .prepare(
          `DELETE FROM greenfield_memory_candidates
           WHERE candidate_id = ? AND stable_owner_hash = ?`
        )
        .run(candidateId, stableOwnerHash)
      if (numberValue(result.changes) > 0) {
        this.appendEvent(database, {
          stableOwnerHash,
          traceId,
          candidateId,
          memoryId: null,
          eventType: 'candidate_rolled_back',
          occurredAt: rolledBackAt.getTime(),
          metadata: { candidate_id: candidateId }
        })
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw new MemoryStoreError(
        'memory.candidate_rollback_failed',
        'A failed trace could not roll back its pending memory candidate.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  public decideCandidate(input: DecideMemoryCandidateInput): {
    receipt: MemoryDecisionReceipt
    memory: DurableMemoryRecord | null
  } {
    const database = this.ensureDatabase()
    const stableOwnerHash = this.stableOwnerHash(input.identity.owner_id)
    const rowValue = database
      .prepare(
        `SELECT * FROM greenfield_memory_candidates
         WHERE candidate_id = ? AND stable_owner_hash = ? LIMIT 1`
      )
      .get(input.candidateId, stableOwnerHash) as
      | Record<string, unknown>
      | undefined
    if (!rowValue) {
      throw new MemoryStoreError(
        'memory.candidate_not_found',
        'The pending memory candidate was not found for this owner.',
        404
      )
    }
    const row = mapCandidateRow(rowValue)
    if (row.expires_at < input.decidedAt.getTime()) {
      throw new MemoryStoreError(
        'memory.candidate_expired',
        'The memory confirmation challenge has expired.',
        410
      )
    }
    if (!challengeMatches(input.approvalToken, row.challenge_hash)) {
      throw new MemoryStoreError(
        'memory.approval_token_invalid',
        'The memory confirmation challenge is invalid.',
        403
      )
    }
    const payload = this.decryptCandidate(input.identity.owner_id, row)
    const createId = input.createId || randomUUID
    const decisionReceiptId = createId()
    const decidedAt = input.decidedAt.getTime()
    let memory: DurableMemoryRecord | null = null

    database.exec('BEGIN IMMEDIATE')
    try {
      let memoryId: string | null = null
      let durableRecordHash: string | null = null
      if (input.decision === 'owner_confirmed') {
        memoryId = createId()
        memory = this.insertDurableMemory(database, {
          memoryId,
          stableOwnerHash,
          ownerId: input.identity.owner_id,
          candidateRow: row,
          candidatePayload: payload,
          createdAt: decidedAt,
          createId
        })
        durableRecordHash = memory.record_hash
        this.appendEvent(database, {
          stableOwnerHash,
          traceId: row.trace_id,
          candidateId: row.candidate_id,
          memoryId,
          eventType: 'memory_created',
          occurredAt: decidedAt,
          metadata: {
            memory_id: memoryId,
            record_hash: durableRecordHash,
            source_trace_id: row.trace_id
          },
          createId
        })
      }

      const receiptHash = canonicalHash({
        decision_receipt_id: decisionReceiptId,
        stable_owner_hash: stableOwnerHash,
        candidate_id: row.candidate_id,
        trace_id: row.trace_id,
        decision: input.decision,
        decided_at: decidedAt,
        memory_id: memoryId,
        durable_record_hash: durableRecordHash,
        verification_status: 'succeeded'
      })
      database
        .prepare(
          `INSERT INTO greenfield_memory_decision_receipts (
             decision_receipt_id, stable_owner_hash, candidate_id, trace_id,
             decision, decided_at, memory_id, durable_record_hash,
             verification_status, receipt_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          decisionReceiptId,
          stableOwnerHash,
          row.candidate_id,
          row.trace_id,
          input.decision,
          decidedAt,
          memoryId,
          durableRecordHash,
          'succeeded',
          receiptHash
        )
      database
        .prepare(
          `DELETE FROM greenfield_memory_candidates
           WHERE candidate_id = ? AND stable_owner_hash = ?`
        )
        .run(row.candidate_id, stableOwnerHash)
      this.appendEvent(database, {
        stableOwnerHash,
        traceId: row.trace_id,
        candidateId: row.candidate_id,
        memoryId,
        eventType:
          input.decision === 'owner_confirmed'
            ? 'candidate_confirmed'
            : 'candidate_rejected',
        occurredAt: decidedAt,
        metadata: {
          decision_receipt_id: decisionReceiptId,
          memory_id: memoryId,
          receipt_hash: receiptHash
        },
        createId
      })
      database.exec('COMMIT')

      return {
        receipt: {
          decision_receipt_id: decisionReceiptId,
          candidate_id: row.candidate_id,
          trace_id: row.trace_id,
          decision: input.decision,
          decided_at: new Date(decidedAt).toISOString(),
          memory_id: memoryId,
          durable_record_hash: durableRecordHash,
          verification_status: 'succeeded',
          receipt_hash: receiptHash
        },
        memory
      }
    } catch (error) {
      database.exec('ROLLBACK')
      if (error instanceof MemoryStoreError) throw error
      throw new MemoryStoreError(
        'memory.decision_failed',
        'The memory confirmation decision could not be durably applied.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  public search(
    identity: IdentityContext,
    query: string,
    timeScope: MemoryTimeScope,
    limit = 10,
    searchedAt = new Date()
  ): MemorySearchResult {
    const database = this.ensureDatabase()
    const stableOwnerHash = this.stableOwnerHash(identity.owner_id)
    if (timeScope === 'current') {
      this.appendStandaloneEvent({
        stableOwnerHash,
        traceId: randomUUID(),
        eventType: 'memory_searched',
        occurredAt: searchedAt.getTime(),
        metadata: {
          time_scope: timeScope,
          query_hash: keyedIdentifier(
            this.indexKey(identity.owner_id),
            'query',
            normalizeContent(query)
          ),
          record_count: 0,
          limitation: 'current_state_requires_fresh_evidence'
        }
      })
      return {
        query,
        time_scope: timeScope,
        records: [],
        limitations: [
          'current_state_requires_fresh_evidence: Durable memory cannot establish present-world state; retrieve fresh source evidence instead.'
        ],
        searched_at: searchedAt.toISOString()
      }
    }

    const resultLimit = clampLimit(limit)
    const tokens = tokenize(query)
    const temporalClause =
      timeScope === 'historical'
        ? ' AND r.temporal_status = \'historical\''
        : timeScope === 'prospective'
          ? ' AND r.temporal_status = \'prospective\''
          : ''
    let rows: MemoryRow[]
    if (tokens.length === 0) {
      rows = database
        .prepare(
          `SELECT r.* FROM greenfield_memory_records r
           WHERE r.stable_owner_hash = ?${temporalClause}
             AND NOT EXISTS (
               SELECT 1 FROM greenfield_memory_graph_edges e
               WHERE e.stable_owner_hash = r.stable_owner_hash
                 AND e.relation = 'supersedes'
                 AND e.target_memory_id = r.memory_id
             )
           ORDER BY r.observed_at DESC, r.rowid DESC
           LIMIT ?`
        )
        .all(stableOwnerHash, resultLimit)
        .map((row) => mapMemoryRow(row as Record<string, unknown>))
    } else {
      const termHashes = tokens.map((token) =>
        keyedIdentifier(this.indexKey(identity.owner_id), 'term', token)
      )
      const placeholders = termHashes.map(() => '?').join(', ')
      const values: SQLInputValue[] = [
        stableOwnerHash,
        ...termHashes,
        resultLimit
      ]
      rows = database
        .prepare(
          `SELECT r.*, SUM(s.term_weight) AS relevance
           FROM greenfield_memory_records r
           JOIN greenfield_memory_search_terms s ON s.memory_id = r.memory_id
           WHERE r.stable_owner_hash = ?
             AND s.term_hash IN (${placeholders})${temporalClause}
             AND NOT EXISTS (
               SELECT 1 FROM greenfield_memory_graph_edges e
               WHERE e.stable_owner_hash = r.stable_owner_hash
                 AND e.relation = 'supersedes'
                 AND e.target_memory_id = r.memory_id
             )
           GROUP BY r.memory_id
           ORDER BY relevance DESC, r.salience DESC, r.observed_at DESC
           LIMIT ?`
        )
        .all(...values)
        .map((row) => mapMemoryRow(row as Record<string, unknown>))
    }
    const records = rows.map((row) => this.decryptMemory(identity.owner_id, row))
    this.appendStandaloneEvent({
      stableOwnerHash,
      traceId: randomUUID(),
      eventType: 'memory_searched',
      occurredAt: searchedAt.getTime(),
      metadata: {
        time_scope: timeScope,
        query_hash: keyedIdentifier(
          this.indexKey(identity.owner_id),
          'query',
          normalizeContent(query)
        ),
        record_count: records.length
      }
    })
    return {
      query,
      time_scope: timeScope,
      records,
      limitations: [],
      searched_at: searchedAt.toISOString()
    }
  }

  public exportOwner(
    identity: IdentityContext,
    exportedAt = new Date()
  ): MemoryExportBundle {
    const database = this.ensureDatabase()
    const stableOwnerHash = this.stableOwnerHash(identity.owner_id)
    const records = database
      .prepare(
        `SELECT * FROM greenfield_memory_records
         WHERE stable_owner_hash = ?
         ORDER BY observed_at ASC, rowid ASC`
      )
      .all(stableOwnerHash)
      .map((row) =>
        this.decryptMemory(
          identity.owner_id,
          mapMemoryRow(row as Record<string, unknown>)
        )
      )
    const body = {
      exported_at: exportedAt.toISOString(),
      owner_ref: `owner:${stableOwnerHash.slice(0, 24)}`,
      record_count: records.length,
      records
    }
    return {
      ...body,
      bundle_hash: canonicalHash(body)
    }
  }

  public createPurgePlan(input: CreateMemoryPurgePlanInput): {
    plan: MemoryPurgePlan
    approvalToken: string
  } {
    if (
      input.memoryIds.length === 0 ||
      input.memoryIds.length > MAX_MEMORY_SCOPE ||
      new Set(input.memoryIds).size !== input.memoryIds.length
    ) {
      throw new MemoryStoreError(
        'memory.purge_scope_invalid',
        'Memory purge scope must contain 1-100 unique memory IDs.',
        400
      )
    }
    if (!REASON_CODE_PATTERN.test(input.reasonCode)) {
      throw new MemoryStoreError(
        'memory.purge_reason_invalid',
        'The purge reason must be a stable lowercase identifier.',
        400
      )
    }
    const database = this.ensureDatabase()
    const stableOwnerHash = this.stableOwnerHash(input.identity.owner_id)
    const records = this.readExactMemoryRows(
      database,
      stableOwnerHash,
      input.memoryIds
    )
    if (records.length !== input.memoryIds.length) {
      throw new MemoryStoreError(
        'memory.purge_scope_not_found',
        'One or more requested memories were not found for this owner.',
        404
      )
    }
    const byId = new Map(records.map((record) => [record.memory_id, record]))
    const sortedIds = [...input.memoryIds].sort()
    const recordHashes = sortedIds.map((memoryId) => {
      const record = byId.get(memoryId)
      if (!record) {
        throw new MemoryStoreError(
          'memory.purge_scope_not_found',
          'The exact purge scope changed while the plan was being created.',
          409
        )
      }
      return record.record_hash
    })
    const createId = input.createId || randomUUID
    const planId = createId()
    const actionId = createId()
    const approvalToken = randomBytes(32).toString('base64url')
    const challengeHash = sha256(approvalToken)
    const createdAt = input.createdAt.getTime()
    const expiresAt = createdAt + this.config.purgePlanTtlSeconds * 1_000
    const scopeHash = canonicalHash({
      owner_ref: stableOwnerHash,
      memory_ids: sortedIds,
      record_hashes: recordHashes,
      reason_code: input.reasonCode
    })
    const verificationCriteria = [
      'Every canonical memory ID in the exact scope is absent.',
      'Every keyed search projection for the exact scope is absent.',
      'Every graph edge referencing the exact scope is absent.',
      'Every pending candidate derived from, contradicting, or superseding the exact scope is absent.',
      'The remaining owner event chain remains valid.',
      'A content-free immutable purge receipt is persisted.'
    ]
    const rollbackLimitations = [
      'Physical memory purge is irreversible.',
      'A code rollback cannot restore deleted canonical or derived memory.',
      'Restoration requires a separately owner-authorized backup workflow that is not implemented.'
    ]
    const payload: PurgePlanSecretPayload = {
      ownerId: input.identity.owner_id,
      deviceId: input.identity.device_id,
      authSessionId: input.identity.auth_session_id,
      memoryIds: sortedIds,
      recordHashes,
      reasonCode: input.reasonCode,
      verificationCriteria,
      rollbackLimitations
    }
    const publicRow = {
      plan_id: planId,
      action_id: actionId,
      trace_id: input.traceId,
      stable_owner_hash: stableOwnerHash,
      device_hash: keyedIdentifier(
        this.ensureMasterKey(),
        'device',
        input.identity.device_id
      ),
      auth_session_hash: keyedIdentifier(
        this.ensureMasterKey(),
        'session',
        input.identity.auth_session_id
      ),
      scope_hash: scopeHash,
      record_count: sortedIds.length,
      reason_code: input.reasonCode,
      challenge_hash: challengeHash,
      created_at: createdAt,
      expires_at: expiresAt,
      encryption_key_id: this.encryptionKeyId()
    }
    const aad = buildPurgePlanAAD(publicRow)
    const initializationVector = randomBytes(12)
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.ownerKey(input.identity.owner_id),
      initializationVector
    )
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final()
    ])
    const authenticationTag = cipher.getAuthTag()
    const planHash = encryptedRecordHash(
      aad,
      ciphertext,
      initializationVector,
      authenticationTag
    )

    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare(
          `INSERT INTO greenfield_memory_purge_plans (
             plan_id, action_id, trace_id, stable_owner_hash, device_hash,
             auth_session_hash, scope_hash, record_count, reason_code,
             challenge_hash, created_at, expires_at, encryption_key_id,
             plan_hash, ciphertext, initialization_vector, authentication_tag
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          planId,
          actionId,
          input.traceId,
          stableOwnerHash,
          publicRow.device_hash,
          publicRow.auth_session_hash,
          scopeHash,
          sortedIds.length,
          input.reasonCode,
          challengeHash,
          createdAt,
          expiresAt,
          publicRow.encryption_key_id,
          planHash,
          ciphertext,
          initializationVector,
          authenticationTag
        )
      this.appendEvent(database, {
        stableOwnerHash,
        traceId: input.traceId,
        candidateId: null,
        memoryId: null,
        eventType: 'purge_planned',
        occurredAt: createdAt,
        metadata: { plan_id: planId, scope_hash: scopeHash, plan_hash: planHash },
        createId
      })
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw new MemoryStoreError(
        'memory.purge_plan_failed',
        'The immutable memory purge plan could not be persisted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }

    return {
      plan: {
        plan_id: planId,
        action_id: actionId,
        trace_id: input.traceId,
        capability: MEMORY_PURGE_CAPABILITY,
        risk: 'critical',
        memory_ids: sortedIds,
        record_hashes: recordHashes,
        scope_hash: scopeHash,
        reason_code: input.reasonCode,
        created_at: new Date(createdAt).toISOString(),
        expires_at: new Date(expiresAt).toISOString(),
        verification_criteria: verificationCriteria,
        rollback_supported: false,
        rollback_limitations: rollbackLimitations,
        plan_hash: planHash
      },
      approvalToken
    }
  }

  public readPurgePlan(ownerId: string, planId: string): MemoryPurgePlan | null {
    const row = this.readPurgePlanRow(ownerId, planId)
    return row ? this.publicPurgePlan(ownerId, row) : null
  }

  public decidePurgePlan(input: DecideMemoryPurgePlanInput): MemoryPurgeApproval {
    const database = this.ensureDatabase()
    const row = this.readPurgePlanRow(input.identity.owner_id, input.planId)
    if (!row) {
      throw new MemoryStoreError(
        'memory.purge_plan_not_found',
        'The purge plan was not found for this owner.',
        404
      )
    }
    if (row.expires_at < input.decidedAt.getTime()) {
      throw new MemoryStoreError(
        'memory.purge_plan_expired',
        'The memory purge plan has expired.',
        410
      )
    }
    this.assertPlanIdentity(row, input.identity)
    if (!challengeMatches(input.approvalToken, row.challenge_hash)) {
      throw new MemoryStoreError(
        'memory.purge_approval_token_invalid',
        'The memory purge approval challenge is invalid.',
        403
      )
    }
    const existing = this.readPurgeApproval(input.planId)
    if (existing) {
      throw new MemoryStoreError(
        'memory.purge_already_decided',
        'The memory purge plan already has an immutable owner decision.',
        409,
        existing
      )
    }
    const createId = input.createId || randomUUID
    const approvalId = createId()
    const decidedAt = input.decidedAt.getTime()
    const approvalHash = canonicalHash({
      approval_id: approvalId,
      plan_id: row.plan_id,
      trace_id: row.trace_id,
      stable_owner_hash: row.stable_owner_hash,
      device_hash: row.device_hash,
      auth_session_hash: row.auth_session_hash,
      scope_hash: row.scope_hash,
      decision: input.decision,
      decided_at: decidedAt
    })
    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare(
          `INSERT INTO greenfield_memory_purge_approvals (
             approval_id, plan_id, stable_owner_hash, device_hash,
             auth_session_hash, scope_hash, decision, decided_at, approval_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          approvalId,
          row.plan_id,
          row.stable_owner_hash,
          row.device_hash,
          row.auth_session_hash,
          row.scope_hash,
          input.decision,
          decidedAt,
          approvalHash
        )
      this.appendEvent(database, {
        stableOwnerHash: row.stable_owner_hash,
        traceId: row.trace_id,
        candidateId: null,
        memoryId: null,
        eventType:
          input.decision === 'approved' ? 'purge_approved' : 'purge_rejected',
        occurredAt: decidedAt,
        metadata: {
          plan_id: row.plan_id,
          approval_id: approvalId,
          decision: input.decision,
          approval_hash: approvalHash
        },
        createId
      })
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw new MemoryStoreError(
        'memory.purge_decision_failed',
        'The owner purge decision could not be persisted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
    return {
      approval_id: approvalId,
      plan_id: row.plan_id,
      trace_id: row.trace_id,
      decision: input.decision,
      scope_hash: row.scope_hash,
      decided_at: new Date(decidedAt).toISOString(),
      approval_hash: approvalHash
    }
  }

  public readPurgeApproval(planId: string): MemoryPurgeApproval | null {
    const database = this.ensureDatabase()
    const raw = database
      .prepare(
        `SELECT a.*, p.trace_id FROM greenfield_memory_purge_approvals a
         JOIN greenfield_memory_purge_plans p ON p.plan_id = a.plan_id
         WHERE a.plan_id = ? LIMIT 1`
      )
      .get(planId) as Record<string, unknown> | undefined
    if (!raw) return null
    return {
      approval_id: stringValue(raw['approval_id']),
      plan_id: stringValue(raw['plan_id']),
      trace_id: stringValue(raw['trace_id']),
      decision: stringValue(raw['decision']) as 'approved' | 'rejected',
      scope_hash: stringValue(raw['scope_hash']),
      decided_at: new Date(numberValue(raw['decided_at'])).toISOString(),
      approval_hash: stringValue(raw['approval_hash'])
    }
  }

  public executePurgePlan(input: ExecuteMemoryPurgePlanInput): MemoryPurgeReceipt {
    const database = this.ensureDatabase()
    const row = this.readPurgePlanRow(input.identity.owner_id, input.planId)
    if (!row) {
      throw new MemoryStoreError(
        'memory.purge_plan_not_found',
        'The purge plan was not found for this owner.',
        404
      )
    }
    this.assertPlanIdentity(row, input.identity)
    if (row.expires_at < input.executedAt.getTime()) {
      throw new MemoryStoreError(
        'memory.purge_plan_expired',
        'The memory purge plan has expired.',
        410
      )
    }
    const existingReceipt = this.readPurgeReceipt(row.plan_id)
    if (existingReceipt) return existingReceipt
    const approval = this.readPurgeApproval(row.plan_id)
    if (!approval || approval.decision !== 'approved') {
      throw new MemoryStoreError(
        'memory.purge_approval_required',
        'An immutable matching owner approval is required before purge.',
        403
      )
    }
    if (approval.scope_hash !== row.scope_hash) {
      throw new MemoryStoreError(
        'memory.purge_approval_scope_mismatch',
        'The owner approval does not match the purge plan scope.',
        409
      )
    }
    const plan = this.publicPurgePlan(input.identity.owner_id, row)
    const currentRows = this.readExactMemoryRows(
      database,
      row.stable_owner_hash,
      plan.memory_ids
    )
    const currentById = new Map(
      currentRows.map((record) => [record.memory_id, record.record_hash])
    )
    const exactScopeValid = plan.memory_ids.every(
      (memoryId, index) => currentById.get(memoryId) === plan.record_hashes[index]
    )
    if (!exactScopeValid || currentRows.length !== plan.memory_ids.length) {
      return this.recordFailedPurgeReceipt(
        database,
        row,
        plan,
        input,
        'memory.purge_scope_changed'
      )
    }

    const candidateIds = this.findLinkedCandidateIds(
      input.identity.owner_id,
      plan.memory_ids
    )
    const createId = input.createId || randomUUID
    const executedAt = input.executedAt.getTime()
    database.exec('BEGIN IMMEDIATE')
    try {
      for (const candidateId of candidateIds) {
        database
          .prepare(
            `DELETE FROM greenfield_memory_candidates
             WHERE candidate_id = ? AND stable_owner_hash = ?`
          )
          .run(candidateId, row.stable_owner_hash)
      }
      const placeholders = plan.memory_ids.map(() => '?').join(', ')
      const values: SQLInputValue[] = [row.stable_owner_hash, ...plan.memory_ids]
      const graphValues: SQLInputValue[] = [
        row.stable_owner_hash,
        ...plan.memory_ids,
        ...plan.memory_ids
      ]
      database
        .prepare(
          `DELETE FROM greenfield_memory_graph_edges
           WHERE stable_owner_hash = ?
             AND (source_memory_id IN (${placeholders})
                  OR target_memory_id IN (${placeholders}))`
        )
        .run(...graphValues)
      database
        .prepare(
          `DELETE FROM greenfield_memory_search_terms
           WHERE stable_owner_hash = ? AND memory_id IN (${placeholders})`
        )
        .run(...values)
      database
        .prepare(
          `DELETE FROM greenfield_memory_records
           WHERE stable_owner_hash = ? AND memory_id IN (${placeholders})`
        )
        .run(...values)

      const remainingRecords = this.countScopedRows(
        database,
        'greenfield_memory_records',
        'memory_id',
        row.stable_owner_hash,
        plan.memory_ids
      )
      const remainingTerms = this.countScopedRows(
        database,
        'greenfield_memory_search_terms',
        'memory_id',
        row.stable_owner_hash,
        plan.memory_ids
      )
      const remainingEdges = this.countGraphScope(
        database,
        row.stable_owner_hash,
        plan.memory_ids
      )
      const remainingCandidates = this.findLinkedCandidateIds(
        input.identity.owner_id,
        plan.memory_ids,
        database
      ).length
      if (
        remainingRecords !== 0 ||
        remainingTerms !== 0 ||
        remainingEdges !== 0 ||
        remainingCandidates !== 0
      ) {
        throw new MemoryStoreError(
          'memory.purge_verification_failed',
          'Physical purge verification found remaining canonical or derived memory.',
          500,
          {
            remainingRecords,
            remainingTerms,
            remainingEdges,
            remainingCandidates
          }
        )
      }
      const chain = this.verifyOwnerEventChainByHash(
        database,
        row.stable_owner_hash
      )
      if (!chain.valid) {
        throw new MemoryStoreError(
          'memory.event_chain_invalid',
          'The owner memory event chain failed verification before receipt creation.',
          500,
          chain
        )
      }
      const receipt = this.insertPurgeReceipt(database, {
        row,
        plan,
        executedAt,
        verifiedAt: executedAt,
        executionStatus: 'succeeded',
        verificationStatus: 'succeeded',
        evidenceRefs: [
          `memory-records:absent:${row.scope_hash}`,
          `memory-search:absent:${row.scope_hash}`,
          `memory-graph:absent:${row.scope_hash}`,
          `memory-candidates:absent:${row.scope_hash}`,
          `memory-event-chain:valid:${chain.eventCount}`
        ],
        failureCode: null,
        createId
      })
      this.appendEvent(database, {
        stableOwnerHash: row.stable_owner_hash,
        traceId: row.trace_id,
        candidateId: null,
        memoryId: null,
        eventType: 'purge_executed',
        occurredAt: executedAt,
        metadata: {
          plan_id: row.plan_id,
          scope_hash: row.scope_hash,
          record_count: plan.memory_ids.length,
          receipt_hash: receipt.receipt_hash
        },
        createId
      })
      database.exec('COMMIT')
      return receipt
    } catch (error) {
      database.exec('ROLLBACK')
      if (error instanceof MemoryStoreError) throw error
      throw new MemoryStoreError(
        'memory.purge_execution_failed',
        'The exact memory purge failed before verified completion.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  public readPurgeReceipt(planId: string): MemoryPurgeReceipt | null {
    const database = this.ensureDatabase()
    const raw = database
      .prepare(
        `SELECT * FROM greenfield_memory_purge_receipts
         WHERE plan_id = ? LIMIT 1`
      )
      .get(planId) as Record<string, unknown> | undefined
    if (!raw) return null
    return {
      receipt_id: stringValue(raw['receipt_id']),
      plan_id: stringValue(raw['plan_id']),
      action_id: stringValue(raw['action_id']),
      trace_id: stringValue(raw['trace_id']),
      scope_hash: stringValue(raw['scope_hash']),
      reason_code: stringValue(raw['reason_code']),
      record_count: numberValue(raw['record_count']),
      execution_status: stringValue(raw['execution_status']) as
        | 'succeeded'
        | 'failed',
      verification_status: stringValue(raw['verification_status']) as
        | 'succeeded'
        | 'failed',
      verification_evidence_refs: parseJsonArray(
        raw['verification_evidence_refs_json']
      ),
      executed_at: new Date(numberValue(raw['executed_at'])).toISOString(),
      verified_at: new Date(numberValue(raw['verified_at'])).toISOString(),
      rollback_status: 'unavailable',
      failure_code: nullableStringValue(raw['failure_code']),
      receipt_hash: stringValue(raw['receipt_hash'])
    }
  }

  public countOwnerMemories(ownerId: string): number {
    const row = this.ensureDatabase()
      .prepare(
        `SELECT COUNT(*) AS count FROM greenfield_memory_records
         WHERE stable_owner_hash = ?`
      )
      .get(this.stableOwnerHash(ownerId)) as Record<string, unknown> | undefined
    return row ? numberValue(row['count']) : 0
  }

  public verifyOwnerEventChain(ownerId: string): MemoryEventChainVerification {
    return this.verifyOwnerEventChainByHash(
      this.ensureDatabase(),
      this.stableOwnerHash(ownerId)
    )
  }

  public getAppliedMigrationVersions(): number[] {
    return this.ensureDatabase()
      .prepare(
        `SELECT version FROM greenfield_memory_schema_migrations
         ORDER BY version ASC`
      )
      .all()
      .map((row) => numberValue((row as Record<string, unknown>)['version']))
  }

  public close(): void {
    this.database?.close()
    this.database = null
    this.masterKey = null
    this.ownerLookupKey = null
  }

  private ensureDatabase(): DatabaseSync {
    if (!this.config.enabled) {
      throw new MemoryStoreError(
        'memory.disabled',
        'Durable greenfield memory is disabled.',
        503
      )
    }
    if (this.database) return this.database
    if (!KEY_VERSION_PATTERN.test(this.config.keyVersion)) {
      throw new MemoryStoreError(
        'memory.key_version_invalid',
        'The memory key version must be a stable lowercase identifier.',
        503
      )
    }
    this.masterKey = decodeKey(
      this.config.masterKeyBase64,
      'MIRA_GREENFIELD_MEMORY_MASTER_KEY'
    )
    this.ownerLookupKey = decodeKey(
      this.config.ownerLookupKeyBase64,
      'MIRA_GREENFIELD_OWNER_LOOKUP_KEY'
    )
    if (timingSafeEqual(this.masterKey, this.ownerLookupKey)) {
      throw new MemoryStoreError(
        'memory.lookup_key_reused',
        'The owner lookup key must be distinct from the memory encryption key.',
        503
      )
    }
    const inMemory = this.config.databasePath === ':memory:'
    if (!inMemory) {
      const directory = path.dirname(this.config.databasePath)
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
      this.tryRestrictPermissions(directory, 0o700)
    }
    const database = new DatabaseSync(this.config.databasePath)
    database.exec('PRAGMA journal_mode = WAL;')
    database.exec('PRAGMA foreign_keys = ON;')
    database.exec('PRAGMA synchronous = FULL;')
    database.exec('PRAGMA secure_delete = ON;')
    database.exec('PRAGMA busy_timeout = 5000;')
    this.applyMigrations(database)
    this.database = database
    if (!inMemory) this.tryRestrictPermissions(this.config.databasePath, 0o600)
    return database
  }

  private ensureMasterKey(): Buffer {
    this.ensureDatabase()
    if (!this.masterKey) {
      throw new MemoryStoreError(
        'memory.master_key_unavailable',
        'The memory encryption key is unavailable.',
        503
      )
    }
    return this.masterKey
  }

  private ensureOwnerLookupKey(): Buffer {
    this.ensureDatabase()
    if (!this.ownerLookupKey) {
      throw new MemoryStoreError(
        'memory.lookup_key_unavailable',
        'The stable owner lookup key is unavailable.',
        503
      )
    }
    return this.ownerLookupKey
  }

  private ownerKey(ownerId: string): Buffer {
    return deriveOwnerKey(this.ensureMasterKey(), ownerId)
  }

  private indexKey(ownerId: string): Buffer {
    return deriveIndexKey(this.ensureMasterKey(), ownerId)
  }

  private stableOwnerHash(ownerId: string): string {
    return keyedIdentifier(this.ensureOwnerLookupKey(), 'owner', ownerId)
  }

  private encryptionKeyId(): string {
    return `memory:${this.config.keyVersion}:${sha256(this.ensureMasterKey()).slice(0, 24)}`
  }

  private applyMigrations(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS greenfield_memory_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `)
    const applied = new Set(
      database
        .prepare('SELECT version FROM greenfield_memory_schema_migrations')
        .all()
        .map((row) =>
          numberValue((row as Record<string, unknown>)['version'])
        )
    )
    for (const migration of MEMORY_MIGRATIONS) {
      if (applied.has(migration.version)) continue
      database.exec('BEGIN IMMEDIATE')
      try {
        database.exec(migration.sql)
        database
          .prepare(
            `INSERT INTO greenfield_memory_schema_migrations
             (version, name, applied_at) VALUES (?, ?, ?)`
          )
          .run(migration.version, migration.name, Date.now())
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw new MemoryStoreError(
          'memory.migration_failed',
          `Memory migration ${migration.version} failed.`,
          500,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
  }

  private decryptCandidate(ownerId: string, row: CandidateRow): CandidateSecretPayload {
    const aad = buildCandidateAAD({
      candidate_id: row.candidate_id,
      stable_owner_hash: row.stable_owner_hash,
      trace_id: row.trace_id,
      memory_class: row.memory_class,
      temporal_status: row.temporal_status,
      privacy_zone: row.privacy_zone,
      confidence: row.confidence,
      salience: row.salience,
      content_hash: row.content_hash,
      challenge_hash: row.challenge_hash,
      created_at: row.created_at,
      expires_at: row.expires_at,
      encryption_key_id: row.encryption_key_id
    })
    this.assertEncryptedHash(
      row.record_hash,
      aad,
      row.ciphertext,
      row.initialization_vector,
      row.authentication_tag,
      'candidate'
    )
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.ownerKey(ownerId),
        Buffer.from(row.initialization_vector)
      )
      decipher.setAAD(aad)
      decipher.setAuthTag(Buffer.from(row.authentication_tag))
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(row.ciphertext)),
        decipher.final()
      ]).toString('utf8')
      const payload = JSON.parse(plaintext) as CandidateSecretPayload
      if (payload.ownerId !== ownerId) throw new Error('Owner mismatch.')
      return payload
    } catch (error) {
      throw new MemoryStoreError(
        'memory.candidate_decryption_failed',
        'The memory candidate could not be authenticated and decrypted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private decryptMemory(ownerId: string, row: MemoryRow): DurableMemoryRecord {
    const aad = buildMemoryAAD({
      memory_id: row.memory_id,
      stable_owner_hash: row.stable_owner_hash,
      memory_class: row.memory_class,
      temporal_status: row.temporal_status,
      privacy_zone: row.privacy_zone,
      confidence: row.confidence,
      salience: row.salience,
      observed_at: row.observed_at,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      content_hash: row.content_hash,
      created_by_trace_id: row.created_by_trace_id,
      created_at: row.created_at,
      modified_at: row.modified_at,
      encryption_key_id: row.encryption_key_id
    })
    this.assertEncryptedHash(
      row.record_hash,
      aad,
      row.ciphertext,
      row.initialization_vector,
      row.authentication_tag,
      'record'
    )
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.ownerKey(ownerId),
        Buffer.from(row.initialization_vector)
      )
      decipher.setAAD(aad)
      decipher.setAuthTag(Buffer.from(row.authentication_tag))
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(row.ciphertext)),
        decipher.final()
      ]).toString('utf8')
      const payload = JSON.parse(plaintext) as MemorySecretPayload
      if (payload.ownerId !== ownerId) throw new Error('Owner mismatch.')
      return {
        memory_id: row.memory_id,
        owner_id: ownerId,
        memory_class: row.memory_class,
        title: payload.title,
        content: payload.content,
        observed_at: new Date(row.observed_at).toISOString(),
        valid_from:
          row.valid_from === null ? null : new Date(row.valid_from).toISOString(),
        valid_until:
          row.valid_until === null ? null : new Date(row.valid_until).toISOString(),
        temporal_status: row.temporal_status,
        source_refs: payload.sourceRefs,
        confidence: row.confidence,
        confirmation_status: 'owner_confirmed',
        privacy_zone: row.privacy_zone,
        salience: row.salience,
        retention_policy: payload.retentionPolicy,
        embedding_version: payload.embeddingVersion,
        derived_from: payload.derivedFrom,
        contradicts: payload.contradicts,
        supersedes: payload.supersedes,
        created_by_trace_id: row.created_by_trace_id,
        created_at: new Date(row.created_at).toISOString(),
        modified_at: new Date(row.modified_at).toISOString(),
        record_hash: row.record_hash,
        projection_status: 'ready'
      }
    } catch (error) {
      throw new MemoryStoreError(
        'memory.decryption_failed',
        'The durable memory could not be authenticated and decrypted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private assertEncryptedHash(
    expected: string,
    aad: Buffer,
    ciphertext: Uint8Array,
    initializationVector: Uint8Array,
    authenticationTag: Uint8Array,
    kind: string
  ): void {
    const computed = encryptedRecordHash(
      aad,
      ciphertext,
      initializationVector,
      authenticationTag
    )
    if (computed !== expected) {
      throw new MemoryStoreError(
        'memory.integrity_failed',
        `The encrypted memory ${kind} hash does not match its contents.`,
        500
      )
    }
  }

  private insertDurableMemory(
    database: DatabaseSync,
    input: {
      memoryId: string
      stableOwnerHash: string
      ownerId: string
      candidateRow: CandidateRow
      candidatePayload: CandidateSecretPayload
      createdAt: number
      createId: () => string
    }
  ): DurableMemoryRecord {
    const payload: MemorySecretPayload = {
      ownerId: input.ownerId,
      title: input.candidatePayload.title,
      content: input.candidatePayload.content,
      sourceRefs: input.candidatePayload.sourceRefs,
      retentionPolicy: input.candidatePayload.retentionPolicy,
      embeddingVersion: null,
      derivedFrom: input.candidatePayload.derivationLinks,
      contradicts: input.candidatePayload.contradictionLinks,
      supersedes: input.candidatePayload.supersessionLinks
    }
    const publicRow = {
      memory_id: input.memoryId,
      stable_owner_hash: input.stableOwnerHash,
      memory_class: input.candidateRow.memory_class,
      temporal_status: input.candidateRow.temporal_status,
      privacy_zone: input.candidateRow.privacy_zone,
      confidence: input.candidateRow.confidence,
      salience: input.candidateRow.salience,
      observed_at: Date.parse(input.candidatePayload.observedAt),
      valid_from: timestampValue(input.candidatePayload.validFrom),
      valid_until: timestampValue(input.candidatePayload.validUntil),
      content_hash: input.candidateRow.content_hash,
      created_by_trace_id: input.candidateRow.trace_id,
      created_at: input.createdAt,
      modified_at: input.createdAt,
      encryption_key_id: this.encryptionKeyId()
    }
    if (!Number.isFinite(publicRow.observed_at)) {
      throw new MemoryStoreError(
        'memory.observed_at_invalid',
        'The memory observation timestamp is invalid.',
        400
      )
    }
    const aad = buildMemoryAAD(publicRow)
    const initializationVector = randomBytes(12)
    const cipher = createCipheriv(
      'aes-256-gcm',
      this.ownerKey(input.ownerId),
      initializationVector
    )
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final()
    ])
    const authenticationTag = cipher.getAuthTag()
    const recordHash = encryptedRecordHash(
      aad,
      ciphertext,
      initializationVector,
      authenticationTag
    )
    database
      .prepare(
        `INSERT INTO greenfield_memory_records (
           memory_id, stable_owner_hash, memory_class, temporal_status,
           privacy_zone, confidence, salience, observed_at, valid_from,
           valid_until, content_hash, created_by_trace_id, created_at,
           modified_at, encryption_key_id, record_hash, ciphertext,
           initialization_vector, authentication_tag
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.memoryId,
        input.stableOwnerHash,
        publicRow.memory_class,
        publicRow.temporal_status,
        publicRow.privacy_zone,
        publicRow.confidence,
        publicRow.salience,
        publicRow.observed_at,
        publicRow.valid_from,
        publicRow.valid_until,
        publicRow.content_hash,
        publicRow.created_by_trace_id,
        publicRow.created_at,
        publicRow.modified_at,
        publicRow.encryption_key_id,
        recordHash,
        ciphertext,
        initializationVector,
        authenticationTag
      )
    this.insertSearchProjection(
      database,
      input.stableOwnerHash,
      input.ownerId,
      input.memoryId,
      payload.title,
      payload.content,
      input.createdAt
    )
    this.insertGraphProjection(
      database,
      input.stableOwnerHash,
      input.memoryId,
      payload,
      input.createdAt,
      input.createId
    )
    return this.decryptMemory(input.ownerId, {
      ...publicRow,
      record_hash: recordHash,
      ciphertext,
      initialization_vector: initializationVector,
      authentication_tag: authenticationTag
    })
  }

  private insertSearchProjection(
    database: DatabaseSync,
    stableOwnerHash: string,
    ownerId: string,
    memoryId: string,
    title: string,
    content: string,
    createdAt: number
  ): void {
    const indexKey = this.indexKey(ownerId)
    const weights = new Map<string, number>()
    for (const token of tokenize(content)) weights.set(token, 1)
    for (const token of tokenize(title)) weights.set(token, 2)
    const insert = database.prepare(
      `INSERT INTO greenfield_memory_search_terms (
         stable_owner_hash, memory_id, term_hash, term_weight, created_at
       ) VALUES (?, ?, ?, ?, ?)`
    )
    for (const [token, weight] of weights) {
      insert.run(
        stableOwnerHash,
        memoryId,
        keyedIdentifier(indexKey, 'term', token),
        weight,
        createdAt
      )
    }
  }

  private insertGraphProjection(
    database: DatabaseSync,
    stableOwnerHash: string,
    memoryId: string,
    payload: MemorySecretPayload,
    createdAt: number,
    createId: () => string
  ): void {
    const relations: Array<{
      relation: 'derived_from' | 'contradicts' | 'supersedes'
      targets: string[]
    }> = [
      { relation: 'derived_from', targets: payload.derivedFrom },
      { relation: 'contradicts', targets: payload.contradicts },
      { relation: 'supersedes', targets: payload.supersedes }
    ]
    const insert = database.prepare(
      `INSERT INTO greenfield_memory_graph_edges (
         edge_id, stable_owner_hash, source_memory_id, relation,
         target_memory_id, created_at, edge_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const { relation, targets } of relations) {
      for (const targetMemoryId of [...new Set(targets)]) {
        const edgeId = createId()
        const edgeHash = canonicalHash({
          edge_id: edgeId,
          stable_owner_hash: stableOwnerHash,
          source_memory_id: memoryId,
          relation,
          target_memory_id: targetMemoryId,
          created_at: createdAt
        })
        insert.run(
          edgeId,
          stableOwnerHash,
          memoryId,
          relation,
          targetMemoryId,
          createdAt,
          edgeHash
        )
      }
    }
  }

  private assertLinkedMemoriesOwned(
    database: DatabaseSync,
    stableOwnerHash: string,
    memoryIds: string[]
  ): void {
    const uniqueIds = [...new Set(memoryIds)]
    if (uniqueIds.length === 0) return
    const rows = this.readExactMemoryRows(database, stableOwnerHash, uniqueIds)
    if (rows.length !== uniqueIds.length) {
      throw new MemoryStoreError(
        'memory.lineage_invalid',
        'Every derivation, contradiction, and supersession link must reference an existing memory owned by the authenticated owner.',
        400
      )
    }
  }

  private readExactMemoryRows(
    database: DatabaseSync,
    stableOwnerHash: string,
    memoryIds: string[]
  ): MemoryRow[] {
    if (memoryIds.length === 0) return []
    const placeholders = memoryIds.map(() => '?').join(', ')
    const values: SQLInputValue[] = [stableOwnerHash, ...memoryIds]
    return database
      .prepare(
        `SELECT * FROM greenfield_memory_records
         WHERE stable_owner_hash = ? AND memory_id IN (${placeholders})`
      )
      .all(...values)
      .map((row) => mapMemoryRow(row as Record<string, unknown>))
  }

  private readPurgePlanRow(ownerId: string, planId: string): PurgePlanRow | null {
    const raw = this.ensureDatabase()
      .prepare(
        `SELECT * FROM greenfield_memory_purge_plans
         WHERE plan_id = ? AND stable_owner_hash = ? LIMIT 1`
      )
      .get(planId, this.stableOwnerHash(ownerId)) as
      | Record<string, unknown>
      | undefined
    return raw ? mapPurgePlanRow(raw) : null
  }

  private publicPurgePlan(ownerId: string, row: PurgePlanRow): MemoryPurgePlan {
    const aad = buildPurgePlanAAD({
      plan_id: row.plan_id,
      action_id: row.action_id,
      trace_id: row.trace_id,
      stable_owner_hash: row.stable_owner_hash,
      device_hash: row.device_hash,
      auth_session_hash: row.auth_session_hash,
      scope_hash: row.scope_hash,
      record_count: row.record_count,
      reason_code: row.reason_code,
      challenge_hash: row.challenge_hash,
      created_at: row.created_at,
      expires_at: row.expires_at,
      encryption_key_id: row.encryption_key_id
    })
    this.assertEncryptedHash(
      row.plan_hash,
      aad,
      row.ciphertext,
      row.initialization_vector,
      row.authentication_tag,
      'purge plan'
    )
    let payload: PurgePlanSecretPayload
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.ownerKey(ownerId),
        Buffer.from(row.initialization_vector)
      )
      decipher.setAAD(aad)
      decipher.setAuthTag(Buffer.from(row.authentication_tag))
      payload = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(row.ciphertext)),
          decipher.final()
        ]).toString('utf8')
      ) as PurgePlanSecretPayload
    } catch (error) {
      throw new MemoryStoreError(
        'memory.purge_plan_decryption_failed',
        'The memory purge plan could not be authenticated and decrypted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
    if (payload.ownerId !== ownerId) {
      throw new MemoryStoreError(
        'memory.purge_plan_owner_mismatch',
        'The memory purge plan does not belong to the authenticated owner.',
        403
      )
    }
    return {
      plan_id: row.plan_id,
      action_id: row.action_id,
      trace_id: row.trace_id,
      capability: MEMORY_PURGE_CAPABILITY,
      risk: 'critical',
      memory_ids: payload.memoryIds,
      record_hashes: payload.recordHashes,
      scope_hash: row.scope_hash,
      reason_code: payload.reasonCode,
      created_at: new Date(row.created_at).toISOString(),
      expires_at: new Date(row.expires_at).toISOString(),
      verification_criteria: payload.verificationCriteria,
      rollback_supported: false,
      rollback_limitations: payload.rollbackLimitations,
      plan_hash: row.plan_hash
    }
  }

  private assertPlanIdentity(row: PurgePlanRow, identity: IdentityContext): void {
    const deviceHash = keyedIdentifier(
      this.ensureMasterKey(),
      'device',
      identity.device_id
    )
    const sessionHash = keyedIdentifier(
      this.ensureMasterKey(),
      'session',
      identity.auth_session_id
    )
    if (row.device_hash !== deviceHash || row.auth_session_hash !== sessionHash) {
      throw new MemoryStoreError(
        'memory.purge_identity_mismatch',
        'The purge plan is bound to another authenticated session or device.',
        403
      )
    }
  }

  private findLinkedCandidateIds(
    ownerId: string,
    memoryIds: string[],
    database = this.ensureDatabase()
  ): string[] {
    const stableOwnerHash = this.stableOwnerHash(ownerId)
    const scope = new Set(memoryIds)
    const rows = database
      .prepare(
        `SELECT * FROM greenfield_memory_candidates
         WHERE stable_owner_hash = ?`
      )
      .all(stableOwnerHash)
      .map((row) => mapCandidateRow(row as Record<string, unknown>))
    const candidateIds: string[] = []
    for (const row of rows) {
      const payload = this.decryptCandidate(ownerId, row)
      const linked = [
        ...payload.derivationLinks,
        ...payload.contradictionLinks,
        ...payload.supersessionLinks
      ]
      if (linked.some((memoryId) => scope.has(memoryId))) {
        candidateIds.push(row.candidate_id)
      }
    }
    return candidateIds
  }

  private countScopedRows(
    database: DatabaseSync,
    tableName: 'greenfield_memory_records' | 'greenfield_memory_search_terms',
    idColumn: 'memory_id',
    stableOwnerHash: string,
    memoryIds: string[]
  ): number {
    if (memoryIds.length === 0) return 0
    const placeholders = memoryIds.map(() => '?').join(', ')
    const values: SQLInputValue[] = [stableOwnerHash, ...memoryIds]
    const row = database
      .prepare(
        `SELECT COUNT(*) AS count FROM ${tableName}
         WHERE stable_owner_hash = ? AND ${idColumn} IN (${placeholders})`
      )
      .get(...values) as Record<string, unknown> | undefined
    return row ? numberValue(row['count']) : 0
  }

  private countGraphScope(
    database: DatabaseSync,
    stableOwnerHash: string,
    memoryIds: string[]
  ): number {
    if (memoryIds.length === 0) return 0
    const placeholders = memoryIds.map(() => '?').join(', ')
    const values: SQLInputValue[] = [stableOwnerHash, ...memoryIds, ...memoryIds]
    const row = database
      .prepare(
        `SELECT COUNT(*) AS count FROM greenfield_memory_graph_edges
         WHERE stable_owner_hash = ?
           AND (source_memory_id IN (${placeholders})
                OR target_memory_id IN (${placeholders}))`
      )
      .get(...values) as Record<string, unknown> | undefined
    return row ? numberValue(row['count']) : 0
  }

  private recordFailedPurgeReceipt(
    database: DatabaseSync,
    row: PurgePlanRow,
    plan: MemoryPurgePlan,
    input: ExecuteMemoryPurgePlanInput,
    failureCode: string
  ): MemoryPurgeReceipt {
    const createId = input.createId || randomUUID
    const executedAt = input.executedAt.getTime()
    database.exec('BEGIN IMMEDIATE')
    try {
      const receipt = this.insertPurgeReceipt(database, {
        row,
        plan,
        executedAt,
        verifiedAt: executedAt,
        executionStatus: 'failed',
        verificationStatus: 'failed',
        evidenceRefs: [`memory-purge:failed:${failureCode}`],
        failureCode,
        createId
      })
      this.appendEvent(database, {
        stableOwnerHash: row.stable_owner_hash,
        traceId: row.trace_id,
        candidateId: null,
        memoryId: null,
        eventType: 'purge_failed',
        occurredAt: executedAt,
        metadata: {
          plan_id: row.plan_id,
          failure_code: failureCode,
          receipt_hash: receipt.receipt_hash
        },
        createId
      })
      database.exec('COMMIT')
      return receipt
    } catch (error) {
      database.exec('ROLLBACK')
      throw new MemoryStoreError(
        'memory.purge_failure_receipt_failed',
        'A failed purge could not persist its immutable failure receipt.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private insertPurgeReceipt(
    database: DatabaseSync,
    input: {
      row: PurgePlanRow
      plan: MemoryPurgePlan
      executedAt: number
      verifiedAt: number
      executionStatus: 'succeeded' | 'failed'
      verificationStatus: 'succeeded' | 'failed'
      evidenceRefs: string[]
      failureCode: string | null
      createId: () => string
    }
  ): MemoryPurgeReceipt {
    const receiptId = input.createId()
    const receiptHash = canonicalHash({
      receipt_id: receiptId,
      plan_id: input.row.plan_id,
      action_id: input.row.action_id,
      trace_id: input.row.trace_id,
      stable_owner_hash: input.row.stable_owner_hash,
      scope_hash: input.row.scope_hash,
      reason_code: input.plan.reason_code,
      record_count: input.plan.memory_ids.length,
      execution_status: input.executionStatus,
      verification_status: input.verificationStatus,
      verification_evidence_refs: input.evidenceRefs,
      executed_at: input.executedAt,
      verified_at: input.verifiedAt,
      failure_code: input.failureCode
    })
    database
      .prepare(
        `INSERT INTO greenfield_memory_purge_receipts (
           receipt_id, plan_id, action_id, trace_id, stable_owner_hash,
           scope_hash, reason_code, record_count, execution_status,
           verification_status, verification_evidence_refs_json,
           executed_at, verified_at, failure_code, receipt_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        receiptId,
        input.row.plan_id,
        input.row.action_id,
        input.row.trace_id,
        input.row.stable_owner_hash,
        input.row.scope_hash,
        input.plan.reason_code,
        input.plan.memory_ids.length,
        input.executionStatus,
        input.verificationStatus,
        JSON.stringify(input.evidenceRefs),
        input.executedAt,
        input.verifiedAt,
        input.failureCode,
        receiptHash
      )
    return {
      receipt_id: receiptId,
      plan_id: input.row.plan_id,
      action_id: input.row.action_id,
      trace_id: input.row.trace_id,
      scope_hash: input.row.scope_hash,
      reason_code: input.plan.reason_code,
      record_count: input.plan.memory_ids.length,
      execution_status: input.executionStatus,
      verification_status: input.verificationStatus,
      verification_evidence_refs: input.evidenceRefs,
      executed_at: new Date(input.executedAt).toISOString(),
      verified_at: new Date(input.verifiedAt).toISOString(),
      rollback_status: 'unavailable',
      failure_code: input.failureCode,
      receipt_hash: receiptHash
    }
  }

  private appendStandaloneEvent(input: {
    stableOwnerHash: string
    traceId: string
    eventType: MemoryEventType
    occurredAt: number
    metadata: unknown
  }): void {
    const database = this.ensureDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      this.appendEvent(database, {
        stableOwnerHash: input.stableOwnerHash,
        traceId: input.traceId,
        candidateId: null,
        memoryId: null,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        metadata: input.metadata
      })
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw new MemoryStoreError(
        'memory.event_append_failed',
        'The content-free memory event could not be persisted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private appendEvent(
    database: DatabaseSync,
    input: {
      stableOwnerHash: string
      traceId: string
      candidateId: string | null
      memoryId: string | null
      eventType: MemoryEventType
      occurredAt: number
      metadata: unknown
      createId?: () => string
    }
  ): void {
    const previous = database
      .prepare(
        `SELECT event_hash FROM greenfield_memory_events
         WHERE stable_owner_hash = ?
         ORDER BY rowid DESC LIMIT 1`
      )
      .get(input.stableOwnerHash) as Record<string, unknown> | undefined
    const previousEventHash = previous
      ? stringValue(previous['event_hash'])
      : null
    const eventId = (input.createId || randomUUID)()
    const metadataHash = canonicalHash(input.metadata)
    const eventHash = canonicalHash({
      event_id: eventId,
      stable_owner_hash: input.stableOwnerHash,
      trace_id: input.traceId,
      candidate_id: input.candidateId,
      memory_id: input.memoryId,
      event_type: input.eventType,
      occurred_at: input.occurredAt,
      metadata_hash: metadataHash,
      previous_event_hash: previousEventHash
    })
    database
      .prepare(
        `INSERT INTO greenfield_memory_events (
           event_id, stable_owner_hash, trace_id, candidate_id, memory_id,
           event_type, occurred_at, metadata_hash, previous_event_hash, event_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        eventId,
        input.stableOwnerHash,
        input.traceId,
        input.candidateId,
        input.memoryId,
        input.eventType,
        input.occurredAt,
        metadataHash,
        previousEventHash,
        eventHash
      )
  }

  private verifyOwnerEventChainByHash(
    database: DatabaseSync,
    stableOwnerHash: string
  ): MemoryEventChainVerification {
    const rows = database
      .prepare(
        `SELECT * FROM greenfield_memory_events
         WHERE stable_owner_hash = ?
         ORDER BY rowid ASC`
      )
      .all(stableOwnerHash)
      .map((row) => row as Record<string, unknown>)
    let previousEventHash: string | null = null
    for (const row of rows) {
      const eventId = stringValue(row['event_id'])
      if (nullableStringValue(row['previous_event_hash']) !== previousEventHash) {
        return {
          valid: false,
          eventCount: rows.length,
          issue: `Memory event ${eventId} has an invalid previous-event link.`
        }
      }
      const computed = canonicalHash({
        event_id: eventId,
        stable_owner_hash: stringValue(row['stable_owner_hash']),
        trace_id: stringValue(row['trace_id']),
        candidate_id: nullableStringValue(row['candidate_id']),
        memory_id: nullableStringValue(row['memory_id']),
        event_type: stringValue(row['event_type']),
        occurred_at: numberValue(row['occurred_at']),
        metadata_hash: stringValue(row['metadata_hash']),
        previous_event_hash: nullableStringValue(row['previous_event_hash'])
      })
      if (computed !== stringValue(row['event_hash'])) {
        return {
          valid: false,
          eventCount: rows.length,
          issue: `Memory event ${eventId} failed hash verification.`
        }
      }
      previousEventHash = computed
    }
    return { valid: true, eventCount: rows.length, issue: null }
  }

  private tryRestrictPermissions(targetPath: string, mode: number): void {
    try {
      fs.chmodSync(targetPath, mode)
    } catch {
      // Platforms without POSIX permission controls retain native safeguards.
    }
  }
}
