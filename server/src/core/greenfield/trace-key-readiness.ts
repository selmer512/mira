import fs from 'node:fs'
import path from 'node:path'
import { createHash, createHmac } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import type { IdentityContext } from './contracts'
import { evaluateIdentity } from './policy'
import {
  EncryptedSqliteTraceStore,
  type TraceChainVerification
} from './trace-store'
import type {
  TraceOperation,
  TraceOperationReceipt
} from './trace-operation-contracts'
import {
  canonicalHash,
  TraceOwnerOperationStore
} from './trace-operation-store'
import { TRACE_KEY_MIGRATIONS } from './trace-key-migrations'

export const TRACE_OPERATIONS_READ_CAPABILITY = 'trace.operations.read'

const KEY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const TRACE_CATALOG_LIMIT = 200
const OPERATION_HISTORY_LIMIT = 50

export interface TraceKeyReadinessConfig {
  enabled: boolean
  databasePath: string
  masterKeyBase64: string
  keyVersion: string
}

export interface TraceCatalogEntry {
  trace_id: string
  event_type: string
  occurred_at: string
  completed_at: string
  privacy_classification: string
  record_hash: string
  retention_until: string
  encryption_key_id: string
  encryption_key_version: string | null
  created_at: string
}

export interface TraceOperationDashboardPlan {
  plan_id: string
  action_id: string
  operation_trace_id: string
  operation: TraceOperation
  risk: 'high' | 'critical'
  scope_hash: string
  trace_count: number
  trace_ids: string[]
  verification_criteria: string[]
  created_at: string
  expires_at: string
  expired: boolean
  approval_decision: 'approved' | 'rejected' | null
  receipt: TraceOperationReceipt | null
  key_version: string | null
  key_metadata_source: 'active_key_decryption' | 'unavailable'
}

export interface TraceKeyInventoryVersion {
  encryption_key_id: string
  key_version: string | null
  trace_count: number
  active: boolean
}

export interface TraceKeyReadinessReport {
  observed_at: string
  status: 'ready' | 'attention_required' | 'blocked'
  rotation_supported: false
  active_key: {
    key_version: string
    encryption_key_id: string
    algorithm: 'aes-256-gcm'
    registered_at: string | null
    metadata_integrity_valid: boolean
  }
  chain: TraceChainVerification
  trace_inventory: {
    total: number
    catalog_count: number
    catalog_truncated: boolean
    active_key_count: number
    unknown_key_version_count: number
    versions: TraceKeyInventoryVersion[]
  }
  operation_inventory: {
    total: number
    active_unexpired: number
    approved_unexecuted: number
    unreadable_with_active_key: number
    verified_receipts: number
  }
  blockers: string[]
  warnings: string[]
  migration_versions: number[]
}

export interface TraceOperationsDashboard {
  owner_ref: string
  device_ref: string
  readiness: TraceKeyReadinessReport
  traces: TraceCatalogEntry[]
  plans: TraceOperationDashboardPlan[]
}

export class TraceKeyReadinessError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'TraceKeyReadinessError'
  }
}

interface KeyRegistryRow {
  key_version: string
  encryption_key_id: string
  algorithm: 'aes-256-gcm'
  registered_at: number
  metadata_hash: string
}

interface KeyRegistrationResult {
  row: KeyRegistryRow | null
  conflict: string | null
  metadataIntegrityValid: boolean
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function decodeMasterKey(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== 32) {
    throw new TraceKeyReadinessError(
      'trace_key.master_key_invalid',
      'Trace key readiness requires the configured base64-encoded 32-byte trace master key.',
      503
    )
  }
  return decoded
}

function validateKeyVersion(value: string): string {
  if (!KEY_VERSION_PATTERN.test(value)) {
    throw new TraceKeyReadinessError(
      'trace_key.version_invalid',
      'MIRA_GREENFIELD_TRACE_KEY_VERSION must be a stable lowercase identifier.',
      503
    )
  }
  return value
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

function tableExists(database: DatabaseSync, tableName: string): boolean {
  return Boolean(
    database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = ?
         LIMIT 1`
      )
      .get(tableName)
  )
}

function mapKeyRegistryRow(
  row: Record<string, unknown> | undefined
): KeyRegistryRow | null {
  if (!row) {
    return null
  }
  return {
    key_version: stringValue(row['key_version']),
    encryption_key_id: stringValue(row['encryption_key_id']),
    algorithm: 'aes-256-gcm',
    registered_at: numberValue(row['registered_at']),
    metadata_hash: stringValue(row['metadata_hash'])
  }
}

function keyMetadataHash(input: {
  keyVersion: string
  encryptionKeyId: string
  algorithm: 'aes-256-gcm'
  registeredAt: number
}): string {
  return canonicalHash({
    key_version: input.keyVersion,
    encryption_key_id: input.encryptionKeyId,
    algorithm: input.algorithm,
    registered_at: input.registeredAt
  })
}

export class TraceOperationsDashboardService {
  private database: DatabaseSync | null = null
  private masterKey: Buffer | null = null

  public constructor(
    private readonly config: TraceKeyReadinessConfig,
    private readonly traceStore: EncryptedSqliteTraceStore,
    private readonly operationStore: TraceOwnerOperationStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  public static fromProcessEnv(
    traceStore: EncryptedSqliteTraceStore,
    operationStore: TraceOwnerOperationStore,
    env: NodeJS.ProcessEnv = process.env
  ): TraceOperationsDashboardService {
    return new TraceOperationsDashboardService(
      {
        enabled:
          env['MIRA_GREENFIELD_ENABLED'] === 'true' &&
          env['MIRA_GREENFIELD_TRACE_PERSISTENCE'] === 'true' &&
          env['MIRA_GREENFIELD_TRACE_OPERATIONS'] === 'true',
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
        keyVersion: env['MIRA_GREENFIELD_TRACE_KEY_VERSION'] || 'v1'
      },
      traceStore,
      operationStore
    )
  }

  public async getDashboard(
    identity: IdentityContext
  ): Promise<TraceOperationsDashboard> {
    this.assertAuthorized(identity)

    const observedAt = this.now()
    const database = this.ensureDatabase()
    const masterKey = this.ensureMasterKey()
    const keyVersion = validateKeyVersion(this.config.keyVersion)
    const encryptionKeyId = sha256(masterKey).slice(0, 16)
    const registration = this.registerActiveKey(
      database,
      keyVersion,
      encryptionKeyId,
      observedAt
    )
    const ownerHash = keyedIdentifier(masterKey, 'owner', identity.owner_id)
    const deviceHash = keyedIdentifier(masterKey, 'device', identity.device_id)
    const traces = this.readTraceCatalog(database, ownerHash)
    const totalTraceCount = this.countOwnerTraces(database, ownerHash)
    const plans = this.readOperationPlans(
      database,
      ownerHash,
      identity.owner_id,
      keyVersion,
      observedAt
    )
    const chain = await this.traceStore.verifyOwnerChain(identity.owner_id)
    const versions = this.buildTraceVersionInventory(
      database,
      ownerHash,
      encryptionKeyId
    )
    const activeKeyCount = versions
      .filter((entry) => entry.active)
      .reduce((sum, entry) => sum + entry.trace_count, 0)
    const unknownKeyVersionCount = versions
      .filter((entry) => entry.key_version === null)
      .reduce((sum, entry) => sum + entry.trace_count, 0)
    const activeUnexpired = plans.filter(
      (plan) => !plan.expired && plan.receipt === null
    ).length
    const approvedUnexecuted = plans.filter(
      (plan) =>
        plan.approval_decision === 'approved' && plan.receipt === null
    ).length
    const unreadablePlanCount = plans.filter(
      (plan) => plan.key_metadata_source === 'unavailable'
    ).length
    const verifiedReceipts = plans.filter(
      (plan) =>
        plan.receipt?.execution_status === 'succeeded' &&
        plan.receipt.verification_status === 'succeeded'
    ).length
    const blockers = this.buildBlockers({
      registration,
      chain,
      versions,
      unknownKeyVersionCount,
      unreadablePlanCount,
      activeUnexpired
    })
    const warnings: string[] = []
    if (totalTraceCount === 0) {
      warnings.push('rotation.no_trace_records_to_assess')
    }
    if (traces.length < totalTraceCount) {
      warnings.push('rotation.trace_catalog_truncated')
    }

    const readiness: TraceKeyReadinessReport = {
      observed_at: observedAt.toISOString(),
      status:
        blockers.length > 0
          ? 'blocked'
          : warnings.length > 0
            ? 'attention_required'
            : 'ready',
      rotation_supported: false,
      active_key: {
        key_version: keyVersion,
        encryption_key_id: encryptionKeyId,
        algorithm: 'aes-256-gcm',
        registered_at: registration.row
          ? new Date(registration.row.registered_at).toISOString()
          : null,
        metadata_integrity_valid: registration.metadataIntegrityValid
      },
      chain,
      trace_inventory: {
        total: totalTraceCount,
        catalog_count: traces.length,
        catalog_truncated: traces.length < totalTraceCount,
        active_key_count: activeKeyCount,
        unknown_key_version_count: unknownKeyVersionCount,
        versions
      },
      operation_inventory: {
        total: plans.length,
        active_unexpired: activeUnexpired,
        approved_unexecuted: approvedUnexecuted,
        unreadable_with_active_key: unreadablePlanCount,
        verified_receipts: verifiedReceipts
      },
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)],
      migration_versions: this.getAppliedMigrationVersions(database)
    }

    return {
      owner_ref: reference('owner', ownerHash),
      device_ref: reference('device', deviceHash),
      readiness,
      traces,
      plans
    }
  }

  public close(): void {
    this.database?.close()
    this.database = null
    this.masterKey = null
  }

  private assertAuthorized(identity: IdentityContext): void {
    if (!this.config.enabled) {
      throw new TraceKeyReadinessError(
        'trace_key.dashboard_disabled',
        'The trace operations dashboard is disabled.',
        503
      )
    }

    const identityDecision = evaluateIdentity(identity)
    if (!identityDecision.allowed) {
      throw new TraceKeyReadinessError(
        identityDecision.code,
        identityDecision.reasons.join(' '),
        403
      )
    }
    if (!identity.permissions.includes(TRACE_OPERATIONS_READ_CAPABILITY)) {
      throw new TraceKeyReadinessError(
        'trace_key.permission_missing',
        'The authenticated owner session lacks trace operations read permission.',
        403
      )
    }
    if (!identity.privacy_zones.includes('private')) {
      throw new TraceKeyReadinessError(
        'trace_key.privacy_zone_denied',
        'The authenticated owner session cannot access the private trace zone.',
        403
      )
    }
  }

  private buildBlockers(input: {
    registration: KeyRegistrationResult
    chain: TraceChainVerification
    versions: TraceKeyInventoryVersion[]
    unknownKeyVersionCount: number
    unreadablePlanCount: number
    activeUnexpired: number
  }): string[] {
    const blockers = [
      'rotation.stable_owner_lookup_not_implemented',
      'rotation.multi_key_keyring_not_implemented',
      'rotation.reencryption_executor_not_implemented',
      'rotation.backup_restore_not_verified'
    ]
    if (input.registration.conflict) {
      blockers.push(input.registration.conflict)
    }
    if (!input.registration.metadataIntegrityValid) {
      blockers.push('rotation.key_registry_integrity_failed')
    }
    if (!input.chain.valid) {
      blockers.push('rotation.trace_chain_invalid')
    }
    if (input.unknownKeyVersionCount > 0) {
      blockers.push('rotation.unregistered_trace_key_detected')
    }
    if (input.versions.some((entry) => !entry.active)) {
      blockers.push('rotation.foreign_trace_key_detected')
    }
    if (input.unreadablePlanCount > 0) {
      blockers.push('rotation.operation_plan_unreadable')
    }
    if (input.activeUnexpired > 0) {
      blockers.push('rotation.active_operation_plans_present')
    }
    return blockers
  }

  private ensureDatabase(): DatabaseSync {
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
      throw new TraceKeyReadinessError(
        'trace_key.master_key_unavailable',
        'The active trace key is unavailable.',
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
          .run(migration.version, migration.name, Date.now())
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw new TraceKeyReadinessError(
          'trace_key.migration_failed',
          `Trace key migration ${migration.version} failed.`,
          500,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
  }

  private registerActiveKey(
    database: DatabaseSync,
    keyVersion: string,
    encryptionKeyId: string,
    registeredAt: Date
  ): KeyRegistrationResult {
    const versionRow = mapKeyRegistryRow(
      database
        .prepare(
          `SELECT * FROM greenfield_trace_key_versions
           WHERE key_version = ? LIMIT 1`
        )
        .get(keyVersion) as Record<string, unknown> | undefined
    )
    if (versionRow && versionRow.encryption_key_id !== encryptionKeyId) {
      return {
        row: versionRow,
        conflict: 'rotation.key_version_reused_with_different_key',
        metadataIntegrityValid: this.verifyKeyRegistryRow(versionRow)
      }
    }

    const keyRow = mapKeyRegistryRow(
      database
        .prepare(
          `SELECT * FROM greenfield_trace_key_versions
           WHERE encryption_key_id = ? LIMIT 1`
        )
        .get(encryptionKeyId) as Record<string, unknown> | undefined
    )
    if (keyRow && keyRow.key_version !== keyVersion) {
      return {
        row: keyRow,
        conflict: 'rotation.key_material_reused_with_different_version',
        metadataIntegrityValid: this.verifyKeyRegistryRow(keyRow)
      }
    }
    if (versionRow) {
      return {
        row: versionRow,
        conflict: null,
        metadataIntegrityValid: this.verifyKeyRegistryRow(versionRow)
      }
    }

    const registeredAtMs = registeredAt.getTime()
    const metadataHash = keyMetadataHash({
      keyVersion,
      encryptionKeyId,
      algorithm: 'aes-256-gcm',
      registeredAt: registeredAtMs
    })
    database
      .prepare(
        `INSERT INTO greenfield_trace_key_versions (
           key_version, encryption_key_id, algorithm, registered_at, metadata_hash
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        keyVersion,
        encryptionKeyId,
        'aes-256-gcm',
        registeredAtMs,
        metadataHash
      )
    return {
      row: {
        key_version: keyVersion,
        encryption_key_id: encryptionKeyId,
        algorithm: 'aes-256-gcm',
        registered_at: registeredAtMs,
        metadata_hash: metadataHash
      },
      conflict: null,
      metadataIntegrityValid: true
    }
  }

  private verifyKeyRegistryRow(row: KeyRegistryRow): boolean {
    return (
      row.metadata_hash ===
      keyMetadataHash({
        keyVersion: row.key_version,
        encryptionKeyId: row.encryption_key_id,
        algorithm: row.algorithm,
        registeredAt: row.registered_at
      })
    )
  }

  private readTraceCatalog(
    database: DatabaseSync,
    ownerHash: string
  ): TraceCatalogEntry[] {
    if (!tableExists(database, 'greenfield_trace_records')) {
      return []
    }
    return database
      .prepare(
        `SELECT r.*, k.key_version
         FROM greenfield_trace_records r
         LEFT JOIN greenfield_trace_key_versions k
           ON k.encryption_key_id = r.encryption_key_id
         WHERE r.owner_hash = ?
         ORDER BY r.created_at DESC, r.rowid DESC
         LIMIT ?`
      )
      .all(ownerHash, TRACE_CATALOG_LIMIT)
      .map((raw) => {
        const row = raw as Record<string, unknown>
        return {
          trace_id: stringValue(row['trace_id']),
          event_type: stringValue(row['event_type']),
          occurred_at: new Date(numberValue(row['occurred_at'])).toISOString(),
          completed_at: new Date(numberValue(row['completed_at'])).toISOString(),
          privacy_classification: stringValue(row['privacy_classification']),
          record_hash: stringValue(row['record_hash']),
          retention_until: new Date(
            numberValue(row['retention_until'])
          ).toISOString(),
          encryption_key_id: stringValue(row['encryption_key_id']),
          encryption_key_version: nullableStringValue(row['key_version']),
          created_at: new Date(numberValue(row['created_at'])).toISOString()
        }
      })
  }

  private countOwnerTraces(database: DatabaseSync, ownerHash: string): number {
    if (!tableExists(database, 'greenfield_trace_records')) {
      return 0
    }
    const row = database
      .prepare(
        `SELECT COUNT(*) AS count FROM greenfield_trace_records
         WHERE owner_hash = ?`
      )
      .get(ownerHash) as Record<string, unknown> | undefined
    return row ? numberValue(row['count']) : 0
  }

  private buildTraceVersionInventory(
    database: DatabaseSync,
    ownerHash: string,
    activeKeyId: string
  ): TraceKeyInventoryVersion[] {
    if (!tableExists(database, 'greenfield_trace_records')) {
      return []
    }
    return database
      .prepare(
        `SELECT r.encryption_key_id, k.key_version, COUNT(*) AS trace_count
         FROM greenfield_trace_records r
         LEFT JOIN greenfield_trace_key_versions k
           ON k.encryption_key_id = r.encryption_key_id
         WHERE r.owner_hash = ?
         GROUP BY r.encryption_key_id, k.key_version
         ORDER BY trace_count DESC, r.encryption_key_id ASC`
      )
      .all(ownerHash)
      .map((raw) => {
        const row = raw as Record<string, unknown>
        const encryptionKeyId = stringValue(row['encryption_key_id'])
        return {
          encryption_key_id: encryptionKeyId,
          key_version: nullableStringValue(row['key_version']),
          trace_count: numberValue(row['trace_count']),
          active: encryptionKeyId === activeKeyId
        }
      })
  }

  private readOperationPlans(
    database: DatabaseSync,
    ownerHash: string,
    ownerId: string,
    keyVersion: string,
    observedAt: Date
  ): TraceOperationDashboardPlan[] {
    if (!tableExists(database, 'greenfield_trace_operation_plans')) {
      return []
    }
    const rows = database
      .prepare(
        `SELECT plan_id FROM greenfield_trace_operation_plans
         WHERE owner_hash = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`
      )
      .all(ownerHash, OPERATION_HISTORY_LIMIT)

    return rows.map((raw) => {
      const planId = stringValue((raw as Record<string, unknown>)['plan_id'])
      try {
        const stored = this.operationStore.readPlan(ownerId, planId)
        if (!stored) {
          throw new Error('Plan disappeared after owner-scoped lookup.')
        }
        const approval = this.operationStore.readApproval(planId)
        return {
          plan_id: stored.plan.plan_id,
          action_id: stored.plan.action_id,
          operation_trace_id: stored.plan.trace_id,
          operation: stored.plan.operation,
          risk: stored.plan.risk,
          scope_hash: stored.plan.scope_hash,
          trace_count: stored.plan.trace_count,
          trace_ids: [...stored.traceIds],
          verification_criteria: [...stored.plan.verification_criteria],
          created_at: stored.plan.created_at,
          expires_at: stored.plan.expires_at,
          expired: Date.parse(stored.plan.expires_at) < observedAt.getTime(),
          approval_decision: approval?.decision || null,
          receipt: this.operationStore.readReceipt(planId),
          key_version: keyVersion,
          key_metadata_source: 'active_key_decryption'
        }
      } catch {
        return this.readUnavailablePlan(database, planId, observedAt)
      }
    })
  }

  private readUnavailablePlan(
    database: DatabaseSync,
    planId: string,
    observedAt: Date
  ): TraceOperationDashboardPlan {
    const metadata = database
      .prepare(
        `SELECT plan_id, action_id, trace_id, operation, risk, scope_hash,
                trace_count, created_at, expires_at
         FROM greenfield_trace_operation_plans
         WHERE plan_id = ? LIMIT 1`
      )
      .get(planId) as Record<string, unknown>
    return {
      plan_id: stringValue(metadata['plan_id']),
      action_id: stringValue(metadata['action_id']),
      operation_trace_id: stringValue(metadata['trace_id']),
      operation: stringValue(metadata['operation']) as TraceOperation,
      risk: stringValue(metadata['risk']) as 'high' | 'critical',
      scope_hash: stringValue(metadata['scope_hash']),
      trace_count: numberValue(metadata['trace_count']),
      trace_ids: [],
      verification_criteria: [],
      created_at: new Date(numberValue(metadata['created_at'])).toISOString(),
      expires_at: new Date(numberValue(metadata['expires_at'])).toISOString(),
      expired: numberValue(metadata['expires_at']) < observedAt.getTime(),
      approval_decision: null,
      receipt: null,
      key_version: null,
      key_metadata_source: 'unavailable'
    }
  }

  private getAppliedMigrationVersions(database: DatabaseSync): number[] {
    return database
      .prepare(
        `SELECT version FROM greenfield_trace_schema_migrations
         ORDER BY version ASC`
      )
      .all()
      .map((row) => numberValue((row as Record<string, unknown>)['version']))
  }

  private tryRestrictPermissions(targetPath: string, mode: number): void {
    try {
      fs.chmodSync(targetPath, mode)
    } catch {
      // Platforms without POSIX permission support retain their native controls.
    }
  }
}
