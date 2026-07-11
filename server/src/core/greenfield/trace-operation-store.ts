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
import { DatabaseSync } from 'node:sqlite'

import type { IdentityContext } from './contracts'
import {
  TRACE_EXPORT_CAPABILITY,
  TRACE_PURGE_CAPABILITY,
  type TraceOperation,
  type TraceOperationApproval,
  type TraceOperationAuditEvent,
  type TraceOperationPlan,
  type TraceOperationReceipt
} from './trace-operation-contracts'
import { TRACE_OPERATION_MIGRATIONS } from './trace-operation-migrations'

const OPERATION_ENCRYPTION_INFO = Buffer.from(
  'mira-greenfield-trace-operation-v1'
)

export interface TraceOperationStoreConfig {
  enabled: boolean
  databasePath: string
  masterKeyBase64: string
  planTtlSeconds: number
}

interface PlanSecretPayload {
  ownerId: string
  deviceId: string
  authSessionId: string
  traceIds: string[]
  recordHashes: string[]
  reasonCode: string
}

interface PlanRow {
  plan_id: string
  action_id: string
  trace_id: string
  owner_hash: string
  device_hash: string
  auth_session_hash: string
  operation: TraceOperation
  capability: typeof TRACE_EXPORT_CAPABILITY | typeof TRACE_PURGE_CAPABILITY
  risk: 'high' | 'critical'
  scope_hash: string
  trace_count: number
  created_at: number
  expires_at: number
  challenge_hash: string
  plan_hash: string
  ciphertext: Uint8Array
  initialization_vector: Uint8Array
  authentication_tag: Uint8Array
}

export interface StoredTraceOperationPlan {
  plan: TraceOperationPlan
  ownerHash: string
  deviceHash: string
  authSessionHash: string
  challengeHash: string
  traceIds: string[]
  recordHashes: string[]
}

export interface CreateTraceOperationPlanInput {
  identity: IdentityContext
  operation: TraceOperation
  traceIds: string[]
  recordHashes: string[]
  reasonCode: string
  createdAt: Date
  createId?: () => string
}

export interface RecordTraceOperationReceiptInput {
  plan: StoredTraceOperationPlan
  approval: TraceOperationApproval
  executionStatus: 'succeeded' | 'failed' | 'cancelled'
  verificationStatus: 'succeeded' | 'failed'
  verificationEvidenceRefs: string[]
  outputHash: string | null
  purgeReceiptId: string | null
  executedAt: Date
  verifiedAt: Date
  failureCode: string | null
  createId?: () => string
}

export class TraceOperationStoreError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'TraceOperationStoreError'
  }
}

function parsePlanTtlSeconds(value: string | undefined): number {
  const parsed = Number(value || 300)
  if (!Number.isInteger(parsed) || parsed < 60 || parsed > 1_800) {
    return 300
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

export function canonicalHash(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)))
}

function decodeMasterKey(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== 32) {
    throw new TraceOperationStoreError(
      'trace_operation.master_key_invalid',
      'Trace operations require the same base64-encoded 32-byte trace master key.',
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
      OPERATION_ENCRYPTION_INFO,
      32
    )
  )
}

function keyedIdentifier(masterKey: Buffer, kind: string, value: string): string {
  return createHmac('sha256', masterKey)
    .update(`${kind}:${value}`)
    .digest('hex')
}

function reference(kind: string, hash: string): string {
  return `${kind}:${hash.slice(0, 24)}`
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
  throw new TraceOperationStoreError(
    'trace_operation.storage_corrupt',
    'Trace operation storage contains an invalid binary value.',
    500
  )
}

function mapPlanRow(row: Record<string, unknown>): PlanRow {
  return {
    plan_id: stringValue(row['plan_id']),
    action_id: stringValue(row['action_id']),
    trace_id: stringValue(row['trace_id']),
    owner_hash: stringValue(row['owner_hash']),
    device_hash: stringValue(row['device_hash']),
    auth_session_hash: stringValue(row['auth_session_hash']),
    operation: stringValue(row['operation']) as TraceOperation,
    capability: stringValue(row['capability']) as
      | typeof TRACE_EXPORT_CAPABILITY
      | typeof TRACE_PURGE_CAPABILITY,
    risk: stringValue(row['risk']) as 'high' | 'critical',
    scope_hash: stringValue(row['scope_hash']),
    trace_count: numberValue(row['trace_count']),
    created_at: numberValue(row['created_at']),
    expires_at: numberValue(row['expires_at']),
    challenge_hash: stringValue(row['challenge_hash']),
    plan_hash: stringValue(row['plan_hash']),
    ciphertext: bytesValue(row['ciphertext']),
    initialization_vector: bytesValue(row['initialization_vector']),
    authentication_tag: bytesValue(row['authentication_tag'])
  }
}

function buildPlanAAD(
  row: Omit<
    PlanRow,
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
      owner_hash: row.owner_hash,
      device_hash: row.device_hash,
      auth_session_hash: row.auth_session_hash,
      operation: row.operation,
      capability: row.capability,
      risk: row.risk,
      scope_hash: row.scope_hash,
      trace_count: row.trace_count,
      created_at: row.created_at,
      expires_at: row.expires_at,
      challenge_hash: row.challenge_hash
    })
  )
}

function computePlanHash(
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

export class TraceOwnerOperationStore {
  private database: DatabaseSync | null = null
  private masterKey: Buffer | null = null

  public constructor(private readonly config: TraceOperationStoreConfig) {}

  public static fromProcessEnv(
    env: NodeJS.ProcessEnv = process.env
  ): TraceOwnerOperationStore {
    return new TraceOwnerOperationStore({
      enabled: env['MIRA_GREENFIELD_TRACE_OPERATIONS'] === 'true',
      databasePath:
        env['MIRA_GREENFIELD_TRACE_DB_PATH'] ||
        path.join(process.cwd(), 'core', 'data', 'greenfield', 'traces.sqlite'),
      masterKeyBase64: env['MIRA_GREENFIELD_TRACE_MASTER_KEY'] || '',
      planTtlSeconds: parsePlanTtlSeconds(
        env['MIRA_GREENFIELD_TRACE_OPERATION_TTL_SECONDS']
      )
    })
  }

  public createPlan(input: CreateTraceOperationPlanInput): {
    plan: StoredTraceOperationPlan
    approvalToken: string
  } {
    if (input.traceIds.length !== input.recordHashes.length) {
      throw new TraceOperationStoreError(
        'trace_operation.scope_invalid',
        'Trace IDs and record hashes must have the same length.',
        500
      )
    }

    const database = this.ensureDatabase()
    const masterKey = this.ensureMasterKey()
    const createId = input.createId || randomUUID
    const planId = createId()
    const actionId = createId()
    const traceId = createId()
    const ownerHash = keyedIdentifier(masterKey, 'owner', input.identity.owner_id)
    const deviceHash = keyedIdentifier(
      masterKey,
      'device',
      input.identity.device_id
    )
    const authSessionHash = keyedIdentifier(
      masterKey,
      'session',
      input.identity.auth_session_id
    )
    const capability:
      | typeof TRACE_EXPORT_CAPABILITY
      | typeof TRACE_PURGE_CAPABILITY =
      input.operation === 'export'
        ? TRACE_EXPORT_CAPABILITY
        : TRACE_PURGE_CAPABILITY
    const risk: 'high' | 'critical' =
      input.operation === 'export' ? 'high' : 'critical'
    const createdAt = input.createdAt.getTime()
    const expiresAt =
      createdAt + Math.max(60, this.config.planTtlSeconds) * 1_000
    const approvalToken = randomBytes(32).toString('base64url')
    const challengeHash = sha256(approvalToken)
    const scopeHash = canonicalHash({
      operation: input.operation,
      trace_ids: input.traceIds,
      record_hashes: input.recordHashes,
      reason_code: input.reasonCode
    })
    const payload: PlanSecretPayload = {
      ownerId: input.identity.owner_id,
      deviceId: input.identity.device_id,
      authSessionId: input.identity.auth_session_id,
      traceIds: input.traceIds,
      recordHashes: input.recordHashes,
      reasonCode: input.reasonCode
    }
    const baseRow = {
      plan_id: planId,
      action_id: actionId,
      trace_id: traceId,
      owner_hash: ownerHash,
      device_hash: deviceHash,
      auth_session_hash: authSessionHash,
      operation: input.operation,
      capability,
      risk,
      scope_hash: scopeHash,
      trace_count: input.traceIds.length,
      created_at: createdAt,
      expires_at: expiresAt,
      challenge_hash: challengeHash
    }
    const aad = buildPlanAAD(baseRow)
    const initializationVector = randomBytes(12)
    const cipher = createCipheriv(
      'aes-256-gcm',
      deriveOwnerKey(masterKey, input.identity.owner_id),
      initializationVector
    )
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final()
    ])
    const authenticationTag = cipher.getAuthTag()
    const planHash = computePlanHash(
      aad,
      ciphertext,
      initializationVector,
      authenticationTag
    )

    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare(
          `INSERT INTO greenfield_trace_operation_plans (
             plan_id, action_id, trace_id, owner_hash, device_hash,
             auth_session_hash, operation, capability, risk, scope_hash,
             trace_count, created_at, expires_at, challenge_hash, plan_hash,
             ciphertext, initialization_vector, authentication_tag
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          planId,
          actionId,
          traceId,
          ownerHash,
          deviceHash,
          authSessionHash,
          input.operation,
          capability,
          risk,
          scopeHash,
          input.traceIds.length,
          createdAt,
          expiresAt,
          challengeHash,
          planHash,
          ciphertext,
          initializationVector,
          authenticationTag
        )
      this.insertEvent(database, {
        traceId,
        planId,
        stage: 'plan',
        status: 'succeeded',
        occurredAt: input.createdAt,
        payloadHash: planHash,
        createId
      })
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw new TraceOperationStoreError(
        'trace_operation.plan_persist_failed',
        'The trace operation plan could not be persisted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }

    return {
      plan: this.toStoredPlan(
        {
          ...baseRow,
          plan_hash: planHash,
          ciphertext,
          initialization_vector: initializationVector,
          authentication_tag: authenticationTag
        },
        input.identity.owner_id
      ),
      approvalToken
    }
  }

  public readPlan(
    ownerId: string,
    planId: string
  ): StoredTraceOperationPlan | null {
    const database = this.ensureDatabase()
    const masterKey = this.ensureMasterKey()
    const ownerHash = keyedIdentifier(masterKey, 'owner', ownerId)
    const raw = database
      .prepare(
        `SELECT * FROM greenfield_trace_operation_plans
         WHERE plan_id = ? AND owner_hash = ?
         LIMIT 1`
      )
      .get(planId, ownerHash) as Record<string, unknown> | undefined

    return raw ? this.toStoredPlan(mapPlanRow(raw), ownerId) : null
  }

  public assertIdentity(
    plan: StoredTraceOperationPlan,
    identity: IdentityContext
  ): void {
    const masterKey = this.ensureMasterKey()
    const ownerHash = keyedIdentifier(masterKey, 'owner', identity.owner_id)
    const deviceHash = keyedIdentifier(masterKey, 'device', identity.device_id)
    const sessionHash = keyedIdentifier(
      masterKey,
      'session',
      identity.auth_session_id
    )

    if (
      ownerHash !== plan.ownerHash ||
      deviceHash !== plan.deviceHash ||
      sessionHash !== plan.authSessionHash
    ) {
      throw new TraceOperationStoreError(
        'trace_operation.identity_mismatch',
        'The operation plan does not match the authenticated owner, device, and session.',
        403
      )
    }
  }

  public recordApproval(input: {
    plan: StoredTraceOperationPlan
    identity: IdentityContext
    approvalToken: string
    decision: 'approved' | 'rejected'
    decidedAt: Date
    createId?: () => string
  }): TraceOperationApproval {
    this.assertIdentity(input.plan, input.identity)
    if (input.decidedAt.getTime() > Date.parse(input.plan.plan.expires_at)) {
      throw new TraceOperationStoreError(
        'trace_operation.plan_expired',
        'The trace operation plan has expired.',
        409
      )
    }
    if (!challengeMatches(input.approvalToken, input.plan.challengeHash)) {
      throw new TraceOperationStoreError(
        'trace_operation.approval_challenge_invalid',
        'The one-time approval challenge is invalid.',
        401
      )
    }

    const database = this.ensureDatabase()
    const createId = input.createId || randomUUID
    const approval: TraceOperationApproval = {
      approval_id: createId(),
      plan_id: input.plan.plan.plan_id,
      action_id: input.plan.plan.action_id,
      trace_id: input.plan.plan.trace_id,
      owner_ref: input.plan.plan.requested_by_owner_ref,
      device_ref: input.plan.plan.requested_by_device_ref,
      auth_session_ref: input.plan.plan.auth_session_ref,
      scope_hash: input.plan.plan.scope_hash,
      decision: input.decision,
      decided_at: input.decidedAt.toISOString()
    }
    const approvalHash = canonicalHash(approval)

    database.exec('BEGIN IMMEDIATE')
    try {
      database
        .prepare(
          `INSERT INTO greenfield_trace_operation_approvals (
             approval_id, plan_id, owner_hash, device_hash, auth_session_hash,
             scope_hash, decision, decided_at, approval_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          approval.approval_id,
          approval.plan_id,
          input.plan.ownerHash,
          input.plan.deviceHash,
          input.plan.authSessionHash,
          approval.scope_hash,
          approval.decision,
          input.decidedAt.getTime(),
          approvalHash
        )
      this.insertEvent(database, {
        traceId: approval.trace_id,
        planId: approval.plan_id,
        stage: 'approval',
        status: approval.decision,
        occurredAt: input.decidedAt,
        payloadHash: approvalHash,
        createId
      })
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      const existing = this.readApproval(input.plan.plan.plan_id)
      if (existing) {
        throw new TraceOperationStoreError(
          'trace_operation.approval_already_recorded',
          'An immutable approval decision already exists for this plan.',
          409,
          existing
        )
      }
      throw new TraceOperationStoreError(
        'trace_operation.approval_persist_failed',
        'The owner approval could not be persisted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }

    return approval
  }

  public readApproval(planId: string): TraceOperationApproval | null {
    const database = this.ensureDatabase()
    const raw = database
      .prepare(
        `SELECT a.*, p.action_id, p.trace_id
         FROM greenfield_trace_operation_approvals a
         JOIN greenfield_trace_operation_plans p ON p.plan_id = a.plan_id
         WHERE a.plan_id = ?
         LIMIT 1`
      )
      .get(planId) as Record<string, unknown> | undefined

    if (!raw) {
      return null
    }

    const approval: TraceOperationApproval = {
      approval_id: stringValue(raw['approval_id']),
      plan_id: stringValue(raw['plan_id']),
      action_id: stringValue(raw['action_id']),
      trace_id: stringValue(raw['trace_id']),
      owner_ref: reference('owner', stringValue(raw['owner_hash'])),
      device_ref: reference('device', stringValue(raw['device_hash'])),
      auth_session_ref: reference(
        'session',
        stringValue(raw['auth_session_hash'])
      ),
      scope_hash: stringValue(raw['scope_hash']),
      decision: stringValue(raw['decision']) as 'approved' | 'rejected',
      decided_at: new Date(numberValue(raw['decided_at'])).toISOString()
    }
    if (canonicalHash(approval) !== stringValue(raw['approval_hash'])) {
      throw new TraceOperationStoreError(
        'trace_operation.approval_integrity_failed',
        'The persisted approval failed integrity verification.',
        500
      )
    }
    return approval
  }

  public recordReceipt(
    input: RecordTraceOperationReceiptInput
  ): TraceOperationReceipt {
    const database = this.ensureDatabase()
    const createId = input.createId || randomUUID
    const unsigned = {
      receipt_id: createId(),
      plan_id: input.plan.plan.plan_id,
      action_id: input.plan.plan.action_id,
      trace_id: input.plan.plan.trace_id,
      operation: input.plan.plan.operation,
      requested_action: input.plan.plan.capability,
      actor_ref: input.plan.plan.requested_by_owner_ref,
      executor_ref: 'mira:trace-owner-operation-service:v1',
      approval_id: input.approval.approval_id,
      execution_status: input.executionStatus,
      verification_status: input.verificationStatus,
      verification_evidence_refs: input.verificationEvidenceRefs,
      output_hash: input.outputHash,
      purge_receipt_id: input.purgeReceiptId,
      record_count: input.plan.plan.trace_count,
      executed_at: input.executedAt.toISOString(),
      verified_at: input.verifiedAt.toISOString(),
      failure_code: input.failureCode
    }
    const receipt: TraceOperationReceipt = {
      ...unsigned,
      receipt_hash: canonicalHash(unsigned)
    }

    database.exec('BEGIN IMMEDIATE')
    try {
      this.insertEvent(database, {
        traceId: receipt.trace_id,
        planId: receipt.plan_id,
        stage: 'execution',
        status: receipt.execution_status === 'succeeded' ? 'succeeded' : 'failed',
        occurredAt: input.executedAt,
        payloadHash: input.outputHash || receipt.receipt_hash,
        createId
      })
      this.insertEvent(database, {
        traceId: receipt.trace_id,
        planId: receipt.plan_id,
        stage: 'verification',
        status:
          receipt.verification_status === 'succeeded' ? 'succeeded' : 'failed',
        occurredAt: input.verifiedAt,
        payloadHash: canonicalHash(receipt.verification_evidence_refs),
        createId
      })
      database
        .prepare(
          `INSERT INTO greenfield_trace_operation_receipts (
             receipt_id, plan_id, action_id, trace_id, owner_hash, operation,
             approval_id, execution_status, verification_status,
             verification_evidence_refs_json, output_hash, purge_receipt_id,
             record_count, executed_at, verified_at, failure_code, receipt_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          receipt.receipt_id,
          receipt.plan_id,
          receipt.action_id,
          receipt.trace_id,
          input.plan.ownerHash,
          receipt.operation,
          receipt.approval_id,
          receipt.execution_status,
          receipt.verification_status,
          JSON.stringify(receipt.verification_evidence_refs),
          receipt.output_hash,
          receipt.purge_receipt_id,
          receipt.record_count,
          input.executedAt.getTime(),
          input.verifiedAt.getTime(),
          receipt.failure_code,
          receipt.receipt_hash
        )
      this.insertEvent(database, {
        traceId: receipt.trace_id,
        planId: receipt.plan_id,
        stage: 'receipt',
        status:
          receipt.execution_status === 'succeeded' &&
          receipt.verification_status === 'succeeded'
            ? 'succeeded'
            : 'failed',
        occurredAt: input.verifiedAt,
        payloadHash: receipt.receipt_hash,
        createId
      })
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      const existing = this.readReceipt(input.plan.plan.plan_id)
      if (existing) {
        return existing
      }
      throw new TraceOperationStoreError(
        'trace_operation.receipt_persist_failed',
        'The verified operation receipt could not be persisted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }

    return receipt
  }

  public readReceipt(planId: string): TraceOperationReceipt | null {
    const database = this.ensureDatabase()
    const raw = database
      .prepare(
        `SELECT * FROM greenfield_trace_operation_receipts
         WHERE plan_id = ?
         LIMIT 1`
      )
      .get(planId) as Record<string, unknown> | undefined

    if (!raw) {
      return null
    }

    const receipt: TraceOperationReceipt = {
      receipt_id: stringValue(raw['receipt_id']),
      plan_id: stringValue(raw['plan_id']),
      action_id: stringValue(raw['action_id']),
      trace_id: stringValue(raw['trace_id']),
      operation: stringValue(raw['operation']) as TraceOperation,
      requested_action:
        stringValue(raw['operation']) === 'export'
          ? TRACE_EXPORT_CAPABILITY
          : TRACE_PURGE_CAPABILITY,
      actor_ref: reference('owner', stringValue(raw['owner_hash'])),
      executor_ref: 'mira:trace-owner-operation-service:v1',
      approval_id: stringValue(raw['approval_id']),
      execution_status: stringValue(raw['execution_status']) as
        | 'succeeded'
        | 'failed'
        | 'cancelled',
      verification_status: stringValue(raw['verification_status']) as
        | 'succeeded'
        | 'failed',
      verification_evidence_refs: parseJsonArray(
        raw['verification_evidence_refs_json']
      ),
      output_hash: nullableStringValue(raw['output_hash']),
      purge_receipt_id: nullableStringValue(raw['purge_receipt_id']),
      record_count: numberValue(raw['record_count']),
      executed_at: new Date(numberValue(raw['executed_at'])).toISOString(),
      verified_at: new Date(numberValue(raw['verified_at'])).toISOString(),
      failure_code: nullableStringValue(raw['failure_code']),
      receipt_hash: stringValue(raw['receipt_hash'])
    }
    const { receipt_hash: persistedHash, ...unsigned } = receipt
    if (
      canonicalHash(unsigned) !== persistedHash ||
      persistedHash !== stringValue(raw['receipt_hash'])
    ) {
      throw new TraceOperationStoreError(
        'trace_operation.receipt_integrity_failed',
        'The persisted operation receipt failed integrity verification.',
        500
      )
    }
    return receipt
  }

  public listEvents(planId: string): TraceOperationAuditEvent[] {
    const database = this.ensureDatabase()
    const rows = database
      .prepare(
        `SELECT * FROM greenfield_trace_operation_events
         WHERE plan_id = ?
         ORDER BY occurred_at ASC, rowid ASC`
      )
      .all(planId)
    const events: TraceOperationAuditEvent[] = []
    let previousEventId: string | null = null
    let previousEventHash: string | null = null

    for (const raw of rows) {
      const row = raw as Record<string, unknown>
      const event: TraceOperationAuditEvent = {
        event_id: stringValue(row['event_id']),
        trace_id: stringValue(row['trace_id']),
        parent_event_id: nullableStringValue(row['parent_event_id']),
        plan_id: stringValue(row['plan_id']),
        stage: stringValue(row['stage']) as TraceOperationAuditEvent['stage'],
        status: stringValue(row['status']) as TraceOperationAuditEvent['status'],
        occurred_at: new Date(numberValue(row['occurred_at'])).toISOString(),
        payload_hash: stringValue(row['payload_hash']),
        event_hash: stringValue(row['event_hash'])
      }
      const expectedHash = canonicalHash({
        event_id: event.event_id,
        trace_id: event.trace_id,
        parent_event_id: event.parent_event_id,
        previous_event_hash: previousEventHash,
        plan_id: event.plan_id,
        stage: event.stage,
        status: event.status,
        occurred_at: event.occurred_at,
        payload_hash: event.payload_hash
      })
      if (
        event.parent_event_id !== previousEventId ||
        event.event_hash !== expectedHash
      ) {
        throw new TraceOperationStoreError(
          'trace_operation.event_chain_invalid',
          'The trace operation causal event chain failed integrity verification.',
          500
        )
      }
      events.push(event)
      previousEventId = event.event_id
      previousEventHash = event.event_hash
    }

    return events
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

  private toStoredPlan(
    row: PlanRow,
    ownerId: string
  ): StoredTraceOperationPlan {
    const aad = buildPlanAAD(row)
    const computedHash = computePlanHash(
      aad,
      row.ciphertext,
      row.initialization_vector,
      row.authentication_tag
    )
    if (computedHash !== row.plan_hash) {
      throw new TraceOperationStoreError(
        'trace_operation.plan_integrity_failed',
        'The trace operation plan failed integrity verification.',
        500
      )
    }

    const masterKey = this.ensureMasterKey()
    let payload: PlanSecretPayload
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        deriveOwnerKey(masterKey, ownerId),
        Buffer.from(row.initialization_vector)
      )
      decipher.setAAD(aad)
      decipher.setAuthTag(Buffer.from(row.authentication_tag))
      payload = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(row.ciphertext)),
          decipher.final()
        ]).toString('utf8')
      ) as PlanSecretPayload
    } catch (error) {
      throw new TraceOperationStoreError(
        'trace_operation.plan_decryption_failed',
        'The trace operation plan could not be authenticated and decrypted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }

    if (
      payload.ownerId !== ownerId ||
      keyedIdentifier(masterKey, 'owner', payload.ownerId) !== row.owner_hash ||
      keyedIdentifier(masterKey, 'device', payload.deviceId) !== row.device_hash ||
      keyedIdentifier(masterKey, 'session', payload.authSessionId) !==
        row.auth_session_hash
    ) {
      throw new TraceOperationStoreError(
        'trace_operation.plan_identity_integrity_failed',
        'The encrypted operation identity does not match protected metadata.',
        500
      )
    }

    if (
      payload.traceIds.length !== row.trace_count ||
      payload.recordHashes.length !== row.trace_count
    ) {
      throw new TraceOperationStoreError(
        'trace_operation.plan_scope_corrupt',
        'The trace operation plan scope does not match its protected metadata.',
        500
      )
    }

    const scopeHash = canonicalHash({
      operation: row.operation,
      trace_ids: payload.traceIds,
      record_hashes: payload.recordHashes,
      reason_code: payload.reasonCode
    })
    if (scopeHash !== row.scope_hash) {
      throw new TraceOperationStoreError(
        'trace_operation.plan_scope_integrity_failed',
        'The trace operation scope hash does not match the decrypted plan.',
        500
      )
    }

    return {
      plan: {
        plan_id: row.plan_id,
        action_id: row.action_id,
        trace_id: row.trace_id,
        operation: row.operation,
        capability: row.capability,
        risk: row.risk,
        scope_hash: row.scope_hash,
        trace_count: row.trace_count,
        reason_code: payload.reasonCode,
        requested_by_owner_ref: reference('owner', row.owner_hash),
        requested_by_device_ref: reference('device', row.device_hash),
        auth_session_ref: reference('session', row.auth_session_hash),
        confirmation_required: true,
        verification_criteria:
          row.operation === 'export'
            ? [
                'Every exported trace and record hash matches the immutable plan.',
                'The owner hash chain remains valid.',
                'The exported bundle hash matches its contents.'
              ]
            : [
                'Every selected trace is physically absent after execution.',
                'The purge receipt contains the exact planned record hashes.',
                'The remaining owner hash chain remains valid.'
              ],
        rollback_supported: false,
        created_at: new Date(row.created_at).toISOString(),
        expires_at: new Date(row.expires_at).toISOString()
      },
      ownerHash: row.owner_hash,
      deviceHash: row.device_hash,
      authSessionHash: row.auth_session_hash,
      challengeHash: row.challenge_hash,
      traceIds: [...payload.traceIds],
      recordHashes: [...payload.recordHashes]
    }
  }

  private insertEvent(
    database: DatabaseSync,
    input: {
      traceId: string
      planId: string
      stage: TraceOperationAuditEvent['stage']
      status: TraceOperationAuditEvent['status']
      occurredAt: Date
      payloadHash: string
      createId: () => string
    }
  ): void {
    const previous = database
      .prepare(
        `SELECT event_id, event_hash FROM greenfield_trace_operation_events
         WHERE plan_id = ?
         ORDER BY occurred_at DESC, rowid DESC
         LIMIT 1`
      )
      .get(input.planId) as Record<string, unknown> | undefined
    const eventId = input.createId()
    const parentEventId = previous ? stringValue(previous['event_id']) : null
    const previousEventHash = previous ? stringValue(previous['event_hash']) : null
    const eventHash = canonicalHash({
      event_id: eventId,
      trace_id: input.traceId,
      parent_event_id: parentEventId,
      previous_event_hash: previousEventHash,
      plan_id: input.planId,
      stage: input.stage,
      status: input.status,
      occurred_at: input.occurredAt.toISOString(),
      payload_hash: input.payloadHash
    })

    database
      .prepare(
        `INSERT INTO greenfield_trace_operation_events (
           event_id, trace_id, parent_event_id, plan_id, stage, status,
           occurred_at, payload_hash, event_hash
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        eventId,
        input.traceId,
        parentEventId,
        input.planId,
        input.stage,
        input.status,
        input.occurredAt.getTime(),
        input.payloadHash,
        eventHash
      )
  }

  private ensureDatabase(): DatabaseSync {
    if (!this.config.enabled) {
      throw new TraceOperationStoreError(
        'trace_operation.disabled',
        'Owner-authorized trace operations are disabled.',
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
      throw new TraceOperationStoreError(
        'trace_operation.master_key_unavailable',
        'The trace operation encryption key is unavailable.',
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
    const applied = new Set(
      database
        .prepare('SELECT version FROM greenfield_trace_schema_migrations')
        .all()
        .map((row) =>
          numberValue((row as Record<string, unknown>)['version'])
        )
    )

    for (const migration of TRACE_OPERATION_MIGRATIONS) {
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
        throw new TraceOperationStoreError(
          'trace_operation.migration_failed',
          `Trace operation migration ${migration.version} failed.`,
          500,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
  }

  private tryRestrictPermissions(targetPath: string, mode: number): void {
    try {
      fs.chmodSync(targetPath, mode)
    } catch {
      // Platforms without POSIX permission support retain their native controls.
    }
  }
}
