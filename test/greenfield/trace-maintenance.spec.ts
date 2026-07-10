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
  SYSTEM_STATUS_CAPABILITY,
  SystemStatusEvidenceProvider,
  SystemStatusResponseComposer,
  TraceMaintenanceService,
  type GreenfieldRuntimeDependencies,
  type RuntimeStatusReader,
  type RuntimeStatusSnapshot,
  type VerticalSliceEnvelope
} from '@/core/greenfield'

const MASTER_KEY = Buffer.alloc(32, 11).toString('base64')
const BASE_TIME = new Date('2026-07-10T20:00:00.000Z')
const temporaryDirectories: string[] = []

class StatusReader implements RuntimeStatusReader {
  public async read(observedAt: Date): Promise<RuntimeStatusSnapshot> {
    return {
      status: 'online',
      observed_at: observedAt.toISOString(),
      uptime_seconds: 1,
      version: 'maintenance-test',
      routing_mode: 'smart',
      llm_provider_ready: true,
      local_model: 'deterministic',
      limitations: []
    }
  }
}

function createDatabasePath(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mira-maintenance-test-')
  )
  temporaryDirectories.push(directory)
  return path.join(directory, 'traces.sqlite')
}

function createStore(databasePath: string): EncryptedSqliteTraceStore {
  return new EncryptedSqliteTraceStore({
    enabled: true,
    databasePath,
    masterKeyBase64: MASTER_KEY,
    retentionDays: 1
  })
}

function createDependencies(start: Date): GreenfieldRuntimeDependencies {
  let offset = 0
  return {
    identityResolver: EnvironmentIdentityResolver.fromProcessEnv({
      MIRA_GREENFIELD_ENABLED: 'true',
      MIRA_GREENFIELD_OWNER_ID: 'owner-1',
      MIRA_GREENFIELD_PAIRED_DEVICE_ID: 'device-1',
      MIRA_GREENFIELD_PERMISSIONS: SYSTEM_STATUS_CAPABILITY,
      MIRA_GREENFIELD_PRIVACY_ZONES: 'private'
    }),
    localCognitionProvider: new CapabilityLocalCognitionProvider(),
    evidenceProvider: new SystemStatusEvidenceProvider(new StatusReader()),
    responseComposer: new SystemStatusResponseComposer(),
    now: () => {
      const value = new Date(start.getTime() + offset)
      offset += 10
      return value
    }
  }
}

async function createEnvelope(start: Date): Promise<VerticalSliceEnvelope> {
  const result = await new GreenfieldRequestOrchestrator(
    createDependencies(start)
  ).execute({
    device_id: 'device-1',
    capability: SYSTEM_STATUS_CAPABILITY,
    input: 'Report current status.',
    credential: 'maintenance-test-key'
  })
  return result.envelope
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('trace maintenance service', () => {
  it('returns a non-destructive owner-scoped health report', async () => {
    const store = createStore(createDatabasePath())
    await store.append(await createEnvelope(BASE_TIME))
    const service = new TraceMaintenanceService(
      store,
      {
        ownerId: 'owner-1',
        intervalMinutes: 60,
        runOnStartup: false
      },
      () => new Date('2026-07-10T20:30:00.000Z')
    )

    const health = await service.getHealth()

    expect(health.chain.valid).toBe(true)
    expect(health.traceCount).toBe(1)
    expect(health.purgeReceiptCount).toBe(0)
    expect(health.migrationVersions).toEqual([1])
    store.close()
  })

  it('purges expired traces only after integrity verification', async () => {
    const store = createStore(createDatabasePath())
    await store.append(await createEnvelope(BASE_TIME))
    const service = new TraceMaintenanceService(
      store,
      {
        ownerId: 'owner-1',
        intervalMinutes: 60,
        runOnStartup: false
      },
      () => new Date('2026-07-12T20:00:00.000Z')
    )

    const report = await service.runOnce()

    expect(report.chainBefore.valid).toBe(true)
    expect(report.retentionPurges).toHaveLength(1)
    expect(report.tracesBefore).toBe(1)
    expect(report.tracesAfter).toBe(0)
    expect(report.chainAfter.valid).toBe(true)
    store.close()
  })

  it('blocks retention deletion when an unexplained chain gap exists', async () => {
    const databasePath = createDatabasePath()
    const store = createStore(databasePath)
    const first = await createEnvelope(BASE_TIME)
    const second = await createEnvelope(new Date(BASE_TIME.getTime() + 1_000))
    await store.append(first)
    await store.append(second)

    const directDatabase = new DatabaseSync(databasePath)
    directDatabase
      .prepare('DELETE FROM greenfield_trace_records WHERE trace_id = ?')
      .run(first.origin.trace_id)
    directDatabase.close()

    const service = new TraceMaintenanceService(
      store,
      {
        ownerId: 'owner-1',
        intervalMinutes: 60,
        runOnStartup: false
      },
      () => new Date('2026-07-12T20:00:00.000Z')
    )

    await expect(service.runOnce()).rejects.toMatchObject({
      code: 'trace.maintenance_chain_invalid',
      statusCode: 500
    })
    expect(await store.countOwnerTraces('owner-1')).toBe(1)
    store.close()
  })
})
