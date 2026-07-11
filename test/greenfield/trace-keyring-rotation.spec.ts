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
  TraceOwnerOperationStore,
  TraceReadKeyring,
  TraceRotationPlanner,
  TRACE_ROTATION_PLAN_CAPABILITY,
  type GreenfieldRuntimeDependencies,
  type IdentityContext,
  type RuntimeStatusReader,
  type RuntimeStatusSnapshot,
  type VerticalSliceEnvelope
} from '@/core/greenfield'

const V1_KEY = Buffer.alloc(32, 21).toString('base64')
const V2_KEY = Buffer.alloc(32, 22).toString('base64')
const LOOKUP_KEY = Buffer.alloc(32, 23).toString('base64')
const BASE_TIME = new Date('2026-07-11T01:30:00.000Z')
const temporaryDirectories: string[] = []

class TestStatusReader implements RuntimeStatusReader {
  public async read(observedAt: Date): Promise<RuntimeStatusSnapshot> {
    return {
      status: 'online',
      observed_at: observedAt.toISOString(),
      uptime_seconds: 120,
      version: 'keyring-test',
      routing_mode: 'smart',
      llm_provider_ready: true,
      local_model: 'deterministic-test-model',
      limitations: []
    }
  }
}

function createTemporaryPaths(): {
  directory: string
  databasePath: string
  backupPath: string
} {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-keyring-test-'))
  temporaryDirectories.push(directory)
  return {
    directory,
    databasePath: path.join(directory, 'traces.sqlite'),
    backupPath: path.join(directory, 'traces.backup.sqlite')
  }
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

async function createEnvelope(
  start = BASE_TIME
): Promise<VerticalSliceEnvelope> {
  const result = await new GreenfieldRequestOrchestrator(
    createDependencies(start)
  ).execute({
    device_id: 'device-1',
    capability: SYSTEM_STATUS_CAPABILITY,
    input: 'Report the current Mira system status.',
    credential: 'keyring-test-api-key'
  })
  return result.envelope
}

function createTraceStore(
  databasePath: string,
  masterKeyBase64: string
): EncryptedSqliteTraceStore {
  return new EncryptedSqliteTraceStore({
    enabled: true,
    databasePath,
    masterKeyBase64,
    retentionDays: 30
  })
}

function applyOperationMigration(
  databasePath: string,
  masterKeyBase64 = V1_KEY
): void {
  const operationStore = new TraceOwnerOperationStore({
    enabled: true,
    databasePath,
    masterKeyBase64,
    planTtlSeconds: 300
  })
  expect(operationStore.getAppliedMigrationVersions()).toEqual([1, 2])
  operationStore.close()
}

function createKeyring(
  databasePath: string,
  overrides: Partial<{
    activeKeyVersion: string
    activeMasterKeyBase64: string
    ownerLookupKeyBase64: string
    keyringJson: string
  }> = {}
): TraceReadKeyring {
  return new TraceReadKeyring({
    enabled: true,
    databasePath,
    activeKeyVersion: overrides.activeKeyVersion || 'v1',
    activeMasterKeyBase64: overrides.activeMasterKeyBase64 || V1_KEY,
    ownerLookupKeyBase64: overrides.ownerLookupKeyBase64 || LOOKUP_KEY,
    keyringJson:
      overrides.keyringJson || JSON.stringify({ v1: V1_KEY, v2: V2_KEY })
  })
}

function createIdentity(
  permissions = ['trace.operations.read', TRACE_ROTATION_PLAN_CAPABILITY],
  ownerId = 'owner-1'
): IdentityContext {
  return {
    owner_id: ownerId,
    device_id: 'device-1',
    auth_session_id: 'session-1',
    authenticated_at: BASE_TIME.toISOString(),
    trust_level: 'paired',
    permissions,
    privacy_zones: ['private']
  }
}

function checkpointAndCopy(databasePath: string, backupPath: string): void {
  const database = new DatabaseSync(databasePath)
  database.exec('PRAGMA wal_checkpoint(TRUNCATE);')
  database.close()
  fs.copyFileSync(databasePath, backupPath)
}

function createPlanner(
  databasePath: string,
  backupPath: string,
  keyring: TraceReadKeyring,
  now = () => BASE_TIME
): TraceRotationPlanner {
  return new TraceRotationPlanner(
    {
      enabled: true,
      databasePath,
      backupPath,
      ownerLookupKeyBase64: LOOKUP_KEY,
      activeMasterKeyBase64: V1_KEY,
      activeKeyVersion: 'v1',
      keyringJson: JSON.stringify({ v1: V1_KEY, v2: V2_KEY }),
      planTtlSeconds: 900,
      freeSpaceMultiplier: 2.2
    },
    keyring,
    now,
    () => 'rotation-plan-1'
  )
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('stable owner trace keyring and rotation planning', () => {
  it('registers immutable stable owner bindings through migration v4', async () => {
    const { databasePath } = createTemporaryPaths()
    const store = createTraceStore(databasePath, V1_KEY)
    await store.append(await createEnvelope())
    store.close()
    applyOperationMigration(databasePath)

    const keyring = createKeyring(databasePath)
    const bindings = keyring.prepareOwner('owner-1')

    expect(bindings).toHaveLength(2)
    expect(bindings.every((binding) => binding.metadata_integrity_valid)).toBe(
      true
    )

    const database = new DatabaseSync(databasePath)
    const migrations = database
      .prepare(
        'SELECT version FROM greenfield_trace_schema_migrations ORDER BY version'
      )
      .all()
      .map((row) => Number((row as Record<string, unknown>)['version']))
    expect(migrations).toEqual([1, 2, 3, 4])
    expect(() =>
      database
        .prepare(
          `UPDATE greenfield_trace_owner_key_bindings
           SET owner_hash = 'tampered' WHERE key_version = 'v1'`
        )
        .run()
    ).toThrow(/append-only/)
    database.close()
    keyring.close()
  })

  it('opens owner traces written under multiple registered key versions', async () => {
    const { databasePath } = createTemporaryPaths()
    const v1Store = createTraceStore(databasePath, V1_KEY)
    const first = await createEnvelope(BASE_TIME)
    await v1Store.append(first)
    v1Store.close()

    const v2Store = createTraceStore(databasePath, V2_KEY)
    const second = await createEnvelope(new Date(BASE_TIME.getTime() + 1_000))
    await v2Store.append(second)
    v2Store.close()
    applyOperationMigration(databasePath)

    const keyring = createKeyring(databasePath)
    keyring.prepareOwner('owner-1')

    expect(keyring.readTrace('owner-1', first.origin.trace_id)?.envelope.origin.trace_id).toBe(
      first.origin.trace_id
    )
    expect(keyring.readTrace('owner-1', second.origin.trace_id)?.envelope.origin.trace_id).toBe(
      second.origin.trace_id
    )
    expect(
      keyring.getVersionInventory('owner-1').map((entry) => entry.key_version)
    ).toEqual(['v1', 'v2'])
    keyring.close()
  })

  it('rejects a mismatched active keyring entry', () => {
    const { databasePath } = createTemporaryPaths()
    const keyring = createKeyring(databasePath, {
      keyringJson: JSON.stringify({ v1: V2_KEY })
    })

    expect(() => keyring.getConfiguredKeys()).toThrowError(
      expect.objectContaining({ code: 'trace_keyring.active_key_mismatch' })
    )
  })

  it('creates an exact encrypted non-destructive plan with verified backup evidence', async () => {
    const { databasePath, backupPath } = createTemporaryPaths()
    const store = createTraceStore(databasePath, V1_KEY)
    const first = await createEnvelope(BASE_TIME)
    const second = await createEnvelope(new Date(BASE_TIME.getTime() + 1_000))
    await store.append(first)
    await store.append(second)
    store.close()
    applyOperationMigration(databasePath)

    const preparationKeyring = createKeyring(databasePath)
    preparationKeyring.prepareOwner('owner-1')
    preparationKeyring.close()
    checkpointAndCopy(databasePath, backupPath)

    const keyring = createKeyring(databasePath)
    const planner = createPlanner(databasePath, backupPath, keyring)
    const plan = planner.createPlan(createIdentity(), 'v2')

    expect(plan.trace_ids).toEqual(
      [first.origin.trace_id, second.origin.trace_id].sort()
    )
    expect(plan.record_hashes).toHaveLength(2)
    expect(plan.backup.status).toBe('verified')
    expect(plan.execution_supported).toBe(false)
    expect(plan.ready_for_execution).toBe(false)
    expect(plan.blockers).toContain(
      'rotation.reencryption_executor_not_implemented'
    )
    expect(plan.plan_hash).toMatch(/^[a-f0-9]{64}$/)

    const storage = Buffer.concat(
      [databasePath, `${databasePath}-wal`]
        .filter((candidate) => fs.existsSync(candidate))
        .map((candidate) => fs.readFileSync(candidate))
    ).toString('utf8')
    expect(storage).not.toContain('owner-1')
    expect(storage).not.toContain(first.origin.trace_id)
    expect(storage).not.toContain(second.origin.trace_id)

    planner.close()
    keyring.close()
  })

  it('reopens and verifies a persisted plan after a process restart', async () => {
    const { databasePath, backupPath } = createTemporaryPaths()
    const store = createTraceStore(databasePath, V1_KEY)
    await store.append(await createEnvelope())
    store.close()
    applyOperationMigration(databasePath)
    const preparationKeyring = createKeyring(databasePath)
    preparationKeyring.prepareOwner('owner-1')
    preparationKeyring.close()
    checkpointAndCopy(databasePath, backupPath)

    const firstKeyring = createKeyring(databasePath)
    const firstPlanner = createPlanner(databasePath, backupPath, firstKeyring)
    const created = firstPlanner.createPlan(createIdentity(), 'v2')
    firstPlanner.close()
    firstKeyring.close()

    const reopenedKeyring = createKeyring(databasePath)
    const reopenedPlanner = createPlanner(
      databasePath,
      backupPath,
      reopenedKeyring
    )
    const reopened = reopenedPlanner.readPlan(
      createIdentity(),
      created.rotation_plan_id
    )

    expect(reopened).not.toBeNull()
    expect(reopened?.plan_hash).toBe(created.plan_hash)
    expect(reopened?.trace_ids).toEqual(created.trace_ids)
    expect(reopened?.backup.status).toBe('verified')
    reopenedPlanner.close()
    reopenedKeyring.close()
  })

  it('records missing backup and storage prerequisites as deterministic blockers', async () => {
    const { databasePath, backupPath } = createTemporaryPaths()
    const store = createTraceStore(databasePath, V1_KEY)
    await store.append(await createEnvelope())
    store.close()
    applyOperationMigration(databasePath)

    const keyring = createKeyring(databasePath)
    const planner = createPlanner(databasePath, backupPath, keyring)
    const plan = planner.createPlan(createIdentity(), 'v2')

    expect(plan.backup.status).toBe('missing')
    expect(plan.blockers).toContain('rotation.backup_restore_not_verified')
    planner.close()
    keyring.close()
  })

  it('fails closed without owner planning permission or owner match', async () => {
    const { databasePath, backupPath } = createTemporaryPaths()
    const store = createTraceStore(databasePath, V1_KEY)
    await store.append(await createEnvelope())
    store.close()
    applyOperationMigration(databasePath)

    const keyring = createKeyring(databasePath)
    const planner = createPlanner(databasePath, backupPath, keyring)

    expect(() =>
      planner.createPlan(createIdentity(['trace.operations.read']), 'v2')
    ).toThrowError(
      expect.objectContaining({ code: 'trace_rotation.permission_missing' })
    )
    expect(() =>
      planner.createPlan(createIdentity(undefined, 'owner-2'), 'v2')
    ).toThrow()
    planner.close()
    keyring.close()
  })
})
