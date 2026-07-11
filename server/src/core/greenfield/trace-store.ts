import fs from 'node:fs'
import path from 'node:path'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomUUID
} from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import type { VerticalSliceEnvelope } from './contracts'
import { validateVerticalSliceEnvelope } from './validation'
import { TRACE_MIGRATIONS } from './trace-migrations'

const DAY_MS = 24 * 60 * 60 * 1_000
const TRACE_SCHEMA_VERSION = 1
const TRACE_ENCRYPTION_INFO = Buffer.from('mira-greenfield-trace-v1')

export interface EncryptedTraceStoreConfig {
  enabled: boolean
  databasePath: string
  masterKeyBase64: string
  retentionDays: number
}

export interface TracePersistenceReceipt {
  traceId: string
  recordHash: string
  previousRecordHash: string | null
  retentionUntil: string
  encryptionKeyId: string
  redactionStatus: 'session_redacted'
}

export interface TraceReadResult {
  envelope: VerticalSliceEnvelope
  persistence: TracePersistenceReceipt
}

export interface TracePurgeReceipt {
  receiptId: string
  ownerHash: string
  scopeHash: string
  reasonCode: string
  purgedAt: string
  recordCount: number
  purgedRecordHashes: string[]
  receiptHash: string
}

export interface TraceChainVerification {
  valid: boolean
  recordCount: number
  issue: string | null
}

export class TraceStoreError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'TraceStoreError'
  }
}

interface TraceRecordRow {
  trace_id: string
  owner_hash: string
  device_hash: string
  origin_event_id: string
  event_type: string
  occurred_at: number
  completed_at: number
  privacy_classification: string
  previous_record_hash: string | null
  record_hash: string
  retention_until: number
  redaction_status: 'session_redacted'
  encryption_key_id: string
  ciphertext: Uint8Array
  initialization_vector: Uint8Array
  authentication_tag: Uint8Array
  created_at: number
}

function parseRetentionDays(value: string | undefined): number {
  const parsed = Number(value || 30)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3_650) {
    return 30
  }
  return parsed
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function decodeMasterKey(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== 32) {
    throw new TraceStoreError(
      'trace.master_key_invalid',
      'MIRA_GREENFIELD_TRACE_MASTER_KEY must be a base64-encoded 32-byte key.',
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
      TRACE_ENCRYPTION_INFO,
      32
    )
  )
}

function keyedIdentifier(masterKey: Buffer, kind: string, value: string): string {
  return createHmac('sha256', masterKey)
    .update(`${kind}:${value}`)
    .digest('hex')
}

function redactSessionReference(value: string): string {
  return `redacted:session:${sha256(value).slice(0, 24)}`
}

function redactEnvelope(
  envelope: VerticalSliceEnvelope
): VerticalSliceEnvelope {
  const redacted = JSON.parse(JSON.stringify(envelope)) as VerticalSliceEnvelope
  redacted.identity.auth_session_id = redactSessionReference(
    redacted.identity.auth_session_id
  )

  if (redacted.action) {
    redacted.action.auth_session_id = redactSessionReference(
      redacted.action.auth_session_id
    )
  }

  if (redacted.approval) {
    redacted.approval.auth_session_id = redactSessionReference(
      redacted.approval.auth_session_id
    )
  }

  return redacted
}

function numberValue(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value)
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
  throw new TraceStoreError(
    'trace.storage_corrupt',
    'Encrypted trace storage contains an invalid binary value.',
    500
  )
}

function mapTraceRow(row: Record<string, unknown>): TraceRecordRow {
  return {
    trace_id: stringValue(row['trace_id']),
    owner_hash: stringValue(row['owner_hash']),
    device_hash: stringValue(row['device_hash']),
    origin_event_id: stringValue(row['origin_event_id']),
    event_type: stringValue(row['event_type']),
    occurred_at: numberValue(row['occurred_at']),
    completed_at: numberValue(row['completed_at']),
    privacy_classification: stringValue(row['privacy_classification']),
    previous_record_hash: nullableStringValue(row['previous_record_hash']),
    record_hash: stringValue(row['record_hash']),
    retention_until: numberValue(row['retention_until']),
    redaction_status: 'session_redacted',
    encryption_key_id: stringValue(row['encryption_key_id']),
    ciphertext: bytesValue(row['ciphertext']),
    initialization_vector: bytesValue(row['initialization_vector']),
    authentication_tag: bytesValue(row['authentication_tag']),
    created_at: numberValue(row['created_at'])
  }
}

function mapPurgeReceipt(row: Record<string, unknown>): TracePurgeReceipt {
  const hashes = JSON.parse(
    stringValue(row['purged_record_hashes_json']) || '[]'
  ) as unknown

  return {
    receiptId: stringValue(row['receipt_id']),
    ownerHash: stringValue(row['owner_hash']),
    scopeHash: stringValue(row['scope_hash']),
    reasonCode: stringValue(row['reason_code']),
    purgedAt: new Date(numberValue(row['purged_at'])).toISOString(),
    recordCount: numberValue(row['record_count']),
    purgedRecordHashes: Array.isArray(hashes)
      ? hashes.map((value) => String(value))
      : [],
    receiptHash: stringValue(row['receipt_hash'])
  }
}

function buildAdditionalAuthenticatedData(input: {
  traceId: string
  ownerHash: string
  deviceHash: string
  originEventId: string
  eventType: string
  occurredAt: number
  completedAt: number
  privacyClassification: string
  previousRecordHash: string | null
  retentionUntil: number
  encryptionKeyId: string
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      schema_version: TRACE_SCHEMA_VERSION,
      trace_id: input.traceId,
      owner_hash: input.ownerHash,
      device_hash: input.deviceHash,
      origin_event_id: input.originEventId,
      event_type: input.eventType,
      occurred_at: input.occurredAt,
      completed_at: input.completedAt,
      privacy_classification: input.privacyClassification,
      previous_record_hash: input.previousRecordHash,
      retention_until: input.retentionUntil,
      encryption_key_id: input.encryptionKeyId
    })
  )
}

function computeRecordHash(input: {
  additionalAuthenticatedData: Buffer
  ciphertext: Uint8Array
  initializationVector: Uint8Array
  authenticationTag: Uint8Array
}): string {
  return sha256(
    Buffer.concat([
      input.additionalAuthenticatedData,
      Buffer.from(input.initializationVector),
      Buffer.from(input.authenticationTag),
      Buffer.from(input.ciphertext)
    ])
  )
}

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new TraceStoreError(
      'trace.timestamp_invalid',
      `Trace field ${field} is not a valid timestamp.`,
      500
    )
  }
  return parsed
}

export class EncryptedSqliteTraceStore {
  private database: DatabaseSync | null = null
  private masterKey: Buffer | null = null

  public constructor(private readonly config: EncryptedTraceStoreConfig) {}

  public static fromProcessEnv(
    env: NodeJS.ProcessEnv = process.env
  ): EncryptedSqliteTraceStore {
    return new EncryptedSqliteTraceStore({
      enabled: env['MIRA_GREENFIELD_TRACE_PERSISTENCE'] === 'true',
      databasePath:
        env['MIRA_GREENFIELD_TRACE_DB_PATH'] ||
        path.join(
          process.cwd(),
          'core',
          'data',
          'greenfield',
          'traces.sqlite'
        ),
      masterKeyBase64: env['MIRA_GREENFIELD_TRACE_MASTER_KEY'] || '',
      retentionDays: parseRetentionDays(
        env['MIRA_GREENFIELD_TRACE_RETENTION_DAYS']
      )
    })
  }

  public get databasePath(): string {
    return this.config.databasePath
  }

  public async append(
    envelope: VerticalSliceEnvelope
  ): Promise<TracePersistenceReceipt> {
    const database = this.ensureDatabase()
    const referenceTime = new Date(envelope.response.created_at)
    const validation = validateVerticalSliceEnvelope(envelope, referenceTime)
    if (!validation.valid) {
      throw new TraceStoreError(
        'trace.envelope_invalid',
        'Only a valid causal envelope can be persisted.',
        500,
        validation.issues
      )
    }

    const masterKey = this.ensureMasterKey()
    const redactedEnvelope = redactEnvelope(validation.envelope)
    const redactedValidation = validateVerticalSliceEnvelope(
      redactedEnvelope,
      referenceTime
    )
    if (!redactedValidation.valid) {
      throw new TraceStoreError(
        'trace.redaction_invalid',
        'Trace redaction produced an invalid causal envelope.',
        500,
        redactedValidation.issues
      )
    }

    const ownerId = redactedEnvelope.identity.owner_id
    const deviceId = redactedEnvelope.identity.device_id
    const ownerHash = keyedIdentifier(masterKey, 'owner', ownerId)
    const deviceHash = keyedIdentifier(masterKey, 'device', deviceId)
    const ownerKey = deriveOwnerKey(masterKey, ownerId)
    const encryptionKeyId = sha256(masterKey).slice(0, 16)
    const occurredAt = parseTimestamp(
      redactedEnvelope.origin.occurred_at,
      'origin.occurred_at'
    )
    const completedAt = parseTimestamp(
      redactedEnvelope.response.created_at,
      'response.created_at'
    )
    const retentionUntil =
      completedAt + this.config.retentionDays * DAY_MS
    const createdAt = Date.now()

    database.exec('BEGIN IMMEDIATE')
    try {
      const existing = database
        .prepare(
          `SELECT trace_id FROM greenfield_trace_records
           WHERE trace_id = ? OR origin_event_id = ?
           LIMIT 1`
        )
        .get(
          redactedEnvelope.origin.trace_id,
          redactedEnvelope.origin.event_id
        )

      if (existing) {
        throw new TraceStoreError(
          'trace.duplicate',
          'The trace or origin event has already been persisted.',
          409
        )
      }

      const previousRow = database
        .prepare(
          `SELECT record_hash FROM greenfield_trace_records
           WHERE owner_hash = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT 1`
        )
        .get(ownerHash) as Record<string, unknown> | undefined
      const previousRecordHash = previousRow
        ? stringValue(previousRow['record_hash'])
        : null

      const additionalAuthenticatedData = buildAdditionalAuthenticatedData({
        traceId: redactedEnvelope.origin.trace_id,
        ownerHash,
        deviceHash,
        originEventId: redactedEnvelope.origin.event_id,
        eventType: redactedEnvelope.origin.event_type,
        occurredAt,
        completedAt,
        privacyClassification:
          redactedEnvelope.origin.privacy_classification,
        previousRecordHash,
        retentionUntil,
        encryptionKeyId
      })
      const initializationVector = randomBytes(12)
      const cipher = createCipheriv(
        'aes-256-gcm',
        ownerKey,
        initializationVector
      )
      cipher.setAAD(additionalAuthenticatedData)
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(redactedEnvelope), 'utf8'),
        cipher.final()
      ])
      const authenticationTag = cipher.getAuthTag()
      const recordHash = computeRecordHash({
        additionalAuthenticatedData,
        ciphertext,
        initializationVector,
        authenticationTag
      })

      database
        .prepare(
          `INSERT INTO greenfield_trace_records (
             trace_id, owner_hash, device_hash, origin_event_id,
             event_type, occurred_at, completed_at, privacy_classification,
             previous_record_hash, record_hash, retention_until,
             redaction_status, encryption_key_id, ciphertext,
             initialization_vector, authentication_tag, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          redactedEnvelope.origin.trace_id,
          ownerHash,
          deviceHash,
          redactedEnvelope.origin.event_id,
          redactedEnvelope.origin.event_type,
          occurredAt,
          completedAt,
          redactedEnvelope.origin.privacy_classification,
          previousRecordHash,
          recordHash,
          retentionUntil,
          'session_redacted',
          encryptionKeyId,
          ciphertext,
          initializationVector,
          authenticationTag,
          createdAt
        )

      database.exec('COMMIT')

      return {
        traceId: redactedEnvelope.origin.trace_id,
        recordHash,
        previousRecordHash,
        retentionUntil: new Date(retentionUntil).toISOString(),
        encryptionKeyId,
        redactionStatus: 'session_redacted'
      }
    } catch (error) {
      database.exec('ROLLBACK')
      if (error instanceof TraceStoreError) {
        throw error
      }
      throw new TraceStoreError(
        'trace.append_failed',
        'The encrypted trace could not be persisted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  public async read(
    ownerId: string,
    traceId: string
  ): Promise<TraceReadResult | null> {
    const database = this.ensureDatabase()
    const masterKey = this.ensureMasterKey()
    const ownerHash = keyedIdentifier(masterKey, 'owner', ownerId)
    const raw = database
      .prepare(
        `SELECT * FROM greenfield_trace_records
         WHERE trace_id = ? AND owner_hash = ?
         LIMIT 1`
      )
      .get(traceId, ownerHash) as Record<string, unknown> | undefined

    if (!raw) {
      return null
    }

    const row = mapTraceRow(raw)
    const additionalAuthenticatedData = this.buildRowAAD(row)
    const computedHash = computeRecordHash({
      additionalAuthenticatedData,
      ciphertext: row.ciphertext,
      initializationVector: row.initialization_vector,
      authenticationTag: row.authentication_tag
    })
    if (computedHash !== row.record_hash) {
      throw new TraceStoreError(
        'trace.integrity_failed',
        'The persisted trace record hash does not match its contents.',
        500
      )
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveOwnerKey(masterKey, ownerId),
      Buffer.from(row.initialization_vector)
    )
    decipher.setAAD(additionalAuthenticatedData)
    decipher.setAuthTag(Buffer.from(row.authentication_tag))

    let envelope: VerticalSliceEnvelope
    try {
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(row.ciphertext)),
        decipher.final()
      ]).toString('utf8')
      envelope = JSON.parse(plaintext) as VerticalSliceEnvelope
    } catch (error) {
      throw new TraceStoreError(
        'trace.decryption_failed',
        'The persisted trace could not be authenticated and decrypted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }

    if (
      envelope.identity.owner_id !== ownerId ||
      envelope.origin.trace_id !== traceId
    ) {
      throw new TraceStoreError(
        'trace.identity_mismatch',
        'The decrypted trace does not match the requested owner and trace.',
        500
      )
    }

    const validation = validateVerticalSliceEnvelope(
      envelope,
      new Date(envelope.response.created_at)
    )
    if (!validation.valid) {
      throw new TraceStoreError(
        'trace.persisted_envelope_invalid',
        'The decrypted trace envelope no longer satisfies its contract.',
        500,
        validation.issues
      )
    }

    return {
      envelope: validation.envelope,
      persistence: {
        traceId: row.trace_id,
        recordHash: row.record_hash,
        previousRecordHash: row.previous_record_hash,
        retentionUntil: new Date(row.retention_until).toISOString(),
        encryptionKeyId: row.encryption_key_id,
        redactionStatus: row.redaction_status
      }
    }
  }

  public async countOwnerTraces(ownerId: string): Promise<number> {
    const database = this.ensureDatabase()
    const ownerHash = keyedIdentifier(this.ensureMasterKey(), 'owner', ownerId)
    const row = database
      .prepare(
        `SELECT COUNT(*) AS count FROM greenfield_trace_records
         WHERE owner_hash = ?`
      )
      .get(ownerHash) as Record<string, unknown> | undefined
    return row ? numberValue(row['count']) : 0
  }

  public async verifyOwnerChain(
    ownerId: string
  ): Promise<TraceChainVerification> {
    const database = this.ensureDatabase()
    const ownerHash = keyedIdentifier(this.ensureMasterKey(), 'owner', ownerId)
    const rows = database
      .prepare(
        `SELECT * FROM greenfield_trace_records
         WHERE owner_hash = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(ownerHash)
      .map((row) => mapTraceRow(row as Record<string, unknown>))
    const purgedHashes = this.getPurgedRecordHashSet(ownerHash)
    let previousExistingHash: string | null = null

    for (const row of rows) {
      const expectedPrevious = row.previous_record_hash
      if (
        expectedPrevious !== previousExistingHash &&
        !(expectedPrevious && purgedHashes.has(expectedPrevious))
      ) {
        return {
          valid: false,
          recordCount: rows.length,
          issue: `Trace ${row.trace_id} has an invalid previous-record link.`
        }
      }

      const computedHash = computeRecordHash({
        additionalAuthenticatedData: this.buildRowAAD(row),
        ciphertext: row.ciphertext,
        initializationVector: row.initialization_vector,
        authenticationTag: row.authentication_tag
      })
      if (computedHash !== row.record_hash) {
        return {
          valid: false,
          recordCount: rows.length,
          issue: `Trace ${row.trace_id} failed record-hash verification.`
        }
      }

      previousExistingHash = row.record_hash
    }

    return {
      valid: true,
      recordCount: rows.length,
      issue: null
    }
  }

  public async purgeOwnerTraces(
    ownerId: string,
    traceIds: string[] | null,
    reasonCode: string,
    purgedAt = new Date()
  ): Promise<TracePurgeReceipt | null> {
    const masterKey = this.ensureMasterKey()
    const ownerHash = keyedIdentifier(masterKey, 'owner', ownerId)
    const database = this.ensureDatabase()
    const rows = this.selectRowsForPurge(database, ownerHash, traceIds)
    return this.purgeRows(database, ownerHash, rows, reasonCode, purgedAt)
  }

  public async purgeExpired(
    referenceTime = new Date()
  ): Promise<TracePurgeReceipt[]> {
    const database = this.ensureDatabase()
    const expiredRows = database
      .prepare(
        `SELECT * FROM greenfield_trace_records
         WHERE retention_until <= ?
         ORDER BY owner_hash ASC, created_at ASC, rowid ASC`
      )
      .all(referenceTime.getTime())
      .map((row) => mapTraceRow(row as Record<string, unknown>))
    const byOwner = new Map<string, TraceRecordRow[]>()

    for (const row of expiredRows) {
      const ownerRows = byOwner.get(row.owner_hash) || []
      ownerRows.push(row)
      byOwner.set(row.owner_hash, ownerRows)
    }

    const receipts: TracePurgeReceipt[] = []
    for (const [ownerHash, rows] of byOwner.entries()) {
      const receipt = this.purgeRows(
        database,
        ownerHash,
        rows,
        'retention_expired',
        referenceTime
      )
      if (receipt) {
        receipts.push(receipt)
      }
    }

    return receipts
  }

  public async listPurgeReceipts(
    ownerId: string
  ): Promise<TracePurgeReceipt[]> {
    const database = this.ensureDatabase()
    const ownerHash = keyedIdentifier(this.ensureMasterKey(), 'owner', ownerId)
    return database
      .prepare(
        `SELECT * FROM greenfield_trace_purge_receipts
         WHERE owner_hash = ?
         ORDER BY purged_at DESC, rowid DESC`
      )
      .all(ownerHash)
      .map((row) => mapPurgeReceipt(row as Record<string, unknown>))
  }

  public getAppliedMigrationVersions(): number[] {
    const database = this.ensureDatabase()
    return database
      .prepare(
        `SELECT version FROM greenfield_trace_schema_migrations
         ORDER BY version ASC`
      )
      .all()
      .map((row) => numberValue((row as Record<string, unknown>)['version']))
  }

  public close(): void {
    this.database?.close()
    this.database = null
    this.masterKey = null
  }

  private ensureDatabase(): DatabaseSync {
    if (!this.config.enabled) {
      throw new TraceStoreError(
        'trace.persistence_disabled',
        'Durable greenfield trace persistence is disabled.',
        503
      )
    }

    if (this.database) {
      return this.database
    }

    this.masterKey = decodeMasterKey(this.config.masterKeyBase64)
    const isMemoryDatabase = this.config.databasePath === ':memory:'
    if (!isMemoryDatabase) {
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

    if (!isMemoryDatabase) {
      this.tryRestrictPermissions(this.config.databasePath, 0o600)
    }

    return database
  }

  private ensureMasterKey(): Buffer {
    this.ensureDatabase()
    if (!this.masterKey) {
      throw new TraceStoreError(
        'trace.master_key_unavailable',
        'The trace encryption key is unavailable.',
        503
      )
    }
    return this.masterKey
  }

  private applyMigrations(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS greenfield_trace_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `)

    const rows = database
      .prepare('SELECT version FROM greenfield_trace_schema_migrations')
      .all()
    const applied = new Set(
      rows.map((row) =>
        numberValue((row as Record<string, unknown>)['version'])
      )
    )

    for (const migration of TRACE_MIGRATIONS) {
      if (applied.has(migration.version)) {
        continue
      }

      database.exec('BEGIN IMMEDIATE')
      try {
        database.exec(migration.sql)
        database
          .prepare(
            `INSERT INTO greenfield_trace_schema_migrations
             (version, name, applied_at) VALUES (?, ?, ?)`
          )
          .run(migration.version, migration.name, Date.now())
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw new TraceStoreError(
          'trace.migration_failed',
          `Trace migration ${migration.version} failed.`,
          500,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
  }

  private buildRowAAD(row: TraceRecordRow): Buffer {
    return buildAdditionalAuthenticatedData({
      traceId: row.trace_id,
      ownerHash: row.owner_hash,
      deviceHash: row.device_hash,
      originEventId: row.origin_event_id,
      eventType: row.event_type,
      occurredAt: row.occurred_at,
      completedAt: row.completed_at,
      privacyClassification: row.privacy_classification,
      previousRecordHash: row.previous_record_hash,
      retentionUntil: row.retention_until,
      encryptionKeyId: row.encryption_key_id
    })
  }

  private selectRowsForPurge(
    database: DatabaseSync,
    ownerHash: string,
    traceIds: string[] | null
  ): TraceRecordRow[] {
    if (traceIds && traceIds.length === 0) {
      return []
    }

    if (!traceIds) {
      return database
        .prepare(
          `SELECT * FROM greenfield_trace_records
           WHERE owner_hash = ?
           ORDER BY created_at ASC, rowid ASC`
        )
        .all(ownerHash)
        .map((row) => mapTraceRow(row as Record<string, unknown>))
    }

    const uniqueTraceIds = [...new Set(traceIds)]
    const placeholders = uniqueTraceIds.map(() => '?').join(',')
    return database
      .prepare(
        `SELECT * FROM greenfield_trace_records
         WHERE owner_hash = ? AND trace_id IN (${placeholders})
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(ownerHash, ...uniqueTraceIds)
      .map((row) => mapTraceRow(row as Record<string, unknown>))
  }

  private purgeRows(
    database: DatabaseSync,
    ownerHash: string,
    rows: TraceRecordRow[],
    reasonCode: string,
    purgedAt: Date
  ): TracePurgeReceipt | null {
    if (rows.length === 0) {
      return null
    }

    const traceIds = rows.map((row) => row.trace_id).sort()
    const recordHashes = rows.map((row) => row.record_hash).sort()
    const scopeHash = sha256(traceIds.join('\n'))
    const receiptId = randomUUID()
    const purgedAtTimestamp = purgedAt.getTime()
    const receiptHash = sha256(
      JSON.stringify({
        receipt_id: receiptId,
        owner_hash: ownerHash,
        scope_hash: scopeHash,
        reason_code: reasonCode,
        purged_at: purgedAtTimestamp,
        record_count: rows.length,
        purged_record_hashes: recordHashes
      })
    )

    database.exec('BEGIN IMMEDIATE')
    try {
      const deleteStatement = database.prepare(
        `DELETE FROM greenfield_trace_records
         WHERE trace_id = ? AND owner_hash = ?`
      )
      for (const row of rows) {
        deleteStatement.run(row.trace_id, ownerHash)
      }

      database
        .prepare(
          `INSERT INTO greenfield_trace_purge_receipts (
             receipt_id, owner_hash, scope_hash, reason_code, purged_at,
             record_count, purged_record_hashes_json, receipt_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          receiptId,
          ownerHash,
          scopeHash,
          reasonCode,
          purgedAtTimestamp,
          rows.length,
          JSON.stringify(recordHashes),
          receiptHash
        )
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw new TraceStoreError(
        'trace.purge_failed',
        'The selected trace records could not be physically purged.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }

    database.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    database.exec('VACUUM;')

    return {
      receiptId,
      ownerHash,
      scopeHash,
      reasonCode,
      purgedAt: purgedAt.toISOString(),
      recordCount: rows.length,
      purgedRecordHashes: recordHashes,
      receiptHash
    }
  }

  private getPurgedRecordHashSet(ownerHash: string): Set<string> {
    const database = this.ensureDatabase()
    const rows = database
      .prepare(
        `SELECT purged_record_hashes_json
         FROM greenfield_trace_purge_receipts
         WHERE owner_hash = ?`
      )
      .all(ownerHash) as Array<Record<string, unknown>>
    const hashes = new Set<string>()

    for (const row of rows) {
      try {
        const parsed = JSON.parse(
          stringValue(row['purged_record_hashes_json']) || '[]'
        ) as unknown
        if (Array.isArray(parsed)) {
          for (const value of parsed) {
            hashes.add(String(value))
          }
        }
      } catch {
        return new Set()
      }
    }

    return hashes
  }

  private tryRestrictPermissions(targetPath: string, mode: number): void {
    try {
      fs.chmodSync(targetPath, mode)
    } catch {
      // Windows and restricted filesystems may not support POSIX modes.
    }
  }
}
