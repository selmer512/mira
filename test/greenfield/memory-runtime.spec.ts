import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  EncryptedSqliteMemoryStore,
  GreenfieldExecutionError,
  MEMORY_CANDIDATE_CREATE_CAPABILITY,
  MEMORY_CONFIRM_CAPABILITY,
  MEMORY_READ_CAPABILITY,
  MemoryCandidateRequestOrchestrator,
  MemoryLifecycleService,
  TraceStoreError,
  type IdentityResolver,
  type MemoryTraceStore,
  type TracePersistenceReceipt,
  type VerticalSliceEnvelope
} from '@/core/greenfield'

const MEMORY_KEY = Buffer.alloc(32, 41).toString('base64')
const LOOKUP_KEY = Buffer.alloc(32, 43).toString('base64')
const BASE_TIME = new Date('2026-07-11T15:00:00.000Z')
const temporaryDirectories: string[] = []

function createDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-memory-runtime-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'memory.sqlite')
}

function createClock(): () => Date {
  let offset = 0
  return () => {
    const value = new Date(BASE_TIME.getTime() + offset)
    offset += 10
    return value
  }
}

function createIds(): () => string {
  let value = 0
  return () => `memory-runtime-id-${++value}`
}

function identityResolver(withPermission = true): IdentityResolver {
  return {
    resolve: async (input) => ({
      owner_id: 'owner-1',
      device_id: input.deviceId,
      auth_session_id: 'session-1',
      authenticated_at: input.authenticatedAt.toISOString(),
      trust_level: 'paired',
      permissions: withPermission
        ? [
            MEMORY_CANDIDATE_CREATE_CAPABILITY,
            MEMORY_CONFIRM_CAPABILITY,
            MEMORY_READ_CAPABILITY
          ]
        : [MEMORY_CONFIRM_CAPABILITY, MEMORY_READ_CAPABILITY],
      privacy_zones: ['private']
    })
  }
}

function createMemoryStore(databasePath: string): EncryptedSqliteMemoryStore {
  return new EncryptedSqliteMemoryStore({
    enabled: true,
    databasePath,
    masterKeyBase64: MEMORY_KEY,
    ownerLookupKeyBase64: LOOKUP_KEY,
    keyVersion: 'v1',
    candidateTtlSeconds: 900,
    purgePlanTtlSeconds: 300
  })
}

function request() {
  return {
    device_id: 'device-1',
    credential: 'correct-key',
    title: 'Preferred focus hours',
    content: 'The owner prefers uninterrupted focus time before noon.',
    memory_class: 'semantic' as const,
    temporal_status: 'historical' as const,
    observed_at: BASE_TIME.toISOString(),
    valid_from: null,
    valid_until: null,
    privacy_zone: 'private',
    confidence: 1,
    salience: 0.9,
    retention_policy: 'owner_confirmed',
    source_refs: ['owner://statement/focus-hours'],
    derivation_links: [],
    contradiction_links: [],
    supersession_links: []
  }
}

function countCandidates(databasePath: string): number {
  if (!fs.existsSync(databasePath)) return 0
  const database = new DatabaseSync(databasePath)
  try {
    const table = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'greenfield_memory_candidates'
         LIMIT 1`
      )
      .get()
    if (!table) return 0
    const row = database
      .prepare(
        'SELECT COUNT(*) AS count FROM greenfield_memory_candidates'
      )
      .get() as Record<string, unknown>
    return Number(row['count'])
  } finally {
    database.close()
  }
}

function persistenceReceipt(envelope: VerticalSliceEnvelope): TracePersistenceReceipt {
  return {
    traceId: envelope.origin.trace_id,
    recordHash: 'a'.repeat(64),
    previousRecordHash: null,
    retentionUntil: '2026-08-10T15:00:00.000Z',
    encryptionKeyId: 'trace-key-id',
    redactionStatus: 'session_redacted'
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('traced memory candidate runtime', () => {
  it('persists a validated pending candidate and causal trace before returning the challenge', async () => {
    const databasePath = createDatabasePath()
    const memoryStore = createMemoryStore(databasePath)
    const traceStore: MemoryTraceStore = {
      append: vi.fn(async (envelope) => persistenceReceipt(envelope))
    }
    const orchestrator = new MemoryCandidateRequestOrchestrator({
      identityResolver: identityResolver(),
      memoryService: new MemoryLifecycleService(memoryStore),
      traceStore,
      now: createClock(),
      createId: createIds()
    })

    const result = await orchestrator.execute(request())

    expect(result.candidate.confirmation_status).toBe('pending')
    expect(result.candidate.source_refs).toContain(
      'owner://statement/focus-hours'
    )
    expect(result.approval_token.length).toBeGreaterThan(32)
    expect(result.envelope.memory_candidate?.candidate_id).toBe(
      result.candidate.candidate_id
    )
    expect(result.envelope.spans.some((span) => span.component_type === 'memory')).toBe(
      true
    )
    expect(
      result.envelope.operational_states.map((event) => event.state)
    ).toContain('waiting_for_approval')
    expect(traceStore.append).toHaveBeenCalledTimes(1)
    expect(
      memoryStore.search(
        {
          ...result.envelope.identity,
          permissions: [MEMORY_READ_CAPABILITY]
        },
        'focus time',
        'historical',
        10
      ).records
    ).toEqual([])
    memoryStore.close()
  })

  it('rolls back the pending candidate when trace persistence fails', async () => {
    const databasePath = createDatabasePath()
    const memoryStore = createMemoryStore(databasePath)
    const traceStore: MemoryTraceStore = {
      append: vi.fn(async () => {
        throw new TraceStoreError(
          'trace.append_failed',
          'Trace persistence failed.',
          500
        )
      })
    }
    const orchestrator = new MemoryCandidateRequestOrchestrator({
      identityResolver: identityResolver(),
      memoryService: new MemoryLifecycleService(memoryStore),
      traceStore,
      now: createClock(),
      createId: createIds()
    })

    await expect(orchestrator.execute(request())).rejects.toMatchObject({
      code: 'trace.append_failed',
      statusCode: 500
    })
    expect(countCandidates(databasePath)).toBe(0)
    memoryStore.close()
  })

  it('fails before storage when the owner session lacks candidate-create permission', async () => {
    const databasePath = createDatabasePath()
    const memoryStore = createMemoryStore(databasePath)
    const traceStore: MemoryTraceStore = {
      append: vi.fn(async (envelope) => persistenceReceipt(envelope))
    }
    const orchestrator = new MemoryCandidateRequestOrchestrator({
      identityResolver: identityResolver(false),
      memoryService: new MemoryLifecycleService(memoryStore),
      traceStore,
      now: createClock(),
      createId: createIds()
    })

    let failure: unknown
    try {
      await orchestrator.execute(request())
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(GreenfieldExecutionError)
    expect(failure).toMatchObject({
      code: 'memory.permission_missing',
      statusCode: 403
    })
    expect(countCandidates(databasePath)).toBe(0)
    expect(traceStore.append).not.toHaveBeenCalled()
    memoryStore.close()
  })
})
