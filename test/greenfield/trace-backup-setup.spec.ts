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
  type GreenfieldRuntimeDependencies,
  type RuntimeStatusReader,
  type RuntimeStatusSnapshot
} from '@/core/greenfield'
import { createTraceBackup } from '../../scripts/greenfield/create-trace-backup.js'

const MASTER_KEY = Buffer.alloc(32, 31).toString('base64')
const LOOKUP_KEY = Buffer.alloc(32, 32).toString('base64')
const BASE_TIME = new Date('2026-07-11T02:00:00.000Z')
const temporaryDirectories: string[] = []

class TestStatusReader implements RuntimeStatusReader {
  public async read(observedAt: Date): Promise<RuntimeStatusSnapshot> {
    return {
      status: 'online',
      observed_at: observedAt.toISOString(),
      uptime_seconds: 1,
      version: 'backup-test',
      routing_mode: 'smart',
      llm_provider_ready: true,
      local_model: 'deterministic-test-model',
      limitations: []
    }
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
    now: () => BASE_TIME
  }
}

async function prepareDatabase(databasePath: string): Promise<void> {
  const envelope = (
    await new GreenfieldRequestOrchestrator(createDependencies()).execute({
      device_id: 'device-1',
      capability: SYSTEM_STATUS_CAPABILITY,
      input: 'Create backup acceptance evidence.',
      credential: 'backup-test-key'
    })
  ).envelope
  const traceStore = new EncryptedSqliteTraceStore({
    enabled: true,
    databasePath,
    masterKeyBase64: MASTER_KEY,
    retentionDays: 30
  })
  await traceStore.append(envelope)
  traceStore.close()

  const operationStore = new TraceOwnerOperationStore({
    enabled: true,
    databasePath,
    masterKeyBase64: MASTER_KEY,
    planTtlSeconds: 300
  })
  operationStore.getAppliedMigrationVersions()
  operationStore.close()

  const keyring = new TraceReadKeyring({
    enabled: true,
    databasePath,
    activeKeyVersion: 'v1',
    activeMasterKeyBase64: MASTER_KEY,
    ownerLookupKeyBase64: LOOKUP_KEY,
    keyringJson: JSON.stringify({ v1: MASTER_KEY })
  })
  keyring.prepareOwner('owner-1')
  keyring.close()
}

function paths(): { databasePath: string; backupPath: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-backup-test-'))
  temporaryDirectories.push(directory)
  return {
    databasePath: path.join(directory, 'traces.sqlite'),
    backupPath: path.join(directory, 'backups', 'traces.sqlite')
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('verified trace backup setup', () => {
  it('creates an atomic integrity-checked snapshot with matching protected counts', async () => {
    const { databasePath, backupPath } = paths()
    await prepareDatabase(databasePath)

    const evidence = createTraceBackup({
      databasePath,
      backupPath,
      now: () => BASE_TIME
    })

    expect(evidence).toMatchObject({
      status: 'verified',
      integrity_check: 'ok',
      migration_versions: [1, 2, 3, 4],
      trace_count: 1,
      operation_plan_count: 0,
      rotation_plan_count: 0,
      created_at: BASE_TIME.toISOString()
    })
    expect(fs.existsSync(backupPath)).toBe(true)
    const backup = new DatabaseSync(backupPath)
    expect(
      Object.values(backup.prepare('PRAGMA integrity_check').get() || {})[0]
    ).toBe('ok')
    backup.close()
  })

  it('refuses live-path reuse and implicit backup replacement', async () => {
    const { databasePath, backupPath } = paths()
    await prepareDatabase(databasePath)
    createTraceBackup({ databasePath, backupPath })

    expect(() =>
      createTraceBackup({ databasePath, backupPath: databasePath })
    ).toThrow(/cannot point to the live database/)
    expect(() => createTraceBackup({ databasePath, backupPath })).toThrow(
      /already exists/
    )
  })
})
