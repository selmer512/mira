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

import type { IdentityContext } from './contracts'
import { evaluateIdentity } from './policy'
import { canonicalHash } from './trace-operation-store'
import { TRACE_KEY_MIGRATIONS } from './trace-key-migrations'
import {
  TraceReadKeyring,
  type TraceKeyringOwnerInventory
} from './trace-keyring'

export const TRACE_ROTATION_PLAN_CAPABILITY = 'trace.rotation.plan'

const ROTATION_PLAN_INFO = Buffer.from('mira-greenfield-rotation-plan-v1')
const KEY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export interface TraceRotationPlanConfig {
  enabled: boolean
  databasePath: string
  backupPath: string
  ownerLookupKeyBase64: string
  activeMasterKeyBase64: string
  activeKeyVersion: string
  keyringJson: string
  planTtlSeconds: number
  freeSpaceMultiplier: number
}

export interface TraceBackupEvidence {
  status: 'verified' | 'missing' | 'invalid' | 'not_configured'
  path_ref: string | null
  size_bytes: number | null
  integrity_check: string | null
  migration_versions: number[]
  trace_count: number | null
  operation_plan_count: number | null
  verified_at: string
  issue: string | null
}

export interface TraceRotationPlan {
  rotation_plan_id: string
  target_key_version: string
  target_encryption_key_id: string
  source_key_versions: string[]
  trace_count: number
  operation_plan_count: number
  trace_ids: string[]
  operation_plan_ids: string[]
  record_hashes: string[]
  estimated_rewrite_bytes: number
  required_free_bytes: number
  available_free_bytes: number | null
  backup: TraceBackupEvidence
  interruption_checkpoints: string[]
  verification_criteria: string[]
  rollback_limits: string[]
  blockers: string[]
  execution_supported: false
  ready_for_execution: false
  created_at: string
  expires_at: string
  plan_hash: string
}

export class TraceRotationPlanError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'TraceRotationPlanError'
  }
}

interface RotationPlanSecretPayload {
  ownerId: string
  traceIds: string[]
  operationPlanIds: string[]
  recordHashes: string[]
  sourceKeyVersions: string[]
  interruptionCheckpoints: string[]
  verificationCriteria: string[]
  rollbackLimits: string[]
  blockers: string[]
  backup: TraceBackupEvidence
}

interface RotationPlanRow {
  rotation_plan_id: string
  stable_owner_hash: string
  target_key_version: string
  target_encryption_key_id: string
  trace_count: number
  operation_plan_count: number
  estimated_rewrite_bytes: number
  required_free_bytes: number
  available_free_bytes: number | null
  backup_status: TraceBackupEvidence['status']
  created_at: number
  expires_at: number
  encryption_key_id: string
  plan_hash: string
  ciphertext: Uint8Array
  initialization_vector: Uint8Array
  authentication_tag: Uint8Array
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function decodeKey(value: string, variableName: string): Buffer {
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32) {
    throw new TraceRotationPlanError(
      'trace_rotation.key_invalid',
      `${variableName} must contain a base64-encoded 32-byte key.`,
      503
    )
  }
  return key
}

function validateKeyVersion(value: string): string {
  if (!KEY_VERSION_PATTERN.test(value)) {
    throw new TraceRotationPlanError(
      'trace_rotation.version_invalid',
      'The target trace key version must be a stable lowercase identifier.',
      400
    )
  }
  return value
}

function keyedIdentifier(key: Buffer, kind: string, value: string): string {
  return createHmac('sha256', key).update(`${kind}:${value}`).digest('hex')
}

function deriveOwnerKey(masterKey: Buffer, ownerId: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      masterKey,
      Buffer.from(ownerId),
      ROTATION_PLAN_INFO,
      32
    )
  )
}

function numberValue(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : Number(value)
}

function stringValue(value: unknown): string {
  return value == null ? '' : String(value)
}

function nullableNumberValue(value: unknown): number | null {
  return value == null ? null : numberValue(value)
}

function bytesValue(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value
  }
  throw new TraceRotationPlanError(
    'trace_rotation.storage_corrupt',
    'Rotation plan storage contains an invalid binary value.',
    500
  )
}

function parsePlanTtlSeconds(value: string | undefined): number {
  const parsed = Number(value || 900)
  if (!Number.isInteger(parsed) || parsed < 300 || parsed > 86_400) {
    return 900
  }
  return parsed
}

function parseFreeSpaceMultiplier(value: string | undefined): number {
  const parsed = Number(value || 2.2)
  if (!Number.isFinite(parsed) || parsed < 1.2 || parsed > 10) {
    return 2.2
  }
  return parsed
}

function buildPlanAAD(row: Omit<RotationPlanRow, 'plan_hash' | 'ciphertext' | 'initialization_vector' | 'authentication_tag'>): Buffer {
  return Buffer.from(
    JSON.stringify({
      rotation_plan_id: row.rotation_plan_id,
      stable_owner_hash: row.stable_owner_hash,
      target_key_version: row.target_key_version,
      target_encryption_key_id: row.target_encryption_key_id,
      trace_count: row.trace_count,
      operation_plan_count: row.operation_plan_count,
      estimated_rewrite_bytes: row.estimated_rewrite_bytes,
      required_free_bytes: row.required_free_bytes,
      available_free_bytes: row.available_free_bytes,
      backup_status: row.backup_status,
      created_at: row.created_at,
      expires_at: row.expires_at,
      encryption_key_id: row.encryption_key_id
    })
  )
}

function computeEncryptedPlanHash(
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

function mapRotationPlanRow(row: Record<string, unknown>): RotationPlanRow {
  return {
    rotation_plan_id: stringValue(row['rotation_plan_id']),
    stable_owner_hash: stringValue(row['stable_owner_hash']),
    target_key_version: stringValue(row['target_key_version']),
    target_encryption_key_id: stringValue(row['target_encryption_key_id']),
    trace_count: numberValue(row['trace_count']),
    operation_plan_count: numberValue(row['operation_plan_count']),
    estimated_rewrite_bytes: numberValue(row['estimated_rewrite_bytes']),
    required_free_bytes: numberValue(row['required_free_bytes']),
    available_free_bytes: nullableNumberValue(row['available_free_bytes']),
    backup_status: stringValue(row['backup_status']) as TraceBackupEvidence['status'],
    created_at: numberValue(row['created_at']),
    expires_at: numberValue(row['expires_at']),
    encryption_key_id: stringValue(row['encryption_key_id']),
    plan_hash: stringValue(row['plan_hash']),
    ciphertext: bytesValue(row['ciphertext']),
    initialization_vector: bytesValue(row['initialization_vector']),
    authentication_tag: bytesValue(row['authentication_tag'])
  }
}

export class TraceRotationPlanner {
  private database: DatabaseSync | null = null
  private lookupKey: Buffer | null = null

  public constructor(
    private readonly config: TraceRotationPlanConfig,
    private readonly keyring: TraceReadKeyring,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID
  ) {}

  public static fromProcessEnv(
    keyring: TraceReadKeyring,
    env: NodeJS.ProcessEnv = process.env
  ): TraceRotationPlanner {
    return new TraceRotationPlanner(
      {
        enabled:
          env['MIRA_GREENFIELD_ENABLED'] === 'true' &&
          env['MIRA_GREENFIELD_TRACE_PERSISTENCE'] === 'true' &&
          env['MIRA_GREENFIELD_TRACE_OPERATIONS'] === 'true',
        databasePath:
          env['MIRA_GREENFIELD_TRACE_DB_PATH'] ||
          path.join(process.cwd(), 'core', 'data', 'greenfield', 'traces.sqlite'),
        backupPath: env['MIRA_GREENFIELD_TRACE_BACKUP_PATH'] || '',
        ownerLookupKeyBase64:
          env['MIRA_GREENFIELD_OWNER_LOOKUP_KEY'] || '',
        activeMasterKeyBase64:
          env['MIRA_GREENFIELD_TRACE_MASTER_KEY'] || '',
        activeKeyVersion: env['MIRA_GREENFIELD_TRACE_KEY_VERSION'] || 'v1',
        keyringJson: env['MIRA_GREENFIELD_TRACE_KEYRING_JSON'] || '',
        planTtlSeconds: parsePlanTtlSeconds(
          env['MIRA_GREENFIELD_TRACE_ROTATION_PLAN_TTL_SECONDS']
        ),
        freeSpaceMultiplier: parseFreeSpaceMultiplier(
          env['MIRA_GREENFIELD_TRACE_ROTATION_SPACE_MULTIPLIER']
        )
      },
      keyring
    )
  }

  public createPlan(
    identity: IdentityContext,
    targetKeyVersion: string
  ): TraceRotationPlan {
    this.assertPlanningAuthority(identity)
    const targetVersion = validateKeyVersion(targetKeyVersion)
    if (!this.keyring.hasVersion(targetVersion)) {
      throw new TraceRotationPlanError(
        'trace_rotation.target_key_missing',
        'The target key version is absent from the configured read keyring.',
        409,
        targetVersion
      )
    }
    if (targetVersion === this.keyring.getActiveVersion()) {
      throw new TraceRotationPlanError(
        'trace_rotation.target_key_active',
        'The target key version must differ from the active key version.',
        409,
        targetVersion
      )
    }

    const observedAt = this.now()
    const inventory = this.keyring.getOwnerInventory(identity, observedAt)
    const database = this.ensureDatabase()
    const stableOwnerHash = keyedIdentifier(
      this.ensureLookupKey(),
      'owner',
      identity.owner_id
    )
    const targetKeyId = this.keyring.getEncryptionKeyId(targetVersion)
    if (!targetKeyId) {
      throw new TraceRotationPlanError(
        'trace_rotation.target_key_missing',
        'The target key version has no registered fingerprint.',
        409,
        targetVersion
      )
    }

    const sourceVersions = [
      ...new Set(
        inventory.traces
          .map((trace) => trace.encryption_key_version)
          .filter((value): value is string => Boolean(value))
      )
    ].sort()
    const traceIds = inventory.traces.map((trace) => trace.trace_id).sort()
    const recordHashes = inventory.traces.map((trace) => trace.record_hash).sort()
    const operationPlanIds = inventory.plans.map((plan) => plan.plan_id).sort()
    const databaseBytes = this.getDatabaseLogicalBytes(database)
    const estimatedRewriteBytes = this.getOwnerEncryptedBytes(
      database,
      stableOwnerHash
    )
    const requiredFreeBytes = Math.ceil(
      Math.max(databaseBytes, estimatedRewriteBytes) *
        this.config.freeSpaceMultiplier
    )
    const availableFreeBytes = this.getAvailableFreeBytes()
    const backup = this.verifyBackup(database, observedAt)
    const activePlans = inventory.plans.filter(
      (plan) => !plan.expired && plan.receipt === null
    )
    const blockers = [...inventory.blockers]

    if (sourceVersions.includes(targetVersion)) {
      blockers.push('rotation.target_key_already_contains_owner_records')
    }
    if (activePlans.length > 0) {
      blockers.push('rotation.active_operation_plans_present')
    }
    if (backup.status !== 'verified') {
      blockers.push('rotation.backup_restore_not_verified')
    }
    if (
      availableFreeBytes !== null &&
      availableFreeBytes < requiredFreeBytes
    ) {
      blockers.push('rotation.insufficient_storage_headroom')
    }
    blockers.push('rotation.reencryption_executor_not_implemented')

    const interruptionCheckpoints = [
      'Verify the immutable plan and backup evidence before any write.',
      'Create a durable rotation journal before rewriting the first record.',
      'Rewrite records in deterministic batches with per-record verification.',
      'Persist a checkpoint after each committed batch and resume only from it.',
      'Keep the source key readable until every trace, operation plan, and receipt verifies.',
      'Switch the active key only after full-chain and restart verification.'
    ]
    const verificationCriteria = [
      'Every planned trace ID and record hash is present exactly once before rotation.',
      'Every rewritten trace decrypts under the target key and preserves its causal envelope.',
      'Every operation plan and receipt remains readable and integrity-valid.',
      'The complete owner causal chain remains valid across all rewritten records.',
      'A restart opens every planned record using the target key version.',
      'The verified backup remains readable until owner-authorized retirement.'
    ]
    const rollbackLimits = [
      'This plan does not execute re-encryption and cannot alter owner records.',
      'During a future execution, committed target-key batches require journal-guided recovery.',
      'The source key must not be retired until restart and backup verification succeed.',
      'Rollback cannot recreate records previously purged by an owner-authorized purge.',
      'Code rollback is not authorization to delete plans, receipts, bindings, or key metadata.'
    ]
    const createdAt = observedAt.getTime()
    const expiresAt = createdAt + this.config.planTtlSeconds * 1_000
    const planId = this.createId()
    const publicWithoutHash = {
      rotation_plan_id: planId,
      target_key_version: targetVersion,
      target_encryption_key_id: targetKeyId,
      source_key_versions: sourceVersions,
      trace_count: traceIds.length,
      operation_plan_count: operationPlanIds.length,
      trace_ids: traceIds,
      operation_plan_ids: operationPlanIds,
      record_hashes: recordHashes,
      estimated_rewrite_bytes: estimatedRewriteBytes,
      required_free_bytes: requiredFreeBytes,
      available_free_bytes: availableFreeBytes,
      backup,
      interruption_checkpoints: interruptionCheckpoints,
      verification_criteria: verificationCriteria,
      rollback_limits: rollbackLimits,
      blockers: [...new Set(blockers)],
      execution_supported: false as const,
      ready_for_execution: false as const,
      created_at: observedAt.toISOString(),
      expires_at: new Date(expiresAt).toISOString()
    }
    const plan: TraceRotationPlan = {
      ...publicWithoutHash,
      plan_hash: canonicalHash(publicWithoutHash)
    }
    this.persistPlan(
      database,
      identity.owner_id,
      stableOwnerHash,
      plan,
      createdAt,
      expiresAt
    )
    return plan
  }

  public readPlan(
    identity: IdentityContext,
    rotationPlanId: string
  ): TraceRotationPlan | null {
    this.assertPlanningAuthority(identity)
    this.keyring.prepareOwner(identity.owner_id)
    const database = this.ensureDatabase()
    const stableOwnerHash = keyedIdentifier(
      this.ensureLookupKey(),
      'owner',
      identity.owner_id
    )
    const raw = database
      .prepare(
        `SELECT * FROM greenfield_trace_rotation_plans
         WHERE rotation_plan_id = ? AND stable_owner_hash = ? LIMIT 1`
      )
      .get(rotationPlanId, stableOwnerHash) as
      | Record<string, unknown>
      | undefined
    if (!raw) {
      return null
    }
    return this.decryptPersistedPlan(identity.owner_id, mapRotationPlanRow(raw))
  }

  public close(): void {
    this.database?.close()
    this.database = null
    this.lookupKey = null
  }

  private assertPlanningAuthority(identity: IdentityContext): void {
    if (!this.config.enabled) {
      throw new TraceRotationPlanError(
        'trace_rotation.disabled',
        'Trace rotation planning is disabled.',
        503
      )
    }
    const decision = evaluateIdentity(identity)
    if (!decision.allowed) {
      throw new TraceRotationPlanError(
        decision.code,
        decision.reasons.join(' '),
        403
      )
    }
    if (!identity.permissions.includes(TRACE_ROTATION_PLAN_CAPABILITY)) {
      throw new TraceRotationPlanError(
        'trace_rotation.permission_missing',
        'The authenticated owner session lacks trace rotation planning permission.',
        403
      )
    }
    if (!identity.privacy_zones.includes('private')) {
      throw new TraceRotationPlanError(
        'trace_rotation.privacy_zone_denied',
        'Trace rotation planning requires access to the private owner zone.',
        403
      )
    }
  }

  private ensureDatabase(): DatabaseSync {
    if (this.database) {
      return this.database
    }
    const directory = path.dirname(this.config.databasePath)
    if (this.config.databasePath !== ':memory:') {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    }
    const database = new DatabaseSync(this.config.databasePath)
    database.exec('PRAGMA journal_mode = WAL;')
    database.exec('PRAGMA foreign_keys = ON;')
    database.exec('PRAGMA synchronous = FULL;')
    database.exec('PRAGMA secure_delete = ON;')
    database.exec('PRAGMA busy_timeout = 5000;')
    this.applyMigrations(database)
    this.database = database
    return database
  }

  private ensureLookupKey(): Buffer {
    if (!this.lookupKey) {
      this.lookupKey = decodeKey(
        this.config.ownerLookupKeyBase64,
        'MIRA_GREENFIELD_OWNER_LOOKUP_KEY'
      )
    }
    return this.lookupKey
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
    for (const migration of TRACE_KEY_MIGRATIONS) {
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
          .run(migration.version, migration.name, this.now().getTime())
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw new TraceRotationPlanError(
          'trace_rotation.migration_failed',
          `Trace rotation migration ${migration.version} failed.`,
          500,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
  }

  private getOwnerEncryptedBytes(
    database: DatabaseSync,
    stableOwnerHash: string
  ): number {
    const bindings = database
      .prepare(
        `SELECT owner_hash FROM greenfield_trace_owner_key_bindings
         WHERE stable_owner_hash = ?`
      )
      .all(stableOwnerHash)
      .map((row) => stringValue((row as Record<string, unknown>)['owner_hash']))
    if (bindings.length === 0) {
      return 0
    }
    const placeholders = bindings.map(() => '?').join(', ')
    const traceRow = database
      .prepare(
        `SELECT COALESCE(SUM(
           length(ciphertext) + length(initialization_vector) + length(authentication_tag)
         ), 0) AS bytes
         FROM greenfield_trace_records
         WHERE owner_hash IN (${placeholders})`
      )
      .get(...bindings) as Record<string, unknown> | undefined
    const operationRow = database
      .prepare(
        `SELECT COALESCE(SUM(
           length(ciphertext) + length(initialization_vector) + length(authentication_tag)
         ), 0) AS bytes
         FROM greenfield_trace_operation_plans
         WHERE owner_hash IN (${placeholders})`
      )
      .get(...bindings) as Record<string, unknown> | undefined
    return (
      numberValue(traceRow?.['bytes'] || 0) +
      numberValue(operationRow?.['bytes'] || 0)
    )
  }

  private getDatabaseLogicalBytes(database: DatabaseSync): number {
    const pageCount = database.prepare('PRAGMA page_count').get() as
      | Record<string, unknown>
      | undefined
    const pageSize = database.prepare('PRAGMA page_size').get() as
      | Record<string, unknown>
      | undefined
    const count = pageCount
      ? numberValue(Object.values(pageCount)[0])
      : 0
    const size = pageSize ? numberValue(Object.values(pageSize)[0]) : 0
    return count * size
  }

  private getAvailableFreeBytes(): number | null {
    if (this.config.databasePath === ':memory:') {
      return null
    }
    try {
      const stats = fs.statfsSync(path.dirname(this.config.databasePath))
      return numberValue(stats.bavail) * numberValue(stats.bsize)
    } catch {
      return null
    }
  }

  private verifyBackup(
    liveDatabase: DatabaseSync,
    observedAt: Date
  ): TraceBackupEvidence {
    const verifiedAt = observedAt.toISOString()
    if (!this.config.backupPath) {
      return {
        status: 'not_configured',
        path_ref: null,
        size_bytes: null,
        integrity_check: null,
        migration_versions: [],
        trace_count: null,
        operation_plan_count: null,
        verified_at: verifiedAt,
        issue: 'MIRA_GREENFIELD_TRACE_BACKUP_PATH is not configured.'
      }
    }
    const resolvedBackup = path.resolve(this.config.backupPath)
    const resolvedLive = path.resolve(this.config.databasePath)
    if (resolvedBackup === resolvedLive || !fs.existsSync(resolvedBackup)) {
      return {
        status: 'missing',
        path_ref: `backup:${sha256(resolvedBackup).slice(0, 24)}`,
        size_bytes: null,
        integrity_check: null,
        migration_versions: [],
        trace_count: null,
        operation_plan_count: null,
        verified_at: verifiedAt,
        issue:
          resolvedBackup === resolvedLive
            ? 'The backup path points to the live database.'
            : 'The configured backup file does not exist.'
      }
    }

    let backup: DatabaseSync | null = null
    try {
      backup = new DatabaseSync(resolvedBackup)
      const integrityRow = backup.prepare('PRAGMA integrity_check').get() as
        | Record<string, unknown>
        | undefined
      const integrity = integrityRow
        ? stringValue(Object.values(integrityRow)[0])
        : ''
      const backupVersions = backup
        .prepare(
          `SELECT version FROM greenfield_trace_schema_migrations
           ORDER BY version ASC`
        )
        .all()
        .map((row) =>
          numberValue((row as Record<string, unknown>)['version'])
        )
      const liveVersions = liveDatabase
        .prepare(
          `SELECT version FROM greenfield_trace_schema_migrations
           ORDER BY version ASC`
        )
        .all()
        .map((row) =>
          numberValue((row as Record<string, unknown>)['version'])
        )
      const traceRow = backup
        .prepare('SELECT COUNT(*) AS count FROM greenfield_trace_records')
        .get() as Record<string, unknown> | undefined
      const operationRow = backup
        .prepare(
          'SELECT COUNT(*) AS count FROM greenfield_trace_operation_plans'
        )
        .get() as Record<string, unknown> | undefined
      const liveTraceRow = liveDatabase
        .prepare('SELECT COUNT(*) AS count FROM greenfield_trace_records')
        .get() as Record<string, unknown> | undefined
      const liveOperationRow = liveDatabase
        .prepare(
          'SELECT COUNT(*) AS count FROM greenfield_trace_operation_plans'
        )
        .get() as Record<string, unknown> | undefined
      const traceCount = numberValue(traceRow?.['count'] || 0)
      const operationPlanCount = numberValue(operationRow?.['count'] || 0)
      const valid =
        integrity === 'ok' &&
        JSON.stringify(backupVersions) === JSON.stringify(liveVersions) &&
        traceCount === numberValue(liveTraceRow?.['count'] || 0) &&
        operationPlanCount ===
          numberValue(liveOperationRow?.['count'] || 0)
      return {
        status: valid ? 'verified' : 'invalid',
        path_ref: `backup:${sha256(resolvedBackup).slice(0, 24)}`,
        size_bytes: fs.statSync(resolvedBackup).size,
        integrity_check: integrity,
        migration_versions: backupVersions,
        trace_count: traceCount,
        operation_plan_count: operationPlanCount,
        verified_at: verifiedAt,
        issue: valid
          ? null
          : 'Backup integrity, schema versions, or protected record counts do not match the live database.'
      }
    } catch (error) {
      return {
        status: 'invalid',
        path_ref: `backup:${sha256(resolvedBackup).slice(0, 24)}`,
        size_bytes: fs.existsSync(resolvedBackup)
          ? fs.statSync(resolvedBackup).size
          : null,
        integrity_check: null,
        migration_versions: [],
        trace_count: null,
        operation_plan_count: null,
        verified_at: verifiedAt,
        issue: error instanceof Error ? error.message : String(error)
      }
    } finally {
      backup?.close()
    }
  }

  private persistPlan(
    database: DatabaseSync,
    ownerId: string,
    stableOwnerHash: string,
    plan: TraceRotationPlan,
    createdAt: number,
    expiresAt: number
  ): void {
    const activeKey = decodeKey(
      this.config.activeMasterKeyBase64,
      'MIRA_GREENFIELD_TRACE_MASTER_KEY'
    )
    const activeKeyId = sha256(activeKey).slice(0, 16)
    const payload: RotationPlanSecretPayload = {
      ownerId,
      traceIds: plan.trace_ids,
      operationPlanIds: plan.operation_plan_ids,
      recordHashes: plan.record_hashes,
      sourceKeyVersions: plan.source_key_versions,
      interruptionCheckpoints: plan.interruption_checkpoints,
      verificationCriteria: plan.verification_criteria,
      rollbackLimits: plan.rollback_limits,
      blockers: plan.blockers,
      backup: plan.backup
    }
    const baseRow = {
      rotation_plan_id: plan.rotation_plan_id,
      stable_owner_hash: stableOwnerHash,
      target_key_version: plan.target_key_version,
      target_encryption_key_id: plan.target_encryption_key_id,
      trace_count: plan.trace_count,
      operation_plan_count: plan.operation_plan_count,
      estimated_rewrite_bytes: plan.estimated_rewrite_bytes,
      required_free_bytes: plan.required_free_bytes,
      available_free_bytes: plan.available_free_bytes,
      backup_status: plan.backup.status,
      created_at: createdAt,
      expires_at: expiresAt,
      encryption_key_id: activeKeyId
    }
    const aad = buildPlanAAD(baseRow)
    const initializationVector = randomBytes(12)
    const cipher = createCipheriv(
      'aes-256-gcm',
      deriveOwnerKey(activeKey, ownerId),
      initializationVector
    )
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final()
    ])
    const authenticationTag = cipher.getAuthTag()
    const encryptedPlanHash = computeEncryptedPlanHash(
      aad,
      ciphertext,
      initializationVector,
      authenticationTag
    )
    database
      .prepare(
        `INSERT INTO greenfield_trace_rotation_plans (
           rotation_plan_id, stable_owner_hash, target_key_version,
           target_encryption_key_id, trace_count, operation_plan_count,
           estimated_rewrite_bytes, required_free_bytes, available_free_bytes,
           backup_status, created_at, expires_at, encryption_key_id, plan_hash,
           ciphertext, initialization_vector, authentication_tag
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        plan.rotation_plan_id,
        stableOwnerHash,
        plan.target_key_version,
        plan.target_encryption_key_id,
        plan.trace_count,
        plan.operation_plan_count,
        plan.estimated_rewrite_bytes,
        plan.required_free_bytes,
        plan.available_free_bytes,
        plan.backup.status,
        createdAt,
        expiresAt,
        activeKeyId,
        encryptedPlanHash,
        ciphertext,
        initializationVector,
        authenticationTag
      )
  }

  private decryptPersistedPlan(
    ownerId: string,
    row: RotationPlanRow
  ): TraceRotationPlan {
    const key = this.readKeyByFingerprint(row.encryption_key_id)
    const aad = buildPlanAAD(row)
    const encryptedHash = computeEncryptedPlanHash(
      aad,
      row.ciphertext,
      row.initialization_vector,
      row.authentication_tag
    )
    if (encryptedHash !== row.plan_hash) {
      throw new TraceRotationPlanError(
        'trace_rotation.plan_integrity_failed',
        'The persisted rotation plan failed encrypted integrity verification.',
        500,
        row.rotation_plan_id
      )
    }
    let payload: RotationPlanSecretPayload
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        deriveOwnerKey(key, ownerId),
        Buffer.from(row.initialization_vector)
      )
      decipher.setAAD(aad)
      decipher.setAuthTag(Buffer.from(row.authentication_tag))
      payload = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(row.ciphertext)),
          decipher.final()
        ]).toString('utf8')
      ) as RotationPlanSecretPayload
    } catch (error) {
      throw new TraceRotationPlanError(
        'trace_rotation.plan_decryption_failed',
        'The persisted rotation plan could not be authenticated and decrypted.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
    if (payload.ownerId !== ownerId) {
      throw new TraceRotationPlanError(
        'trace_rotation.plan_owner_mismatch',
        'The persisted rotation plan does not belong to the authenticated owner.',
        403
      )
    }
    const publicWithoutHash = {
      rotation_plan_id: row.rotation_plan_id,
      target_key_version: row.target_key_version,
      target_encryption_key_id: row.target_encryption_key_id,
      source_key_versions: payload.sourceKeyVersions,
      trace_count: row.trace_count,
      operation_plan_count: row.operation_plan_count,
      trace_ids: payload.traceIds,
      operation_plan_ids: payload.operationPlanIds,
      record_hashes: payload.recordHashes,
      estimated_rewrite_bytes: row.estimated_rewrite_bytes,
      required_free_bytes: row.required_free_bytes,
      available_free_bytes: row.available_free_bytes,
      backup: payload.backup,
      interruption_checkpoints: payload.interruptionCheckpoints,
      verification_criteria: payload.verificationCriteria,
      rollback_limits: payload.rollbackLimits,
      blockers: payload.blockers,
      execution_supported: false as const,
      ready_for_execution: false as const,
      created_at: new Date(row.created_at).toISOString(),
      expires_at: new Date(row.expires_at).toISOString()
    }
    return {
      ...publicWithoutHash,
      plan_hash: canonicalHash(publicWithoutHash)
    }
  }

  private readKeyByFingerprint(encryptionKeyId: string): Buffer {
    const activeKey = decodeKey(
      this.config.activeMasterKeyBase64,
      'MIRA_GREENFIELD_TRACE_MASTER_KEY'
    )
    const configured: Record<string, unknown> = this.config.keyringJson.trim()
      ? (JSON.parse(this.config.keyringJson) as Record<string, unknown>)
      : {}
    configured[this.config.activeKeyVersion] =
      this.config.activeMasterKeyBase64
    for (const [version, encoded] of Object.entries(configured)) {
      validateKeyVersion(version)
      const key = decodeKey(
        String(encoded),
        `MIRA_GREENFIELD_TRACE_KEYRING_JSON.${version}`
      )
      if (sha256(key).slice(0, 16) === encryptionKeyId) {
        return key
      }
    }
    if (sha256(activeKey).slice(0, 16) === encryptionKeyId) {
      return activeKey
    }
    throw new TraceRotationPlanError(
      'trace_rotation.plan_key_unavailable',
      'The key required to open the persisted rotation plan is unavailable.',
      503,
      encryptionKeyId
    )
  }
}
