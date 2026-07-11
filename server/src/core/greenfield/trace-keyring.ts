import fs from 'node:fs'
import path from 'node:path'
import {
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync
} from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import type { IdentityContext, VerticalSliceEnvelope } from './contracts'
import { evaluateIdentity } from './policy'
import {
  TRACE_EXPORT_CAPABILITY,
  TRACE_PURGE_CAPABILITY,
  type TraceOperation,
  type TraceOperationReceipt
} from './trace-operation-contracts'
import { canonicalHash } from './trace-operation-store'
import type {
  TraceCatalogEntry,
  TraceKeyInventoryVersion,
  TraceOperationDashboardPlan
} from './trace-key-readiness'
import { TRACE_KEY_MIGRATIONS } from './trace-key-migrations'
import type { TraceChainVerification } from './trace-store'
import { validateVerticalSliceEnvelope } from './validation'

const KEY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const TRACE_SCHEMA_VERSION = 1
const TRACE_ENCRYPTION_INFO = Buffer.from('mira-greenfield-trace-v1')
const OPERATION_ENCRYPTION_INFO = Buffer.from(
  'mira-greenfield-trace-operation-v1'
)
const TRACE_CATALOG_LIMIT = 200
const OPERATION_HISTORY_LIMIT = 50

export interface TraceReadKeyringConfig {
  enabled: boolean
  databasePath: string
  activeKeyVersion: string
  activeMasterKeyBase64: string
  ownerLookupKeyBase64: string
  keyringJson: string
}

export interface TraceReadKeyDescriptor {
  key_version: string
  encryption_key_id: string
  active: boolean
}

export interface StableOwnerKeyBinding {
  stable_owner_ref: string
  key_version: string
  encryption_key_id: string
  owner_ref: string
  registered_at: string
  metadata_integrity_valid: boolean
}

export interface TraceKeyringOwnerInventory {
  stable_owner_ref: string
  active_key_version: string
  configured_keys: TraceReadKeyDescriptor[]
  bindings: StableOwnerKeyBinding[]
  traces: TraceCatalogEntry[]
  plans: TraceOperationDashboardPlan[]
  chain: TraceChainVerification
  unreadable_trace_ids: string[]
  unreadable_plan_ids: string[]
  setup_ready: boolean
  blockers: string[]
}

export interface KeyringTraceReadResult {
  envelope: VerticalSliceEnvelope
  trace: TraceCatalogEntry
}

export class TraceKeyringError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'TraceKeyringError'
  }
}

interface ReadKey {
  version: string
  encryptionKeyId: string
  key: Buffer
  active: boolean
}

interface BindingRow {
  stable_owner_hash: string
  key_version: string
  encryption_key_id: string
  owner_hash: string
  registered_at: number
  metadata_hash: string
}

interface TraceRow {
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

interface OperationPlanRow {
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

interface PlanSecretPayload {
  ownerId: string
  deviceId: string
  authSessionId: string
  traceIds: string[]
  recordHashes: string[]
  reasonCode: string
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function decodeKey(value: string, variableName: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== 32) {
    throw new TraceKeyringError(
      'trace_keyring.key_invalid',
      `${variableName} must contain a base64-encoded 32-byte key.`,
      503
    )
  }
  return decoded
}

function validateKeyVersion(value: string): string {
  if (!KEY_VERSION_PATTERN.test(value)) {
    throw new TraceKeyringError(
      'trace_keyring.version_invalid',
      'Trace key versions must be stable lowercase identifiers.',
      503,
      value
    )
  }
  return value
}

function keyedIdentifier(key: Buffer, kind: string, value: string): string {
  return createHmac('sha256', key).update(`${kind}:${value}`).digest('hex')
}

function reference(kind: string, hash: string): string {
  return `${kind}:${hash.slice(0, 24)}`
}

function deriveOwnerKey(
  masterKey: Buffer,
  ownerId: string,
  info: Buffer
): Buffer {
  return Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.from(ownerId), info, 32)
  )
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
  throw new TraceKeyringError(
    'trace_keyring.storage_corrupt',
    'Keyring storage contains an invalid binary value.',
    500
  )
}

function parseJsonArray(value: unknown): string[] {
  const parsed = JSON.parse(stringValue(value) || '[]') as unknown
  return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : []
}

function tableExists(database: DatabaseSync, tableName: string): boolean {
  return Boolean(
    database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = ? LIMIT 1`
      )
      .get(tableName)
  )
}

function mapBindingRow(row: Record<string, unknown>): BindingRow {
  return {
    stable_owner_hash: stringValue(row['stable_owner_hash']),
    key_version: stringValue(row['key_version']),
    encryption_key_id: stringValue(row['encryption_key_id']),
    owner_hash: stringValue(row['owner_hash']),
    registered_at: numberValue(row['registered_at']),
    metadata_hash: stringValue(row['metadata_hash'])
  }
}

function mapTraceRow(row: Record<string, unknown>): TraceRow {
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

function mapOperationPlanRow(row: Record<string, unknown>): OperationPlanRow {
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

function buildTraceAAD(row: TraceRow): Buffer {
  return Buffer.from(
    JSON.stringify({
      schema_version: TRACE_SCHEMA_VERSION,
      trace_id: row.trace_id,
      owner_hash: row.owner_hash,
      device_hash: row.device_hash,
      origin_event_id: row.origin_event_id,
      event_type: row.event_type,
      occurred_at: row.occurred_at,
      completed_at: row.completed_at,
      privacy_classification: row.privacy_classification,
      previous_record_hash: row.previous_record_hash,
      retention_until: row.retention_until,
      encryption_key_id: row.encryption_key_id
    })
  )
}

function computeTraceRecordHash(row: TraceRow): string {
  return sha256(
    Buffer.concat([
      buildTraceAAD(row),
      Buffer.from(row.initialization_vector),
      Buffer.from(row.authentication_tag),
      Buffer.from(row.ciphertext)
    ])
  )
}

function buildPlanAAD(row: OperationPlanRow): Buffer {
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

function computeOperationPlanHash(row: OperationPlanRow): string {
  return createHash('sha256')
    .update(buildPlanAAD(row))
    .update(row.initialization_vector)
    .update(row.authentication_tag)
    .update(row.ciphertext)
    .digest('hex')
}

function bindingMetadataHash(row: Omit<BindingRow, 'metadata_hash'>): string {
  return canonicalHash({
    stable_owner_hash: row.stable_owner_hash,
    key_version: row.key_version,
    encryption_key_id: row.encryption_key_id,
    owner_hash: row.owner_hash,
    registered_at: row.registered_at
  })
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

export class TraceReadKeyring {
  private database: DatabaseSync | null = null
  private lookupKey: Buffer | null = null
  private keys: Map<string, ReadKey> | null = null

  public constructor(
    private readonly config: TraceReadKeyringConfig,
    private readonly now: () => Date = () => new Date()
  ) {}

  public static fromProcessEnv(
    env: NodeJS.ProcessEnv = process.env
  ): TraceReadKeyring {
    return new TraceReadKeyring({
      enabled:
        env['MIRA_GREENFIELD_ENABLED'] === 'true' &&
        env['MIRA_GREENFIELD_TRACE_PERSISTENCE'] === 'true' &&
        env['MIRA_GREENFIELD_TRACE_OPERATIONS'] === 'true',
      databasePath:
        env['MIRA_GREENFIELD_TRACE_DB_PATH'] ||
        path.join(process.cwd(), 'core', 'data', 'greenfield', 'traces.sqlite'),
      activeKeyVersion: env['MIRA_GREENFIELD_TRACE_KEY_VERSION'] || 'v1',
      activeMasterKeyBase64: env['MIRA_GREENFIELD_TRACE_MASTER_KEY'] || '',
      ownerLookupKeyBase64:
        env['MIRA_GREENFIELD_OWNER_LOOKUP_KEY'] || '',
      keyringJson: env['MIRA_GREENFIELD_TRACE_KEYRING_JSON'] || ''
    })
  }

  public prepareOwner(ownerId: string): StableOwnerKeyBinding[] {
    const database = this.ensureDatabase()
    const keys = this.ensureKeys()
    const lookupKey = this.ensureLookupKey()
    const stableOwnerHash = keyedIdentifier(lookupKey, 'owner', ownerId)
    const registeredAt = this.now().getTime()

    for (const key of keys.values()) {
      this.registerKey(database, key, registeredAt)
      this.registerOwnerBinding(
        database,
        stableOwnerHash,
        ownerId,
        key,
        registeredAt
      )
    }

    return this.readBindings(database, stableOwnerHash).map((binding) => ({
      stable_owner_ref: reference('stable-owner', binding.stable_owner_hash),
      key_version: binding.key_version,
      encryption_key_id: binding.encryption_key_id,
      owner_ref: reference('owner', binding.owner_hash),
      registered_at: new Date(binding.registered_at).toISOString(),
      metadata_integrity_valid:
        binding.metadata_hash ===
        bindingMetadataHash({
          stable_owner_hash: binding.stable_owner_hash,
          key_version: binding.key_version,
          encryption_key_id: binding.encryption_key_id,
          owner_hash: binding.owner_hash,
          registered_at: binding.registered_at
        })
    }))
  }

  public getConfiguredKeys(): TraceReadKeyDescriptor[] {
    return [...this.ensureKeys().values()].map((key) => ({
      key_version: key.version,
      encryption_key_id: key.encryptionKeyId,
      active: key.active
    }))
  }

  public hasVersion(version: string): boolean {
    return this.ensureKeys().has(version)
  }

  public getEncryptionKeyId(version: string): string | null {
    return this.ensureKeys().get(version)?.encryptionKeyId || null
  }

  public getActiveVersion(): string {
    return validateKeyVersion(this.config.activeKeyVersion)
  }

  public getActiveKey(): Buffer {
    const active = this.ensureKeys().get(this.getActiveVersion())
    if (!active) {
      throw new TraceKeyringError(
        'trace_keyring.active_key_missing',
        'The active trace key version is absent from the configured keyring.',
        503
      )
    }
    return Buffer.from(active.key)
  }

  public getOwnerInventory(
    identity: IdentityContext,
    observedAt = this.now()
  ): TraceKeyringOwnerInventory {
    this.assertOwnerRead(identity)
    const bindings = this.prepareOwner(identity.owner_id)
    const database = this.ensureDatabase()
    const stableOwnerHash = keyedIdentifier(
      this.ensureLookupKey(),
      'owner',
      identity.owner_id
    )
    const bindingRows = this.readBindings(database, stableOwnerHash)
    const ownerHashes = bindingRows.map((binding) => binding.owner_hash)
    const traceRows = this.readTraceRows(database, ownerHashes)
    const planRows = this.readPlanRows(database, ownerHashes)
    const bindingByOwnerHash = new Map(
      bindingRows.map((binding) => [binding.owner_hash, binding])
    )
    const keyById = new Map(
      [...this.ensureKeys().values()].map((key) => [key.encryptionKeyId, key])
    )
    const unreadableTraceIds: string[] = []
    const traces: TraceCatalogEntry[] = []

    for (const row of traceRows.slice(0, TRACE_CATALOG_LIMIT)) {
      try {
        this.decryptTraceRow(identity.owner_id, row, keyById)
        const binding = bindingByOwnerHash.get(row.owner_hash)
        traces.push({
          trace_id: row.trace_id,
          event_type: row.event_type,
          occurred_at: new Date(row.occurred_at).toISOString(),
          completed_at: new Date(row.completed_at).toISOString(),
          privacy_classification: row.privacy_classification,
          record_hash: row.record_hash,
          retention_until: new Date(row.retention_until).toISOString(),
          encryption_key_id: row.encryption_key_id,
          encryption_key_version: binding?.key_version || null,
          created_at: new Date(row.created_at).toISOString()
        })
      } catch {
        unreadableTraceIds.push(row.trace_id)
      }
    }

    const plans: TraceOperationDashboardPlan[] = []
    const unreadablePlanIds: string[] = []
    for (const row of planRows.slice(0, OPERATION_HISTORY_LIMIT)) {
      try {
        plans.push(
          this.decryptPlanRow(
            database,
            identity.owner_id,
            row,
            bindingByOwnerHash,
            observedAt
          )
        )
      } catch {
        unreadablePlanIds.push(row.plan_id)
      }
    }

    const chain = this.verifyRows(
      database,
      traceRows,
      new Set(ownerHashes)
    )
    const configuredKeys = this.getConfiguredKeys()
    const blockers: string[] = []
    if (bindings.some((binding) => !binding.metadata_integrity_valid)) {
      blockers.push('rotation.owner_binding_integrity_failed')
    }
    if (unreadableTraceIds.length > 0) {
      blockers.push('rotation.trace_keyring_unreadable_records')
    }
    if (unreadablePlanIds.length > 0) {
      blockers.push('rotation.operation_keyring_unreadable_plans')
    }
    if (!chain.valid) {
      blockers.push('rotation.multi_key_trace_chain_invalid')
    }

    return {
      stable_owner_ref: reference('stable-owner', stableOwnerHash),
      active_key_version: this.getActiveVersion(),
      configured_keys: configuredKeys,
      bindings,
      traces,
      plans,
      chain,
      unreadable_trace_ids: unreadableTraceIds,
      unreadable_plan_ids: unreadablePlanIds,
      setup_ready: blockers.length === 0,
      blockers
    }
  }

  public readTrace(ownerId: string, traceId: string): KeyringTraceReadResult | null {
    this.prepareOwner(ownerId)
    const database = this.ensureDatabase()
    const stableOwnerHash = keyedIdentifier(
      this.ensureLookupKey(),
      'owner',
      ownerId
    )
    const bindings = this.readBindings(database, stableOwnerHash)
    const rows = this.readTraceRows(
      database,
      bindings.map((binding) => binding.owner_hash),
      traceId
    )
    if (rows.length === 0) {
      return null
    }
    const row = rows[0]
    if (!row) {
      return null
    }
    const keyById = new Map(
      [...this.ensureKeys().values()].map((key) => [key.encryptionKeyId, key])
    )
    const envelope = this.decryptTraceRow(ownerId, row, keyById)
    const binding = bindings.find(
      (candidate) => candidate.owner_hash === row.owner_hash
    )
    return {
      envelope,
      trace: {
        trace_id: row.trace_id,
        event_type: row.event_type,
        occurred_at: new Date(row.occurred_at).toISOString(),
        completed_at: new Date(row.completed_at).toISOString(),
        privacy_classification: row.privacy_classification,
        record_hash: row.record_hash,
        retention_until: new Date(row.retention_until).toISOString(),
        encryption_key_id: row.encryption_key_id,
        encryption_key_version: binding?.key_version || null,
        created_at: new Date(row.created_at).toISOString()
      }
    }
  }

  public getVersionInventory(ownerId: string): TraceKeyInventoryVersion[] {
    this.prepareOwner(ownerId)
    const database = this.ensureDatabase()
    const stableOwnerHash = keyedIdentifier(
      this.ensureLookupKey(),
      'owner',
      ownerId
    )
    const bindings = this.readBindings(database, stableOwnerHash)
    const counts = new Map<string, number>()
    for (const row of this.readTraceRows(
      database,
      bindings.map((binding) => binding.owner_hash)
    )) {
      counts.set(row.encryption_key_id, (counts.get(row.encryption_key_id) || 0) + 1)
    }
    const keyById = new Map(
      [...this.ensureKeys().values()].map((key) => [key.encryptionKeyId, key])
    )
    return [...counts.entries()].map(([keyId, traceCount]) => ({
      encryption_key_id: keyId,
      key_version: keyById.get(keyId)?.version || null,
      trace_count: traceCount,
      active: keyById.get(keyId)?.active || false
    }))
  }

  public close(): void {
    this.database?.close()
    this.database = null
    this.lookupKey = null
    this.keys = null
  }

  private assertOwnerRead(identity: IdentityContext): void {
    const decision = evaluateIdentity(identity)
    if (!decision.allowed) {
      throw new TraceKeyringError(
        decision.code,
        decision.reasons.join(' '),
        403
      )
    }
    if (!identity.permissions.includes('trace.operations.read')) {
      throw new TraceKeyringError(
        'trace_keyring.permission_missing',
        'The authenticated owner session lacks trace operations read permission.',
        403
      )
    }
    if (!identity.privacy_zones.includes('private')) {
      throw new TraceKeyringError(
        'trace_keyring.privacy_zone_denied',
        'The authenticated owner session cannot access private trace records.',
        403
      )
    }
  }

  private ensureDatabase(): DatabaseSync {
    if (!this.config.enabled) {
      throw new TraceKeyringError(
        'trace_keyring.disabled',
        'The stable owner trace keyring is disabled.',
        503
      )
    }
    if (this.database) {
      return this.database
    }
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

  private ensureLookupKey(): Buffer {
    this.ensureDatabase()
    if (!this.lookupKey) {
      this.lookupKey = decodeKey(
        this.config.ownerLookupKeyBase64,
        'MIRA_GREENFIELD_OWNER_LOOKUP_KEY'
      )
    }
    return this.lookupKey
  }

  private ensureKeys(): Map<string, ReadKey> {
    if (this.keys) {
      return this.keys
    }
    const activeVersion = validateKeyVersion(this.config.activeKeyVersion)
    const activeKey = decodeKey(
      this.config.activeMasterKeyBase64,
      'MIRA_GREENFIELD_TRACE_MASTER_KEY'
    )
    let parsed: unknown = {}
    if (this.config.keyringJson.trim()) {
      try {
        parsed = JSON.parse(this.config.keyringJson) as unknown
      } catch (error) {
        throw new TraceKeyringError(
          'trace_keyring.json_invalid',
          'MIRA_GREENFIELD_TRACE_KEYRING_JSON must be a JSON object.',
          503,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TraceKeyringError(
        'trace_keyring.json_invalid',
        'MIRA_GREENFIELD_TRACE_KEYRING_JSON must be a JSON object.',
        503
      )
    }
    const entries = new Map<string, string>(
      Object.entries(parsed as Record<string, unknown>).map(([version, value]) => [
        validateKeyVersion(version),
        String(value)
      ])
    )
    const activeConfigured = entries.get(activeVersion)
    if (activeConfigured) {
      const configuredKey = decodeKey(
        activeConfigured,
        `MIRA_GREENFIELD_TRACE_KEYRING_JSON.${activeVersion}`
      )
      if (!configuredKey.equals(activeKey)) {
        throw new TraceKeyringError(
          'trace_keyring.active_key_mismatch',
          'The active keyring entry does not match MIRA_GREENFIELD_TRACE_MASTER_KEY.',
          503
        )
      }
    } else {
      entries.set(activeVersion, this.config.activeMasterKeyBase64)
    }
    const keys = new Map<string, ReadKey>()
    const fingerprints = new Map<string, string>()
    for (const [version, encoded] of [...entries.entries()].sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      const key = decodeKey(
        encoded,
        `MIRA_GREENFIELD_TRACE_KEYRING_JSON.${version}`
      )
      const encryptionKeyId = sha256(key).slice(0, 16)
      const existingVersion = fingerprints.get(encryptionKeyId)
      if (existingVersion && existingVersion !== version) {
        throw new TraceKeyringError(
          'trace_keyring.key_material_reused',
          'The same key material cannot be registered under multiple versions.',
          503,
          { existingVersion, duplicateVersion: version }
        )
      }
      fingerprints.set(encryptionKeyId, version)
      keys.set(version, {
        version,
        encryptionKeyId,
        key,
        active: version === activeVersion
      })
    }
    this.keys = keys
    return keys
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
        throw new TraceKeyringError(
          'trace_keyring.migration_failed',
          `Trace keyring migration ${migration.version} failed.`,
          500,
          error instanceof Error ? error.message : String(error)
        )
      }
    }
  }

  private registerKey(
    database: DatabaseSync,
    key: ReadKey,
    registeredAt: number
  ): void {
    const byVersion = database
      .prepare(
        `SELECT * FROM greenfield_trace_key_versions
         WHERE key_version = ? LIMIT 1`
      )
      .get(key.version) as Record<string, unknown> | undefined
    if (byVersion) {
      if (stringValue(byVersion['encryption_key_id']) !== key.encryptionKeyId) {
        throw new TraceKeyringError(
          'trace_keyring.version_conflict',
          'A registered key version points to different key material.',
          409,
          key.version
        )
      }
      const expectedHash = keyMetadataHash({
        keyVersion: key.version,
        encryptionKeyId: key.encryptionKeyId,
        algorithm: 'aes-256-gcm',
        registeredAt: numberValue(byVersion['registered_at'])
      })
      if (expectedHash !== stringValue(byVersion['metadata_hash'])) {
        throw new TraceKeyringError(
          'trace_keyring.registry_integrity_failed',
          'The trace key registry metadata failed integrity verification.',
          500,
          key.version
        )
      }
      return
    }
    const byId = database
      .prepare(
        `SELECT key_version FROM greenfield_trace_key_versions
         WHERE encryption_key_id = ? LIMIT 1`
      )
      .get(key.encryptionKeyId) as Record<string, unknown> | undefined
    if (byId) {
      throw new TraceKeyringError(
        'trace_keyring.key_material_reused',
        'Registered key material already has a different version.',
        409,
        stringValue(byId['key_version'])
      )
    }
    const metadataHash = keyMetadataHash({
      keyVersion: key.version,
      encryptionKeyId: key.encryptionKeyId,
      algorithm: 'aes-256-gcm',
      registeredAt
    })
    database
      .prepare(
        `INSERT INTO greenfield_trace_key_versions (
           key_version, encryption_key_id, algorithm, registered_at, metadata_hash
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        key.version,
        key.encryptionKeyId,
        'aes-256-gcm',
        registeredAt,
        metadataHash
      )
  }

  private registerOwnerBinding(
    database: DatabaseSync,
    stableOwnerHash: string,
    ownerId: string,
    key: ReadKey,
    registeredAt: number
  ): void {
    const ownerHash = keyedIdentifier(key.key, 'owner', ownerId)
    const existing = database
      .prepare(
        `SELECT * FROM greenfield_trace_owner_key_bindings
         WHERE stable_owner_hash = ? AND key_version = ? LIMIT 1`
      )
      .get(stableOwnerHash, key.version) as Record<string, unknown> | undefined
    if (existing) {
      const row = mapBindingRow(existing)
      if (
        row.encryption_key_id !== key.encryptionKeyId ||
        row.owner_hash !== ownerHash ||
        row.metadata_hash !==
          bindingMetadataHash({
            stable_owner_hash: row.stable_owner_hash,
            key_version: row.key_version,
            encryption_key_id: row.encryption_key_id,
            owner_hash: row.owner_hash,
            registered_at: row.registered_at
          })
      ) {
        throw new TraceKeyringError(
          'trace_keyring.owner_binding_conflict',
          'The stable owner key binding failed integrity verification.',
          500,
          key.version
        )
      }
      return
    }
    const row = {
      stable_owner_hash: stableOwnerHash,
      key_version: key.version,
      encryption_key_id: key.encryptionKeyId,
      owner_hash: ownerHash,
      registered_at: registeredAt
    }
    database
      .prepare(
        `INSERT INTO greenfield_trace_owner_key_bindings (
           stable_owner_hash, key_version, encryption_key_id, owner_hash,
           registered_at, metadata_hash
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.stable_owner_hash,
        row.key_version,
        row.encryption_key_id,
        row.owner_hash,
        row.registered_at,
        bindingMetadataHash(row)
      )
  }

  private readBindings(
    database: DatabaseSync,
    stableOwnerHash: string
  ): BindingRow[] {
    return database
      .prepare(
        `SELECT * FROM greenfield_trace_owner_key_bindings
         WHERE stable_owner_hash = ?
         ORDER BY registered_at ASC, key_version ASC`
      )
      .all(stableOwnerHash)
      .map((row) => mapBindingRow(row as Record<string, unknown>))
  }

  private readTraceRows(
    database: DatabaseSync,
    ownerHashes: string[],
    traceId?: string
  ): TraceRow[] {
    if (
      ownerHashes.length === 0 ||
      !tableExists(database, 'greenfield_trace_records')
    ) {
      return []
    }
    const placeholders = ownerHashes.map(() => '?').join(', ')
    const traceClause = traceId ? ' AND trace_id = ?' : ''
    const values: string[] = traceId
      ? [...ownerHashes, traceId]
      : [...ownerHashes]
    return database
      .prepare(
        `SELECT * FROM greenfield_trace_records
         WHERE owner_hash IN (${placeholders})${traceClause}
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(...values)
      .map((row) => mapTraceRow(row as Record<string, unknown>))
  }

  private readPlanRows(
    database: DatabaseSync,
    ownerHashes: string[]
  ): OperationPlanRow[] {
    if (
      ownerHashes.length === 0 ||
      !tableExists(database, 'greenfield_trace_operation_plans')
    ) {
      return []
    }
    const placeholders = ownerHashes.map(() => '?').join(', ')
    return database
      .prepare(
        `SELECT * FROM greenfield_trace_operation_plans
         WHERE owner_hash IN (${placeholders})
         ORDER BY created_at DESC, rowid DESC`
      )
      .all(...ownerHashes)
      .map((row) => mapOperationPlanRow(row as Record<string, unknown>))
  }

  private decryptTraceRow(
    ownerId: string,
    row: TraceRow,
    keyById: Map<string, ReadKey>
  ): VerticalSliceEnvelope {
    if (computeTraceRecordHash(row) !== row.record_hash) {
      throw new TraceKeyringError(
        'trace_keyring.trace_integrity_failed',
        'A trace record hash does not match its encrypted contents.',
        500,
        row.trace_id
      )
    }
    const readKey = keyById.get(row.encryption_key_id)
    if (!readKey) {
      throw new TraceKeyringError(
        'trace_keyring.key_unavailable',
        'The key required to open a trace is absent from the read keyring.',
        503,
        row.encryption_key_id
      )
    }
    let envelope: VerticalSliceEnvelope
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        deriveOwnerKey(readKey.key, ownerId, TRACE_ENCRYPTION_INFO),
        Buffer.from(row.initialization_vector)
      )
      decipher.setAAD(buildTraceAAD(row))
      decipher.setAuthTag(Buffer.from(row.authentication_tag))
      envelope = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(row.ciphertext)),
          decipher.final()
        ]).toString('utf8')
      ) as VerticalSliceEnvelope
    } catch (error) {
      throw new TraceKeyringError(
        'trace_keyring.trace_decryption_failed',
        'The configured keyring could not authenticate and decrypt a trace.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
    if (
      envelope.identity.owner_id !== ownerId ||
      envelope.origin.trace_id !== row.trace_id
    ) {
      throw new TraceKeyringError(
        'trace_keyring.trace_identity_mismatch',
        'The decrypted trace does not match the requested owner and trace.',
        500
      )
    }
    const validation = validateVerticalSliceEnvelope(
      envelope,
      new Date(envelope.response.created_at)
    )
    if (!validation.valid) {
      throw new TraceKeyringError(
        'trace_keyring.trace_contract_invalid',
        'The decrypted trace no longer satisfies its contract.',
        500,
        validation.issues
      )
    }
    return validation.envelope
  }

  private decryptPlanRow(
    database: DatabaseSync,
    ownerId: string,
    row: OperationPlanRow,
    bindingByOwnerHash: Map<string, BindingRow>,
    observedAt: Date
  ): TraceOperationDashboardPlan {
    if (computeOperationPlanHash(row) !== row.plan_hash) {
      throw new TraceKeyringError(
        'trace_keyring.plan_integrity_failed',
        'An operation plan hash does not match its encrypted contents.',
        500,
        row.plan_id
      )
    }
    const binding = bindingByOwnerHash.get(row.owner_hash)
    const readKey = binding
      ? this.ensureKeys().get(binding.key_version)
      : undefined
    if (!binding || !readKey) {
      throw new TraceKeyringError(
        'trace_keyring.plan_key_unavailable',
        'The key required to open an operation plan is absent from the keyring.',
        503,
        row.plan_id
      )
    }
    let payload: PlanSecretPayload
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        deriveOwnerKey(readKey.key, ownerId, OPERATION_ENCRYPTION_INFO),
        Buffer.from(row.initialization_vector)
      )
      decipher.setAAD(buildPlanAAD(row))
      decipher.setAuthTag(Buffer.from(row.authentication_tag))
      payload = JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(row.ciphertext)),
          decipher.final()
        ]).toString('utf8')
      ) as PlanSecretPayload
    } catch (error) {
      throw new TraceKeyringError(
        'trace_keyring.plan_decryption_failed',
        'The configured keyring could not authenticate and decrypt an operation plan.',
        500,
        error instanceof Error ? error.message : String(error)
      )
    }
    if (
      payload.ownerId !== ownerId ||
      payload.traceIds.length !== row.trace_count ||
      payload.recordHashes.length !== row.trace_count
    ) {
      throw new TraceKeyringError(
        'trace_keyring.plan_scope_invalid',
        'The decrypted operation plan does not match its protected metadata.',
        500,
        row.plan_id
      )
    }
    const scopeHash = canonicalHash({
      operation: row.operation,
      trace_ids: payload.traceIds,
      record_hashes: payload.recordHashes,
      reason_code: payload.reasonCode
    })
    if (scopeHash !== row.scope_hash) {
      throw new TraceKeyringError(
        'trace_keyring.plan_scope_integrity_failed',
        'The operation plan scope hash does not match its encrypted payload.',
        500,
        row.plan_id
      )
    }
    const approvalRow = database
      .prepare(
        `SELECT decision FROM greenfield_trace_operation_approvals
         WHERE plan_id = ? LIMIT 1`
      )
      .get(row.plan_id) as Record<string, unknown> | undefined
    return {
      plan_id: row.plan_id,
      action_id: row.action_id,
      operation_trace_id: row.trace_id,
      operation: row.operation,
      risk: row.risk,
      scope_hash: row.scope_hash,
      trace_count: row.trace_count,
      trace_ids: [...payload.traceIds],
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
      created_at: new Date(row.created_at).toISOString(),
      expires_at: new Date(row.expires_at).toISOString(),
      expired: row.expires_at < observedAt.getTime(),
      approval_decision: approvalRow
        ? (stringValue(approvalRow['decision']) as 'approved' | 'rejected')
        : null,
      receipt: this.readReceipt(database, row),
      key_version: binding.key_version,
      key_metadata_source: 'active_key_decryption'
    }
  }

  private readReceipt(
    database: DatabaseSync,
    plan: OperationPlanRow
  ): TraceOperationReceipt | null {
    if (!tableExists(database, 'greenfield_trace_operation_receipts')) {
      return null
    }
    const raw = database
      .prepare(
        `SELECT * FROM greenfield_trace_operation_receipts
         WHERE plan_id = ? LIMIT 1`
      )
      .get(plan.plan_id) as Record<string, unknown> | undefined
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
    if (canonicalHash(unsigned) !== persistedHash) {
      throw new TraceKeyringError(
        'trace_keyring.receipt_integrity_failed',
        'An operation receipt failed integrity verification.',
        500,
        plan.plan_id
      )
    }
    return receipt
  }

  private verifyRows(
    database: DatabaseSync,
    rows: TraceRow[],
    ownerHashes: Set<string>
  ): TraceChainVerification {
    const purgedHashes = new Set<string>()
    if (tableExists(database, 'greenfield_trace_purge_receipts')) {
      for (const raw of database
        .prepare(
          `SELECT purged_record_hashes_json
           FROM greenfield_trace_purge_receipts`
        )
        .all()) {
        for (const hash of parseJsonArray(
          (raw as Record<string, unknown>)['purged_record_hashes_json']
        )) {
          purgedHashes.add(hash)
        }
      }
    }
    let previousExistingHash: string | null = null
    for (const row of rows) {
      if (!ownerHashes.has(row.owner_hash)) {
        continue
      }
      if (
        row.previous_record_hash !== previousExistingHash &&
        !(
          row.previous_record_hash &&
          purgedHashes.has(row.previous_record_hash)
        )
      ) {
        return {
          valid: false,
          recordCount: rows.length,
          issue: `Trace ${row.trace_id} has an invalid multi-key previous-record link.`
        }
      }
      if (computeTraceRecordHash(row) !== row.record_hash) {
        return {
          valid: false,
          recordCount: rows.length,
          issue: `Trace ${row.trace_id} failed multi-key record-hash verification.`
        }
      }
      previousExistingHash = row.record_hash
    }
    return { valid: true, recordCount: rows.length, issue: null }
  }

  private tryRestrictPermissions(targetPath: string, mode: number): void {
    try {
      fs.chmodSync(targetPath, mode)
    } catch {
      // Platforms without POSIX permission support retain native controls.
    }
  }
}
