import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  CapabilityLocalCognitionProvider,
  EncryptedSqliteTraceStore,
  EnvironmentIdentityResolver,
  GreenfieldRequestOrchestrator,
  PersistingGreenfieldRequestOrchestrator,
  SYSTEM_STATUS_CAPABILITY,
  SystemStatusEvidenceProvider,
  SystemStatusResponseComposer,
  type GreenfieldRuntimeDependencies,
  type RuntimeStatusReader,
  type RuntimeStatusSnapshot,
  type VerticalSliceEnvelope
} from '@/core/greenfield'

const MASTER_KEY = Buffer.alloc(32, 7).toString('base64')
const SECOND_MASTER_KEY = Buffer.alloc(32, 9).toString('base64')
const BASE_TIME = new Date('2026-07-10T19:00:00.000Z')
const temporaryDirectories: string[] = []

class TestStatusReader implements RuntimeStatusReader {
  public async read(observedAt: Date): Promise<RuntimeStatusSnapshot> {
    return {
      status: 'online',
      observed_at: observedAt.toISOString(),
      uptime_seconds: 120,
      version: 'trace-test',
      routing_mode: 'smart',
      llm_provider_ready: true,
      local_model: 'deterministic-test-model',
      limitations: []
    }
  }
}

function createTemporaryDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-trace-test-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'traces.sqlite')
}

function createClock(start = BASE_TIME): () => Date {
  let offset = 0
  return () => {
    const value = new Date(start.getTime() + offset)
    offset += 10
    return value
  }
}

function createDependencies(start = BASE_TIME): GreenfieldRuntimeDependencies {
  return {
    identityResolver: EnvironmentIdentityResolver.fromProcessEnv({
      MIRA_GREENFIELD_ENABLED: 'true',
      MIRA_GREENFIELD_OWNER_ID: 'owner-1',
      MIRA_GREENFIELD_PAIRED_DEVICE_ID: 'device-1',
      MIRA_GREENFIELD_PERMISSIONS: SYSTEM_STATUS_CAPABILITY,
      MIRA_GREENFIELD_PRIVACY_ZONES: 'private'
    }),
    localCognitionProvider: new CapabilityLocalCognitionProvider(),
    evidenceProvider: new SystemStatusEvidenceProvider(new TestStatusReader()),
    responseComposer: new SystemStatusResponseComposer(),
    now: createClock(start)
  }
}

function createStore(
  databasePath: string,
  overrides: Partial<{
    enabled: boolean
    masterKeyBase64: string
    retentionDays: number
  }> = {}
): EncryptedSqliteTraceStore {
  return new EncryptedSqliteTraceStore({
    enabled: overrides.enabled ?? true,
    databasePath,
    masterKeyBase64: overrides.masterKeyBase64 ?? MASTER_KEY,
    retentionDays: overrides.retentionDays ?? 30
  })
}

async function createEnvelope(
  start = BASE_TIME
): Promise<VerticalSliceEnvelope> {
  const result = await new GreenfieldRequestOrchestrator(
    createDependencies(start)
  ).execute({
    device_id: 'device-1',
    capability: SYSTEM_STATUS_CAPABILITY,
    input: 'Report the current Mira system status.',
    credential: 'trace-test-api-key'
  })
  return result.envelope
}

function readDatabaseBytes(databasePath: string): Buffer {
  const paths = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
  const buffers = paths
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => fs.readFileSync(candidate))
  return Buffer.concat(buffers)
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('encrypted append-only trace store', () => {
  it('applies the versioned migration idempotently', () => {
    const databasePath = createTemporaryDatabasePath()
    const first = createStore(databasePath)
    expect(first.getAppliedMigrationVersions()).toEqual([1])
    first.close()

    const reopened = createStore(databasePath)
    expect(reopened.getAppliedMigrationVersions()).toEqual([1])
    reopened.close()
  })

  it('encrypts, appends, and reads a redacted causal envelope', async () => {
    const databasePath = createTemporaryDatabasePath()
    const store = createStore(databasePath)
    const envelope = await createEnvelope()
    const originalSession = envelope.identity.auth_session_id

    const receipt = await store.append(envelope)
    const persisted = await store.read('owner-1', envelope.origin.trace_id)

    expect(receipt.recordHash).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt.previousRecordHash).toBeNull()
    expect(receipt.redactionStatus).toBe('session_redacted')
    expect(persisted).not.toBeNull()
    expect(persisted?.envelope.origin.trace_id).toBe(
      envelope.origin.trace_id
    )
    expect(persisted?.envelope.identity.auth_session_id).toMatch(
      /^redacted:session:/
    )
    expect(persisted?.envelope.identity.auth_session_id).not.toBe(
      originalSession
    )

    store.close()
  })

  it('does not store owner, device, credential, or envelope plaintext at rest', async () => {
    const databasePath = createTemporaryDatabasePath()
    const store = createStore(databasePath)
    const envelope = await createEnvelope()
    const originalSession = envelope.identity.auth_session_id

    await store.append(envelope)
    const storageText = readDatabaseBytes(databasePath).toString('utf8')

    expect(storageText).not.toContain('owner-1')
    expect(storageText).not.toContain('device-1')
    expect(storageText).not.toContain('trace-test-api-key')
    expect(storageText).not.toContain(originalSession)
    expect(storageText).not.toContain(
      'Report the current Mira system status.'
    )

    store.close()
  })

  it('maintains a per-owner tamper-evident hash chain', async () => {
    const databasePath = createTemporaryDatabasePath()
    const store = createStore(databasePath)
    const firstEnvelope = await createEnvelope(BASE_TIME)
    const secondEnvelope = await createEnvelope(
      new Date(BASE_TIME.getTime() + 1_000)
    )

    const first = await store.append(firstEnvelope)
    const second = await store.append(secondEnvelope)
    const verification = await store.verifyOwnerChain('owner-1')

    expect(second.previousRecordHash).toBe(first.recordHash)
    expect(verification).toEqual({
      valid: true,
      recordCount: 2,
      issue: null
    })

    store.close()
  })

  it('rejects duplicate trace and origin event persistence', async () => {
    const databasePath = createTemporaryDatabasePath()
    const store = createStore(databasePath)
    const envelope = await createEnvelope()

    await store.append(envelope)
    await expect(store.append(envelope)).rejects.toMatchObject({
      code: 'trace.duplicate',
      statusCode: 409
    })

    store.close()
  })

  it('isolates trace reads by owner-derived key and identifier', async () => {
    const databasePath = createTemporaryDatabasePath()
    const store = createStore(databasePath)
    const envelope = await createEnvelope()

    await store.append(envelope)

    expect(await store.read('different-owner', envelope.origin.trace_id)).toBeNull()
    expect(await store.countOwnerTraces('different-owner')).toBe(0)
    expect(await store.countOwnerTraces('owner-1')).toBe(1)

    store.close()
  })

  it('blocks SQL updates to persisted trace records', async () => {
    const databasePath = createTemporaryDatabasePath()
    const store = createStore(databasePath)
    const envelope = await createEnvelope()
    await store.append(envelope)

    const directDatabase = new DatabaseSync(databasePath)
    expect(() =>
      directDatabase
        .prepare(
          `UPDATE greenfield_trace_records
           SET retention_until = retention_until + 1
           WHERE trace_id = ?`
        )
        .run(envelope.origin.trace_id)
    ).toThrow(/append-only/)
    directDatabase.close()
    store.close()
  })

  it('physically purges selected traces and preserves a content-free receipt', async () => {
    const databasePath = createTemporaryDatabasePath()
    const store = createStore(databasePath)
    const firstEnvelope = await createEnvelope(BASE_TIME)
    const secondEnvelope = await createEnvelope(
      new Date(BASE_TIME.getTime() + 1_000)
    )
    const firstReceipt = await store.append(firstEnvelope)
    await store.append(secondEnvelope)

    const purgeReceipt = await store.purgeOwnerTraces(
      'owner-1',
      [firstEnvelope.origin.trace_id],
      'owner_requested',
      new Date('2026-07-10T20:00:00.000Z')
    )

    expect(purgeReceipt).not.toBeNull()
    expect(purgeReceipt?.recordCount).toBe(1)
    expect(purgeReceipt?.purgedRecordHashes).toEqual([
      firstReceipt.recordHash
    ])
    expect(JSON.stringify(purgeReceipt)).not.toContain(
      firstEnvelope.origin.trace_id
    )
    expect(await store.read('owner-1', firstEnvelope.origin.trace_id)).toBeNull()
    expect(await store.read('owner-1', secondEnvelope.origin.trace_id)).not.toBeNull()
    expect(await store.verifyOwnerChain('owner-1')).toEqual({
      valid: true,
      recordCount: 1,
      issue: null
    })
    expect(await store.listPurgeReceipts('owner-1')).toHaveLength(1)

    store.close()
  })

  it('purges traces after their configured retention deadline', async () => {
    const databasePath = createTemporaryDatabasePath()
    const store = createStore(databasePath, { retentionDays: 1 })
    const envelope = await createEnvelope(BASE_TIME)
    const persistence = await store.append(envelope)
    const afterRetention = new Date(
      Date.parse(persistence.retentionUntil) + 1
    )

    const receipts = await store.purgeExpired(afterRetention)

    expect(receipts).toHaveLength(1)
    expect(receipts[0]?.reasonCode).toBe('retention_expired')
    expect(await store.countOwnerTraces('owner-1')).toBe(0)

    store.close()
  })

  it('cannot locate an owner trace when the configured master key changes', async () => {
    const databasePath = createTemporaryDatabasePath()
    const store = createStore(databasePath)
    const envelope = await createEnvelope()
    await store.append(envelope)
    store.close()

    const wrongKeyStore = createStore(databasePath, {
      masterKeyBase64: SECOND_MASTER_KEY
    })

    expect(
      await wrongKeyStore.read('owner-1', envelope.origin.trace_id)
    ).toBeNull()
    wrongKeyStore.close()
  })
})

describe('persisting greenfield orchestrator', () => {
  it('returns only after the trace is durably appended', async () => {
    const databasePath = createTemporaryDatabasePath()
    const store = createStore(databasePath)
    const orchestrator = new PersistingGreenfieldRequestOrchestrator(
      createDependencies(),
      store
    )

    const result = await orchestrator.execute({
      device_id: 'device-1',
      capability: SYSTEM_STATUS_CAPABILITY,
      input: 'Report the current Mira system status.',
      credential: 'trace-test-api-key'
    })

    expect(result.trace_persistence.traceId).toBe(
      result.envelope.origin.trace_id
    )
    expect(await store.countOwnerTraces('owner-1')).toBe(1)

    store.close()
  })

  it('fails closed when durable trace persistence is disabled', async () => {
    const databasePath = createTemporaryDatabasePath()
    const store = createStore(databasePath, { enabled: false })
    const orchestrator = new PersistingGreenfieldRequestOrchestrator(
      createDependencies(),
      store
    )

    const execution = orchestrator.execute({
      device_id: 'device-1',
      capability: SYSTEM_STATUS_CAPABILITY,
      input: 'Report the current Mira system status.',
      credential: 'trace-test-api-key'
    })

    await expect(execution).rejects.toMatchObject({
      code: 'trace.persistence_disabled',
      statusCode: 503
    })
  })
})
