import fs from 'node:fs'
import path from 'node:path'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes
} from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import type { HarnessEvent, HarnessTask, HarnessTaskView } from './contracts'
import {
  HarnessTaskStoreError,
  type HarnessEventAppend,
  type HarnessTaskStore
} from './store'

const ENCRYPTION_INFO = Buffer.from('mira-owner-harness-journal-v1')
const KEY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

const HARNESS_MIGRATIONS = [
  {
    version: 1,
    description: 'Encrypted owner harness task snapshots and append-only events',
    statements: [
      `CREATE TABLE IF NOT EXISTS greenfield_harness_schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS greenfield_harness_tasks (
        task_id TEXT PRIMARY KEY,
        stable_owner_hash TEXT NOT NULL,
        idempotency_hash TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        active_capability_id TEXT NOT NULL,
        context_id_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        encryption_key_id TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        initialization_vector BLOB NOT NULL,
        authentication_tag BLOB NOT NULL
      ) STRICT`,
      `CREATE INDEX IF NOT EXISTS idx_greenfield_harness_tasks_owner_updated
        ON greenfield_harness_tasks(stable_owner_hash, updated_at DESC)`,
      `CREATE TABLE IF NOT EXISTS greenfield_harness_events (
        task_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        state TEXT NOT NULL,
        capability_id TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        encryption_key_id TEXT NOT NULL,
        record_hash TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        initialization_vector BLOB NOT NULL,
        authentication_tag BLOB NOT NULL,
        PRIMARY KEY(task_id, sequence),
        FOREIGN KEY(task_id) REFERENCES greenfield_harness_tasks(task_id)
      ) STRICT`,
      `CREATE TRIGGER IF NOT EXISTS greenfield_harness_events_no_update
        BEFORE UPDATE ON greenfield_harness_events
        BEGIN
          SELECT RAISE(ABORT, 'harness events are append-only');
        END`,
      `CREATE TRIGGER IF NOT EXISTS greenfield_harness_events_no_delete
        BEFORE DELETE ON greenfield_harness_events
        BEGIN
          SELECT RAISE(ABORT, 'harness events cannot be deleted outside an approved retention migration');
        END`,
      `CREATE TRIGGER IF NOT EXISTS greenfield_harness_tasks_no_delete
        BEFORE DELETE ON greenfield_harness_tasks
        BEGIN
          SELECT RAISE(ABORT, 'harness tasks cannot be deleted outside an approved retention migration');
        END`
    ]
  }
] as const

export interface EncryptedHarnessTaskStoreConfig {
  enabled: boolean
  databasePath: string
  masterKeyBase64: string
  ownerLookupKeyBase64: string
  keyVersion: string
}

interface TaskRow {
  task_id: string
  stable_owner_hash: string
  idempotency_hash: string
  state: string
  capability_id: string
  active_capability_id: string
  context_id_hash: string
  created_at: number
  updated_at: number
  completed_at: number | null
  encryption_key_id: string
  record_hash: string
  ciphertext: Uint8Array
  initialization_vector: Uint8Array
  authentication_tag: Uint8Array
}

interface EventRow {
  task_id: string
  sequence: number
  event_id: string
  event_type: string
  state: string
  capability_id: string
  occurred_at: number
  encryption_key_id: string
  record_hash: string
  ciphertext: Uint8Array
  initialization_vector: Uint8Array
  authentication_tag: Uint8Array
}

function decodeKey(value: string, variableName: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== 32) {
    throw new HarnessTaskStoreError(
      'harness.key_invalid',
      `${variableName} must contain a base64-encoded 32-byte key.`
    )
  }
  return decoded
}

function deriveEncryptionKey(masterKey: Buffer): Buffer {
  return Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.alloc(0), ENCRYPTION_INFO, 32)
  )
}

function stableHash(key: Buffer, kind: string, value: string): string {
  return createHmac('sha256', key).update(`${kind}:${value}`).digest('hex')
}

function recordHash(
  aad: Uint8Array,
  iv: Uint8Array,
  tag: Uint8Array,
  ciphertext: Uint8Array
): string {
  return createHash('sha256')
    .update(aad)
    .update(iv)
    .update(tag)
    .update(ciphertext)
    .digest('hex')
}

function timestamp(value: string | null): number | null {
  if (value === null) return null
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    throw new HarnessTaskStoreError(
      'harness.timestamp_invalid',
      'Harness task and event timestamps must be valid ISO 8601 values.'
    )
  }
  return parsed
}

function stringValue(value: unknown): string {
  return value == null ? '' : String(value)
}

function numberValue(value: unknown): number {
  return Number(value)
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value)
}

function bytesValue(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  throw new HarnessTaskStoreError(
    'harness.storage_corrupt',
    'Harness journal contains an invalid encrypted binary value.'
  )
}

function mapTaskRow(row: Record<string, unknown>): TaskRow {
  return {
    task_id: stringValue(row['task_id']),
    stable_owner_hash: stringValue(row['stable_owner_hash']),
    idempotency_hash: stringValue(row['idempotency_hash']),
    state: stringValue(row['state']),
    capability_id: stringValue(row['capability_id']),
    active_capability_id: stringValue(row['active_capability_id']),
    context_id_hash: stringValue(row['context_id_hash']),
    created_at: numberValue(row['created_at']),
    updated_at: numberValue(row['updated_at']),
    completed_at: nullableNumber(row['completed_at']),
    encryption_key_id: stringValue(row['encryption_key_id']),
    record_hash: stringValue(row['record_hash']),
    ciphertext: bytesValue(row['ciphertext']),
    initialization_vector: bytesValue(row['initialization_vector']),
    authentication_tag: bytesValue(row['authentication_tag'])
  }
}

function mapEventRow(row: Record<string, unknown>): EventRow {
  return {
    task_id: stringValue(row['task_id']),
    sequence: numberValue(row['sequence']),
    event_id: stringValue(row['event_id']),
    event_type: stringValue(row['event_type']),
    state: stringValue(row['state']),
    capability_id: stringValue(row['capability_id']),
    occurred_at: numberValue(row['occurred_at']),
    encryption_key_id: stringValue(row['encryption_key_id']),
    record_hash: stringValue(row['record_hash']),
    ciphertext: bytesValue(row['ciphertext']),
    initialization_vector: bytesValue(row['initialization_vector']),
    authentication_tag: bytesValue(row['authentication_tag'])
  }
}

function taskAad(row: Omit<TaskRow, 'record_hash' | 'ciphertext' | 'initialization_vector' | 'authentication_tag'>): Buffer {
  return Buffer.from(
    JSON.stringify({
      task_id: row.task_id,
      stable_owner_hash: row.stable_owner_hash,
      idempotency_hash: row.idempotency_hash,
      state: row.state,
      capability_id: row.capability_id,
      active_capability_id: row.active_capability_id,
      context_id_hash: row.context_id_hash,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at,
      encryption_key_id: row.encryption_key_id
    })
  )
}

function eventAad(row: Omit<EventRow, 'record_hash' | 'ciphertext' | 'initialization_vector' | 'authentication_tag'>): Buffer {
  return Buffer.from(
    JSON.stringify({
      task_id: row.task_id,
      sequence: row.sequence,
      event_id: row.event_id,
      event_type: row.event_type,
      state: row.state,
      capability_id: row.capability_id,
      occurred_at: row.occurred_at,
      encryption_key_id: row.encryption_key_id
    })
  )
}

export class EncryptedSqliteHarnessTaskStore implements HarnessTaskStore {
  private database: DatabaseSync | null = null
  private encryptionKey: Buffer | null = null
  private ownerLookupKey: Buffer | null = null

  public constructor(private readonly config: EncryptedHarnessTaskStoreConfig) {}

  public static fromProcessEnv(
    env: NodeJS.ProcessEnv = process.env
  ): EncryptedSqliteHarnessTaskStore {
    return new EncryptedSqliteHarnessTaskStore({
      enabled:
        env['MIRA_GREENFIELD_ENABLED'] === 'true' &&
        env['MIRA_HARNESS_ENABLED'] === 'true' &&
        env['MIRA_HARNESS_PERSISTENCE'] === 'true',
      databasePath:
        env['MIRA_HARNESS_DB_PATH'] ||
        path.join(process.cwd(), 'core', 'data', 'greenfield', 'harness.sqlite'),
      masterKeyBase64: env['MIRA_HARNESS_MASTER_KEY'] || '',
      ownerLookupKeyBase64: env['MIRA_GREENFIELD_OWNER_LOOKUP_KEY'] || '',
      keyVersion: env['MIRA_HARNESS_KEY_VERSION'] || 'v1'
    })
  }

  public create(task: HarnessTask): HarnessTask {
    const database = this.getDatabase()
    const row = this.encryptTask(task)
    try {
      database
        .prepare(
          `INSERT INTO greenfield_harness_tasks (
            task_id, stable_owner_hash, idempotency_hash, state, capability_id,
            active_capability_id, context_id_hash, created_at, updated_at,
            completed_at, encryption_key_id, record_hash, ciphertext,
            initialization_vector, authentication_tag
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.task_id,
          row.stable_owner_hash,
          row.idempotency_hash,
          row.state,
          row.capability_id,
          row.active_capability_id,
          row.context_id_hash,
          row.created_at,
          row.updated_at,
          row.completed_at,
          row.encryption_key_id,
          row.record_hash,
          row.ciphertext,
          row.initialization_vector,
          row.authentication_tag
        )
    } catch (error) {
      throw new HarnessTaskStoreError(
        'harness.task_persist_failed',
        'The encrypted harness task could not be created.',
        error instanceof Error ? error.message : String(error)
      )
    }
    return structuredClone(task)
  }

  public findByIdempotency(
    ownerId: string,
    idempotencyKey: string
  ): HarnessTask | null {
    const ownerLookupKey = this.getOwnerLookupKey()
    const hash = stableHash(
      ownerLookupKey,
      'harness-idempotency',
      `${ownerId}\u0000${idempotencyKey}`
    )
    const row = this.getDatabase()
      .prepare('SELECT * FROM greenfield_harness_tasks WHERE idempotency_hash = ?')
      .get(hash) as Record<string, unknown> | undefined
    return row ? this.decryptTask(mapTaskRow(row)) : null
  }

  public read(taskId: string): HarnessTask | null {
    const row = this.getDatabase()
      .prepare('SELECT * FROM greenfield_harness_tasks WHERE task_id = ?')
      .get(taskId) as Record<string, unknown> | undefined
    return row ? this.decryptTask(mapTaskRow(row)) : null
  }

  public replace(task: HarnessTask): HarnessTask {
    const existing = this.read(task.task_id)
    if (!existing) {
      throw new HarnessTaskStoreError(
        'harness.task_not_found',
        'The harness task does not exist.'
      )
    }
    if (
      existing.owner_id !== task.owner_id ||
      existing.idempotency_key !== task.idempotency_key ||
      existing.created_at !== task.created_at
    ) {
      throw new HarnessTaskStoreError(
        'harness.task_immutable_field_changed',
        'An immutable harness task field was changed.'
      )
    }
    const row = this.encryptTask(task)
    this.getDatabase()
      .prepare(
        `UPDATE greenfield_harness_tasks SET
          state = ?, active_capability_id = ?, updated_at = ?, completed_at = ?,
          record_hash = ?, ciphertext = ?, initialization_vector = ?,
          authentication_tag = ?
        WHERE task_id = ?`
      )
      .run(
        row.state,
        row.active_capability_id,
        row.updated_at,
        row.completed_at,
        row.record_hash,
        row.ciphertext,
        row.initialization_vector,
        row.authentication_tag,
        row.task_id
      )
    return structuredClone(task)
  }

  public appendEvent(event: HarnessEventAppend): HarnessEvent {
    const database = this.getDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      const exists = database
        .prepare('SELECT task_id FROM greenfield_harness_tasks WHERE task_id = ?')
        .get(event.task_id)
      if (!exists) {
        throw new HarnessTaskStoreError(
          'harness.task_not_found',
          'Cannot append an event for an unknown harness task.'
        )
      }
      const sequenceRow = database
        .prepare(
          'SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM greenfield_harness_events WHERE task_id = ?'
        )
        .get(event.task_id) as Record<string, unknown>
      const storedEvent: HarnessEvent = {
        ...structuredClone(event),
        sequence: numberValue(sequenceRow['next_sequence'])
      }
      const row = this.encryptEvent(storedEvent)
      database
        .prepare(
          `INSERT INTO greenfield_harness_events (
            task_id, sequence, event_id, event_type, state, capability_id,
            occurred_at, encryption_key_id, record_hash, ciphertext,
            initialization_vector, authentication_tag
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          row.task_id,
          row.sequence,
          row.event_id,
          row.event_type,
          row.state,
          row.capability_id,
          row.occurred_at,
          row.encryption_key_id,
          row.record_hash,
          row.ciphertext,
          row.initialization_vector,
          row.authentication_tag
        )
      database.exec('COMMIT')
      return structuredClone(storedEvent)
    } catch (error) {
      database.exec('ROLLBACK')
      if (error instanceof HarnessTaskStoreError) throw error
      throw new HarnessTaskStoreError(
        'harness.event_persist_failed',
        'The encrypted harness event could not be appended.',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  public readView(taskId: string, afterSequence = 0): HarnessTaskView | null {
    const task = this.read(taskId)
    if (!task) return null
    const rows = this.getDatabase()
      .prepare(
        'SELECT * FROM greenfield_harness_events WHERE task_id = ? AND sequence > ? ORDER BY sequence ASC'
      )
      .all(taskId, afterSequence) as Record<string, unknown>[]
    const latestRow = this.getDatabase()
      .prepare(
        'SELECT COALESCE(MAX(sequence), 0) AS latest_sequence FROM greenfield_harness_events WHERE task_id = ?'
      )
      .get(taskId) as Record<string, unknown>
    return {
      task,
      events: rows.map((row) => this.decryptEvent(mapEventRow(row))),
      latest_sequence: numberValue(latestRow['latest_sequence'])
    }
  }

  public appliedMigrationVersions(): number[] {
    return (
      this.getDatabase()
        .prepare(
          'SELECT version FROM greenfield_harness_schema_migrations ORDER BY version ASC'
        )
        .all() as Record<string, unknown>[]
    ).map((row) => numberValue(row['version']))
  }

  public close(): void {
    this.database?.close()
    this.database = null
    this.encryptionKey = null
    this.ownerLookupKey = null
  }

  private getDatabase(): DatabaseSync {
    if (!this.config.enabled) {
      throw new HarnessTaskStoreError(
        'harness.persistence_disabled',
        'Encrypted harness persistence is disabled.'
      )
    }
    if (!this.database) {
      if (!KEY_VERSION_PATTERN.test(this.config.keyVersion)) {
        throw new HarnessTaskStoreError(
          'harness.key_version_invalid',
          'The harness key version is invalid.'
        )
      }
      fs.mkdirSync(path.dirname(this.config.databasePath), { recursive: true })
      this.database = new DatabaseSync(this.config.databasePath)
      this.database.exec('PRAGMA journal_mode = WAL')
      this.database.exec('PRAGMA foreign_keys = ON')
      this.database.exec('PRAGMA synchronous = FULL')
      this.applyMigrations(this.database)
    }
    return this.database
  }

  private getEncryptionKey(): Buffer {
    if (!this.encryptionKey) {
      this.encryptionKey = deriveEncryptionKey(
        decodeKey(this.config.masterKeyBase64, 'MIRA_HARNESS_MASTER_KEY')
      )
    }
    return this.encryptionKey
  }

  private getOwnerLookupKey(): Buffer {
    if (!this.ownerLookupKey) {
      this.ownerLookupKey = decodeKey(
        this.config.ownerLookupKeyBase64,
        'MIRA_GREENFIELD_OWNER_LOOKUP_KEY'
      )
    }
    return this.ownerLookupKey
  }

  private applyMigrations(database: DatabaseSync): void {
    database.exec(
      `CREATE TABLE IF NOT EXISTS greenfield_harness_schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT`
    )
    const applied = new Set(
      (
        database
          .prepare('SELECT version FROM greenfield_harness_schema_migrations')
          .all() as Record<string, unknown>[]
      ).map((row) => numberValue(row['version']))
    )
    for (const migration of HARNESS_MIGRATIONS) {
      if (applied.has(migration.version)) continue
      database.exec('BEGIN IMMEDIATE')
      try {
        for (const statement of migration.statements) database.exec(statement)
        database
          .prepare(
            'INSERT INTO greenfield_harness_schema_migrations (version, description, applied_at) VALUES (?, ?, ?)'
          )
          .run(migration.version, migration.description, Date.now())
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    }
  }

  private encryptTask(task: HarnessTask): TaskRow {
    const ownerLookupKey = this.getOwnerLookupKey()
    const base = {
      task_id: task.task_id,
      stable_owner_hash: stableHash(ownerLookupKey, 'owner', task.owner_id),
      idempotency_hash: stableHash(
        ownerLookupKey,
        'harness-idempotency',
        `${task.owner_id}\u0000${task.idempotency_key}`
      ),
      state: task.state,
      capability_id: task.capability_id,
      active_capability_id: task.active_capability_id,
      context_id_hash: stableHash(ownerLookupKey, 'context', task.context_id),
      created_at: timestamp(task.created_at) || 0,
      updated_at: timestamp(task.updated_at) || 0,
      completed_at: timestamp(task.completed_at),
      encryption_key_id: this.config.keyVersion
    }
    const aad = taskAad(base)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv)
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(task), 'utf8'),
      cipher.final()
    ])
    const tag = cipher.getAuthTag()
    return {
      ...base,
      record_hash: recordHash(aad, iv, tag, ciphertext),
      ciphertext,
      initialization_vector: iv,
      authentication_tag: tag
    }
  }

  private decryptTask(row: TaskRow): HarnessTask {
    if (row.encryption_key_id !== this.config.keyVersion) {
      throw new HarnessTaskStoreError(
        'harness.key_version_unavailable',
        'The harness task requires an unavailable encryption key version.'
      )
    }
    const aad = taskAad(row)
    if (
      recordHash(
        aad,
        row.initialization_vector,
        row.authentication_tag,
        row.ciphertext
      ) !== row.record_hash
    ) {
      throw new HarnessTaskStoreError(
        'harness.record_hash_invalid',
        'The encrypted harness task record hash is invalid.'
      )
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.getEncryptionKey(),
      row.initialization_vector
    )
    decipher.setAAD(aad)
    decipher.setAuthTag(row.authentication_tag)
    const plaintext = Buffer.concat([
      decipher.update(row.ciphertext),
      decipher.final()
    ]).toString('utf8')
    const task = JSON.parse(plaintext) as HarnessTask
    if (
      task.task_id !== row.task_id ||
      task.state !== row.state ||
      task.capability_id !== row.capability_id ||
      task.active_capability_id !== row.active_capability_id
    ) {
      throw new HarnessTaskStoreError(
        'harness.authenticated_metadata_mismatch',
        'Harness task ciphertext does not match authenticated row metadata.'
      )
    }
    return task
  }

  private encryptEvent(event: HarnessEvent): EventRow {
    const base = {
      task_id: event.task_id,
      sequence: event.sequence,
      event_id: event.event_id,
      event_type: event.type,
      state: event.state,
      capability_id: event.capability_id,
      occurred_at: timestamp(event.occurred_at) || 0,
      encryption_key_id: this.config.keyVersion
    }
    const aad = eventAad(base)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv)
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(event), 'utf8'),
      cipher.final()
    ])
    const tag = cipher.getAuthTag()
    return {
      ...base,
      record_hash: recordHash(aad, iv, tag, ciphertext),
      ciphertext,
      initialization_vector: iv,
      authentication_tag: tag
    }
  }

  private decryptEvent(row: EventRow): HarnessEvent {
    if (row.encryption_key_id !== this.config.keyVersion) {
      throw new HarnessTaskStoreError(
        'harness.key_version_unavailable',
        'The harness event requires an unavailable encryption key version.'
      )
    }
    const aad = eventAad(row)
    if (
      recordHash(
        aad,
        row.initialization_vector,
        row.authentication_tag,
        row.ciphertext
      ) !== row.record_hash
    ) {
      throw new HarnessTaskStoreError(
        'harness.record_hash_invalid',
        'The encrypted harness event record hash is invalid.'
      )
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.getEncryptionKey(),
      row.initialization_vector
    )
    decipher.setAAD(aad)
    decipher.setAuthTag(row.authentication_tag)
    const plaintext = Buffer.concat([
      decipher.update(row.ciphertext),
      decipher.final()
    ]).toString('utf8')
    const event = JSON.parse(plaintext) as HarnessEvent
    if (
      event.task_id !== row.task_id ||
      event.sequence !== row.sequence ||
      event.event_id !== row.event_id ||
      event.type !== row.event_type
    ) {
      throw new HarnessTaskStoreError(
        'harness.authenticated_metadata_mismatch',
        'Harness event ciphertext does not match authenticated row metadata.'
      )
    }
    return event
  }
}
