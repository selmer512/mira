import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  EncryptedSqliteHarnessTaskStore,
  type HarnessEventAppend,
  type HarnessTask
} from '@/core/harness'

const temporaryDirectories: string[] = []

function temporaryPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-harness-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'harness.sqlite')
}

function config(databasePath: string) {
  return {
    enabled: true,
    databasePath,
    masterKeyBase64: randomBytes(32).toString('base64'),
    ownerLookupKeyBase64: randomBytes(32).toString('base64'),
    keyVersion: 'v1'
  }
}

function task(overrides: Partial<HarnessTask> = {}): HarnessTask {
  return {
    task_id: 'task-sensitive-1',
    context_id: 'context-sensitive-1',
    owner_id: 'owner-sensitive-1',
    device_id: 'device-sensitive-1',
    auth_session_id: 'session-sensitive-1',
    idempotency_key: 'idempotency-sensitive-1',
    capability_id: 'system.status.read',
    active_capability_id: 'system.status.read',
    state: 'queued',
    input_hash: 'input-hash-sensitive-1',
    messages: [
      {
        message_id: 'message-sensitive-1',
        role: 'owner',
        parts: [{ type: 'text', text: 'private owner harness input' }],
        created_at: '2026-07-15T00:00:00.000Z',
        capability_id: 'system.status.read'
      }
    ],
    artifacts: [],
    approval: null,
    error: null,
    trace_id: 'trace-sensitive-1',
    created_at: '2026-07-15T00:00:00.000Z',
    updated_at: '2026-07-15T00:00:00.000Z',
    completed_at: null,
    step_count: 0,
    max_steps: 12,
    ...overrides
  }
}

function event(overrides: Partial<HarnessEventAppend> = {}): HarnessEventAppend {
  return {
    event_id: 'event-sensitive-1',
    task_id: 'task-sensitive-1',
    context_id: 'context-sensitive-1',
    type: 'task.created',
    occurred_at: '2026-07-15T00:00:00.000Z',
    state: 'queued',
    capability_id: 'system.status.read',
    phase: null,
    message: 'private lifecycle message',
    data: { private_detail: 'sensitive event detail' },
    otel: {
      trace_id: 'trace-sensitive-1',
      span_name: 'mira.harness.task.created',
      attributes: {
        'gen_ai.operation.name': 'task.created'
      }
    },
    ...overrides
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('EncryptedSqliteHarnessTaskStore', () => {
  it('applies migration v1 and restores tasks and events after reopen', () => {
    const databasePath = temporaryPath()
    const storeConfig = config(databasePath)
    const first = new EncryptedSqliteHarnessTaskStore(storeConfig)

    first.create(task())
    const appended = first.appendEvent(event())
    expect(appended.sequence).toBe(1)
    expect(first.appliedMigrationVersions()).toEqual([1])
    first.close()

    const reopened = new EncryptedSqliteHarnessTaskStore(storeConfig)
    const view = reopened.readView('task-sensitive-1')
    expect(view?.task.owner_id).toBe('owner-sensitive-1')
    expect(view?.task.messages[0]?.parts[0]?.text).toBe(
      'private owner harness input'
    )
    expect(view?.events[0]?.data.private_detail).toBe('sensitive event detail')
    expect(reopened.appliedMigrationVersions()).toEqual([1])
    reopened.close()
  })

  it('resolves owner-keyed idempotency without storing the raw key', () => {
    const databasePath = temporaryPath()
    const store = new EncryptedSqliteHarnessTaskStore(config(databasePath))
    store.create(task())

    expect(
      store.findByIdempotency(
        'owner-sensitive-1',
        'idempotency-sensitive-1'
      )?.task_id
    ).toBe('task-sensitive-1')
    expect(
      store.findByIdempotency('different-owner', 'idempotency-sensitive-1')
    ).toBeNull()
    store.close()
  })

  it('keeps owner, device, session, input, event detail, and idempotency plaintext out of database files', () => {
    const databasePath = temporaryPath()
    const store = new EncryptedSqliteHarnessTaskStore(config(databasePath))
    store.create(task())
    store.appendEvent(event())
    store.close()

    const paths = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].filter(
      fs.existsSync
    )
    const combined = Buffer.concat(paths.map((filePath) => fs.readFileSync(filePath)))
    for (const secret of [
      'owner-sensitive-1',
      'device-sensitive-1',
      'session-sensitive-1',
      'idempotency-sensitive-1',
      'private owner harness input',
      'sensitive event detail'
    ]) {
      expect(combined.includes(Buffer.from(secret))).toBe(false)
    }
  })

  it('rejects direct event mutation and deletion', () => {
    const databasePath = temporaryPath()
    const store = new EncryptedSqliteHarnessTaskStore(config(databasePath))
    store.create(task())
    store.appendEvent(event())
    store.close()

    const database = new DatabaseSync(databasePath)
    expect(() =>
      database.exec(
        "UPDATE greenfield_harness_events SET state = 'failed' WHERE task_id = 'task-sensitive-1'"
      )
    ).toThrow(/append-only/)
    expect(() =>
      database.exec(
        "DELETE FROM greenfield_harness_events WHERE task_id = 'task-sensitive-1'"
      )
    ).toThrow(/cannot be deleted/)
    database.close()
  })

  it('detects authenticated task metadata tampering', () => {
    const databasePath = temporaryPath()
    const storeConfig = config(databasePath)
    const store = new EncryptedSqliteHarnessTaskStore(storeConfig)
    store.create(task())
    store.close()

    const database = new DatabaseSync(databasePath)
    database.exec(
      "UPDATE greenfield_harness_tasks SET state = 'completed' WHERE task_id = 'task-sensitive-1'"
    )
    database.close()

    const reopened = new EncryptedSqliteHarnessTaskStore(storeConfig)
    expect(() => reopened.read('task-sensitive-1')).toThrow()
    reopened.close()
  })

  it('updates the encrypted task snapshot while preserving immutable identity fields', () => {
    const databasePath = temporaryPath()
    const store = new EncryptedSqliteHarnessTaskStore(config(databasePath))
    const original = task()
    store.create(original)
    const updated = {
      ...original,
      state: 'completed' as const,
      updated_at: '2026-07-15T00:00:02.000Z',
      completed_at: '2026-07-15T00:00:02.000Z'
    }
    store.replace(updated)
    expect(store.read(original.task_id)?.state).toBe('completed')

    expect(() =>
      store.replace({ ...updated, owner_id: 'different-owner' })
    ).toThrow(/immutable/)
    store.close()
  })
})
