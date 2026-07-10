import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
  TRACE_PURGE_CAPABILITY,
  TraceOwnerOperationService,
  TraceOwnerOperationStore,
  TraceOwnerOperationVerifier,
  type GreenfieldRuntimeDependencies,
  type IdentityContext,
  type RuntimeStatusReader,
  type RuntimeStatusSnapshot,
  type VerticalSliceEnvelope
} from '@/core/greenfield'

const MASTER_KEY = Buffer.alloc(32, 17).toString('base64')
const BASE_TIME = new Date('2026-07-10T21:00:00.000Z')
const temporaryDirectories: string[] = []

class TestStatusReader implements RuntimeStatusReader {
  public async read(observedAt: Date): Promise<RuntimeStatusSnapshot> {
    return {
      status: 'online',
      observed_at: observedAt.toISOString(),
      uptime_seconds: 240,
      version: 'trace-operation-test',
      routing_mode: 'smart',
      llm_provider_ready: true,
      local_model: 'deterministic-test-model',
      limitations: []
    }
  }
}

function createTemporaryDatabasePath(): string {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'mira-trace-operation-test-')
  )
  temporaryDirectories.push(directory)
  return path.join(directory, 'traces.sqlite')
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
    evidenceProvider: new SystemStatusEvidenceProvider(new TestStatusReader()),
    responseComposer: new SystemStatusResponseComposer(),
    now: () => {
      const value = new Date(start.getTime() + offset)
      offset += 10
      return value
    }
  }
}

async function createEnvelope(start: Date): Promise<VerticalSliceEnvelope> {
  return (
    await new GreenfieldRequestOrchestrator(
      createDependencies(start)
    ).execute({
      device_id: 'device-1',
      capability: SYSTEM_STATUS_CAPABILITY,
      input: 'Report the current Mira system status.',
      credential: 'trace-operation-test-key'
    })
  ).envelope
}

function identity(overrides: Partial<IdentityContext> = {}): IdentityContext {
  return {
    owner_id: 'owner-1',
    device_id: 'device-1',
    auth_session_id: 'http-key:trace-operation-session',
    authenticated_at: BASE_TIME.toISOString(),
    trust_level: 'paired',
    permissions: [
      SYSTEM_STATUS_CAPABILITY,
      TRACE_EXPORT_CAPABILITY,
      TRACE_PURGE_CAPABILITY
    ],
    privacy_zones: ['private'],
    ...overrides
  }
}

async function createHarness(ttlSeconds = 300): Promise<{
  databasePath: string
  traceStore: EncryptedSqliteTraceStore
  operationStore: TraceOwnerOperationStore
  service: TraceOwnerOperationService
  setNow: (value: Date) => void
  traceIds: string[]
}> {
  const databasePath = createTemporaryDatabasePath()
  const traceStore = new EncryptedSqliteTraceStore({
    enabled: true,
    databasePath,
    masterKeyBase64: MASTER_KEY,
    retentionDays: 30
  })
  const first = await createEnvelope(BASE_TIME)
  const second = await createEnvelope(
    new Date(BASE_TIME.getTime() + 1_000)
  )
  await traceStore.append(first)
  await traceStore.append(second)

  const operationStore = new TraceOwnerOperationStore({
    enabled: true,
    databasePath,
    masterKeyBase64: MASTER_KEY,
    planTtlSeconds: ttlSeconds
  })
  let current = new Date(BASE_TIME.getTime() + 2_000)
  let sequence = 0
  const service = new TraceOwnerOperationService(
    traceStore,
    operationStore,
    new TraceOwnerOperationVerifier(),
    () => new Date(current),
    () => `operation-id-${++sequence}`
  )

  return {
    databasePath,
    traceStore,
    operationStore,
    service,
    setNow: (value) => {
      current = new Date(value)
    },
    traceIds: [first.origin.trace_id, second.origin.trace_id]
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('owner-authorized trace operations', () => {
  it('applies migration v2 and keeps plan scope and challenge encrypted', async () => {
    const harness = await createHarness()
    const result = await harness.service.createPlan({
      identity: identity(),
      operation: 'export',
      traceIds: harness.traceIds,
      reasonCode: 'owner_requested_export'
    })

    expect(harness.operationStore.getAppliedMigrationVersions()).toEqual([1, 2])
    const storage = Buffer.concat(
      [
        harness.databasePath,
        `${harness.databasePath}-wal`,
        `${harness.databasePath}-shm`
      ]
        .filter((candidate) => fs.existsSync(candidate))
        .map((candidate) => fs.readFileSync(candidate))
    ).toString('utf8')
    expect(storage).not.toContain(result.approval_token)
    expect(storage).not.toContain('owner_requested_export')
    expect(storage).not.toContain('owner-1')
    expect(storage).not.toContain('device-1')

    harness.operationStore.close()
    harness.traceStore.close()
  })

  it('exports an exact approved scope and independently verifies the bundle', async () => {
    const harness = await createHarness()
    const planned = await harness.service.createPlan({
      identity: identity(),
      operation: 'export',
      traceIds: [...harness.traceIds].reverse(),
      reasonCode: 'owner_requested_export'
    })

    await expect(
      harness.service.approve({
        identity: identity(),
        planId: planned.plan.plan_id,
        approvalToken: 'incorrect-approval-token-with-required-length',
        decision: 'approved'
      })
    ).rejects.toMatchObject({
      code: 'trace_operation.approval_challenge_invalid'
    })

    const approval = await harness.service.approve({
      identity: identity(),
      planId: planned.plan.plan_id,
      approvalToken: planned.approval_token,
      decision: 'approved'
    })
    const result = await harness.service.execute({
      identity: identity(),
      planId: planned.plan.plan_id
    })

    expect(approval.scope_hash).toBe(planned.plan.scope_hash)
    expect(result.receipt).toMatchObject({
      execution_status: 'succeeded',
      verification_status: 'succeeded',
      operation: 'export',
      record_count: 2,
      failure_code: null
    })
    expect(result.export_bundle?.records).toHaveLength(2)
    expect(result.export_bundle?.bundle_hash).toBe(result.receipt.output_hash)
    expect(
      result.export_bundle?.records.map((record) => record.trace_id).sort()
    ).toEqual([...harness.traceIds].sort())

    const events = harness.operationStore.listEvents(planned.plan.plan_id)
    expect(events.map((event) => event.stage)).toEqual([
      'plan',
      'approval',
      'execution',
      'verification',
      'receipt'
    ])
    events.slice(1).forEach((event, index) => {
      expect(event.parent_event_id).toBe(events[index]?.event_id)
    })

    const replay = await harness.service.execute({
      identity: identity(),
      planId: planned.plan.plan_id
    })
    expect(replay.receipt.receipt_id).toBe(result.receipt.receipt_id)
    expect(replay.export_bundle?.bundle_hash).toBe(
      result.export_bundle?.bundle_hash
    )

    harness.operationStore.close()
    harness.traceStore.close()
  })

  it('physically purges only the approved exact scope and verifies the result', async () => {
    const harness = await createHarness()
    const planned = await harness.service.createPlan({
      identity: identity(),
      operation: 'purge',
      traceIds: [harness.traceIds[0]!],
      reasonCode: 'owner_requested_purge'
    })
    await harness.service.approve({
      identity: identity(),
      planId: planned.plan.plan_id,
      approvalToken: planned.approval_token,
      decision: 'approved'
    })
    const result = await harness.service.execute({
      identity: identity(),
      planId: planned.plan.plan_id
    })

    expect(result.export_bundle).toBeNull()
    expect(result.receipt).toMatchObject({
      execution_status: 'succeeded',
      verification_status: 'succeeded',
      operation: 'purge',
      record_count: 1,
      failure_code: null
    })
    expect(result.receipt.purge_receipt_id).not.toBeNull()
    expect(
      await harness.traceStore.read('owner-1', harness.traceIds[0]!)
    ).toBeNull()
    expect(
      await harness.traceStore.read('owner-1', harness.traceIds[1]!)
    ).not.toBeNull()
    expect(await harness.traceStore.verifyOwnerChain('owner-1')).toMatchObject({
      valid: true,
      recordCount: 1
    })

    harness.operationStore.close()
    harness.traceStore.close()
  })

  it('reconciles a committed purge after a lost operation response', async () => {
    const harness = await createHarness()
    const traceId = harness.traceIds[0]!
    const planned = await harness.service.createPlan({
      identity: identity(),
      operation: 'purge',
      traceIds: [traceId],
      reasonCode: 'owner_requested_purge'
    })
    await harness.service.approve({
      identity: identity(),
      planId: planned.plan.plan_id,
      approvalToken: planned.approval_token,
      decision: 'approved'
    })

    const underlying = await harness.traceStore.purgeOwnerTraces(
      'owner-1',
      [traceId],
      'owner_requested_purge',
      new Date(BASE_TIME.getTime() + 2_000)
    )
    expect(underlying).not.toBeNull()

    const result = await harness.service.execute({
      identity: identity(),
      planId: planned.plan.plan_id
    })
    expect(result.receipt).toMatchObject({
      execution_status: 'succeeded',
      verification_status: 'succeeded',
      purge_receipt_id: underlying?.receiptId
    })

    harness.operationStore.close()
    harness.traceStore.close()
  })

  it('keeps rejection immutable and prevents execution', async () => {
    const harness = await createHarness()
    const planned = await harness.service.createPlan({
      identity: identity(),
      operation: 'purge',
      traceIds: [harness.traceIds[0]!],
      reasonCode: 'owner_requested_purge'
    })
    const approval = await harness.service.approve({
      identity: identity(),
      planId: planned.plan.plan_id,
      approvalToken: planned.approval_token,
      decision: 'rejected'
    })

    expect(approval.decision).toBe('rejected')
    await expect(
      harness.service.execute({
        identity: identity(),
        planId: planned.plan.plan_id
      })
    ).rejects.toMatchObject({ code: 'trace_operation.owner_rejected' })
    expect(
      await harness.traceStore.read('owner-1', harness.traceIds[0]!)
    ).not.toBeNull()

    harness.operationStore.close()
    harness.traceStore.close()
  })

  it('binds plans to the exact owner, device, session, permission, and expiry', async () => {
    const harness = await createHarness(60)
    const planned = await harness.service.createPlan({
      identity: identity(),
      operation: 'export',
      traceIds: [harness.traceIds[0]!],
      reasonCode: 'owner_requested_export'
    })

    await expect(
      harness.service.approve({
        identity: identity({ device_id: 'device-2' }),
        planId: planned.plan.plan_id,
        approvalToken: planned.approval_token,
        decision: 'approved'
      })
    ).rejects.toMatchObject({ code: 'trace_operation.identity_mismatch' })

    await expect(
      harness.service.approve({
        identity: identity({ permissions: [SYSTEM_STATUS_CAPABILITY] }),
        planId: planned.plan.plan_id,
        approvalToken: planned.approval_token,
        decision: 'approved'
      })
    ).rejects.toMatchObject({ code: 'trace_operation.permission_missing' })

    harness.setNow(new Date(BASE_TIME.getTime() + 63_000))
    await expect(
      harness.service.approve({
        identity: identity(),
        planId: planned.plan.plan_id,
        approvalToken: planned.approval_token,
        decision: 'approved'
      })
    ).rejects.toMatchObject({ code: 'trace_operation.plan_expired' })

    harness.operationStore.close()
    harness.traceStore.close()
  })
})
