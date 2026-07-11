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
  TRACE_EXPORT_CAPABILITY,
  TRACE_OPERATIONS_READ_CAPABILITY,
  TraceOperationsDashboardService,
  TraceOwnerOperationStore,
  type GreenfieldRuntimeDependencies,
  type IdentityContext,
  type RuntimeStatusReader,
  type RuntimeStatusSnapshot,
  type VerticalSliceEnvelope
} from '@/core/greenfield'

const MASTER_KEY = Buffer.alloc(32, 17).toString('base64')
const SECOND_MASTER_KEY = Buffer.alloc(32, 23).toString('base64')
const BASE_TIME = new Date('2026-07-10T23:00:00.000Z')
const temporaryDirectories: string[] = []

class TestStatusReader implements RuntimeStatusReader {
  public async read(observedAt: Date): Promise<RuntimeStatusSnapshot> {
    return {
      status: 'online',
      observed_at: observedAt.toISOString(),
      uptime_seconds: 90,
      version: 'key-readiness-test',
      routing_mode: 'smart',
      llm_provider_ready: true,
      local_model: 'deterministic-test-model',
      limitations: []
    }
  }
}

function createTemporaryDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-key-test-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'traces.sqlite')
}

function createClock(): () => Date {
  let offset = 0
  return () => {
    const value = new Date(BASE_TIME.getTime() + offset)
    offset += 10
    return value
  }
}

function createDependencies(): GreenfieldRuntimeDependencies {
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
    now: createClock()
  }
}

async function createEnvelope(): Promise<VerticalSliceEnvelope> {
  const result = await new GreenfieldRequestOrchestrator(
    createDependencies()
  ).execute({
    device_id: 'device-1',
    capability: SYSTEM_STATUS_CAPABILITY,
    input: 'Report current status for key readiness testing.',
    credential: 'key-readiness-api-key'
  })
  return result.envelope
}

function identity(ownerId = 'owner-1'): IdentityContext {
  return {
    owner_id: ownerId,
    device_id: 'device-1',
    auth_session_id: 'session-1',
    authenticated_at: BASE_TIME.toISOString(),
    trust_level: 'paired',
    permissions: [
      SYSTEM_STATUS_CAPABILITY,
      TRACE_OPERATIONS_READ_CAPABILITY,
      TRACE_EXPORT_CAPABILITY
    ],
    privacy_zones: ['private']
  }
}

function createStores(databasePath: string, masterKey = MASTER_KEY): {
  traceStore: EncryptedSqliteTraceStore
  operationStore: TraceOwnerOperationStore
} {
  return {
    traceStore: new EncryptedSqliteTraceStore({
      enabled: true,
      databasePath,
      masterKeyBase64: masterKey,
      retentionDays: 30
    }),
    operationStore: new TraceOwnerOperationStore({
      enabled: true,
      databasePath,
      masterKeyBase64: masterKey,
      planTtlSeconds: 300
    })
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('trace key rotation readiness', () => {
  it('registers key version metadata and maps existing trace key IDs', async () => {
    const databasePath = createTemporaryDatabasePath()
    const { traceStore, operationStore } = createStores(databasePath)
    const envelope = await createEnvelope()
    const persistence = await traceStore.append(envelope)
    operationStore.getAppliedMigrationVersions()
    const dashboardService = new TraceOperationsDashboardService(
      {
        enabled: true,
        databasePath,
        masterKeyBase64: MASTER_KEY,
        keyVersion: 'v1'
      },
      traceStore,
      operationStore,
      () => BASE_TIME
    )

    const dashboard = await dashboardService.getDashboard(identity())

    expect(dashboard.readiness.active_key).toMatchObject({
      key_version: 'v1',
      encryption_key_id: persistence.encryptionKeyId,
      algorithm: 'aes-256-gcm',
      metadata_integrity_valid: true
    })
    expect(dashboard.readiness.migration_versions).toEqual([1, 2, 3])
    expect(dashboard.traces).toHaveLength(1)
    expect(dashboard.traces[0]).toMatchObject({
      trace_id: envelope.origin.trace_id,
      encryption_key_id: persistence.encryptionKeyId,
      encryption_key_version: 'v1'
    })
    expect(dashboard.readiness.rotation_supported).toBe(false)
    expect(dashboard.readiness.blockers).toContain(
      'rotation.reencryption_executor_not_implemented'
    )
    expect(JSON.stringify(dashboard)).not.toContain(MASTER_KEY)

    dashboardService.close()
    operationStore.close()
    traceStore.close()
  })

  it('reports active immutable operation plans as a rotation blocker', async () => {
    const databasePath = createTemporaryDatabasePath()
    const { traceStore, operationStore } = createStores(databasePath)
    const envelope = await createEnvelope()
    const persistence = await traceStore.append(envelope)
    const operationIdentity = identity()
    const created = operationStore.createPlan({
      identity: operationIdentity,
      operation: 'export',
      traceIds: [envelope.origin.trace_id],
      recordHashes: [persistence.recordHash],
      reasonCode: 'rotation_test',
      createdAt: BASE_TIME,
      createId: (() => {
        let value = 0
        return () => `operation-id-${++value}`
      })()
    })
    const dashboardService = new TraceOperationsDashboardService(
      {
        enabled: true,
        databasePath,
        masterKeyBase64: MASTER_KEY,
        keyVersion: 'v1'
      },
      traceStore,
      operationStore,
      () => BASE_TIME
    )

    const dashboard = await dashboardService.getDashboard(operationIdentity)

    expect(dashboard.plans).toHaveLength(1)
    expect(dashboard.plans[0]).toMatchObject({
      plan_id: created.plan.plan.plan_id,
      trace_ids: [envelope.origin.trace_id],
      key_version: 'v1',
      key_metadata_source: 'active_key_decryption'
    })
    expect(dashboard.readiness.operation_inventory.active_unexpired).toBe(1)
    expect(dashboard.readiness.blockers).toContain(
      'rotation.active_operation_plans_present'
    )

    dashboardService.close()
    operationStore.close()
    traceStore.close()
  })

  it('keeps the trace catalog isolated to the authenticated owner', async () => {
    const databasePath = createTemporaryDatabasePath()
    const { traceStore, operationStore } = createStores(databasePath)
    await traceStore.append(await createEnvelope())
    operationStore.getAppliedMigrationVersions()
    const dashboardService = new TraceOperationsDashboardService(
      {
        enabled: true,
        databasePath,
        masterKeyBase64: MASTER_KEY,
        keyVersion: 'v1'
      },
      traceStore,
      operationStore,
      () => BASE_TIME
    )

    const dashboard = await dashboardService.getDashboard(identity('owner-2'))

    expect(dashboard.traces).toEqual([])
    expect(dashboard.plans).toEqual([])
    expect(dashboard.readiness.trace_inventory.total).toBe(0)

    dashboardService.close()
    operationStore.close()
    traceStore.close()
  })

  it('blocks reuse of one key version for different key material', async () => {
    const databasePath = createTemporaryDatabasePath()
    const firstStores = createStores(databasePath)
    await firstStores.traceStore.append(await createEnvelope())
    firstStores.operationStore.getAppliedMigrationVersions()
    const firstDashboard = new TraceOperationsDashboardService(
      {
        enabled: true,
        databasePath,
        masterKeyBase64: MASTER_KEY,
        keyVersion: 'v1'
      },
      firstStores.traceStore,
      firstStores.operationStore,
      () => BASE_TIME
    )
    await firstDashboard.getDashboard(identity())
    firstDashboard.close()
    firstStores.operationStore.close()
    firstStores.traceStore.close()

    const secondStores = createStores(databasePath, SECOND_MASTER_KEY)
    const secondDashboard = new TraceOperationsDashboardService(
      {
        enabled: true,
        databasePath,
        masterKeyBase64: SECOND_MASTER_KEY,
        keyVersion: 'v1'
      },
      secondStores.traceStore,
      secondStores.operationStore,
      () => BASE_TIME
    )

    const dashboard = await secondDashboard.getDashboard(identity())

    expect(dashboard.readiness.status).toBe('blocked')
    expect(dashboard.readiness.blockers).toContain(
      'rotation.key_version_reused_with_different_key'
    )

    secondDashboard.close()
    secondStores.operationStore.close()
    secondStores.traceStore.close()
  })

  it('protects key registry rows from update and deletion', async () => {
    const databasePath = createTemporaryDatabasePath()
    const { traceStore, operationStore } = createStores(databasePath)
    await traceStore.append(await createEnvelope())
    operationStore.getAppliedMigrationVersions()
    const dashboardService = new TraceOperationsDashboardService(
      {
        enabled: true,
        databasePath,
        masterKeyBase64: MASTER_KEY,
        keyVersion: 'v1'
      },
      traceStore,
      operationStore,
      () => BASE_TIME
    )
    await dashboardService.getDashboard(identity())
    dashboardService.close()
    operationStore.close()
    traceStore.close()

    const database = new DatabaseSync(databasePath)
    expect(() =>
      database.exec(
        "UPDATE greenfield_trace_key_versions SET algorithm = 'aes-256-gcm'"
      )
    ).toThrow(/append-only/)
    expect(() =>
      database.exec('DELETE FROM greenfield_trace_key_versions')
    ).toThrow(/cannot be deleted/)
    database.close()
  })
})
