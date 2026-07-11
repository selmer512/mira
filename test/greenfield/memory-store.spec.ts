import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  EncryptedSqliteMemoryStore,
  MEMORY_CANDIDATE_CREATE_CAPABILITY,
  MEMORY_CONFIRM_CAPABILITY,
  MEMORY_EXPORT_CAPABILITY,
  MEMORY_PURGE_CAPABILITY,
  MEMORY_READ_CAPABILITY,
  type IdentityContext,
  type MemoryCandidateDraft
} from '@/core/greenfield'

const MEMORY_KEY = Buffer.alloc(32, 31).toString('base64')
const LOOKUP_KEY = Buffer.alloc(32, 37).toString('base64')
const BASE_TIME = new Date('2026-07-11T14:00:00.000Z')
const temporaryDirectories: string[] = []

function createDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-memory-test-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'memory.sqlite')
}

function createStore(databasePath: string): EncryptedSqliteMemoryStore {
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

function identity(ownerId = 'owner-1'): IdentityContext {
  return {
    owner_id: ownerId,
    device_id: 'device-1',
    auth_session_id: 'session-1',
    authenticated_at: BASE_TIME.toISOString(),
    trust_level: 'paired',
    permissions: [
      MEMORY_CANDIDATE_CREATE_CAPABILITY,
      MEMORY_CONFIRM_CAPABILITY,
      MEMORY_READ_CAPABILITY,
      MEMORY_EXPORT_CAPABILITY,
      MEMORY_PURGE_CAPABILITY
    ],
    privacy_zones: ['private']
  }
}

function draft(
  content: string,
  overrides: Partial<MemoryCandidateDraft> = {}
): MemoryCandidateDraft {
  return {
    title: 'Owner preference',
    content,
    memory_class: 'semantic',
    source_refs: ['owner://statement/1'],
    observed_at: BASE_TIME.toISOString(),
    valid_from: null,
    valid_until: null,
    temporal_status: 'historical',
    confidence: 1,
    privacy_zone: 'private',
    salience: 0.8,
    retention_policy: 'owner_confirmed',
    derivation_links: [],
    contradiction_links: [],
    supersession_links: [],
    ...overrides
  }
}

function idFactory(prefix: string): () => string {
  let value = 0
  return () => `${prefix}-${++value}`
}

function confirm(
  store: EncryptedSqliteMemoryStore,
  candidateId: string,
  content: string,
  overrides: Partial<MemoryCandidateDraft> = {}
) {
  const created = store.createCandidate({
    identity: identity(),
    traceId: `trace-${candidateId}`,
    candidateId,
    draft: draft(content, overrides),
    createdAt: BASE_TIME
  })
  return store.decideCandidate({
    identity: identity(),
    candidateId,
    approvalToken: created.approval_token,
    decision: 'owner_confirmed',
    decidedAt: new Date(BASE_TIME.getTime() + 1_000),
    createId: idFactory(`${candidateId}-decision`)
  })
}

function tableCount(databasePath: string, table: string): number {
  const database = new DatabaseSync(databasePath)
  try {
    const row = database
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as Record<string, unknown>
    return Number(row['count'])
  } finally {
    database.close()
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('encrypted provenance-aware memory store', () => {
  it('applies memory migrations idempotently', () => {
    const databasePath = createDatabasePath()
    const first = createStore(databasePath)
    expect(first.getAppliedMigrationVersions()).toEqual([1])
    first.close()

    const reopened = createStore(databasePath)
    expect(reopened.getAppliedMigrationVersions()).toEqual([1])
    reopened.close()
  })

  it('keeps pending content encrypted and unavailable to retrieval until confirmation', () => {
    const databasePath = createDatabasePath()
    const store = createStore(databasePath)
    const secret = 'The owner prefers silent notifications after ten at night.'
    const created = store.createCandidate({
      identity: identity(),
      traceId: 'trace-candidate-1',
      candidateId: 'candidate-1',
      draft: draft(secret),
      createdAt: BASE_TIME
    })

    expect(
      store.search(identity(), 'silent notifications', 'historical', 10).records
    ).toEqual([])
    store.close()

    const storage = fs.readFileSync(databasePath).toString('utf8')
    expect(storage).not.toContain(secret)
    expect(storage).not.toContain('Owner preference')
    expect(storage).not.toContain('owner-1')

    const reopened = createStore(databasePath)
    const pending = reopened.readCandidate('owner-1', 'candidate-1')
    expect(pending?.content).toBe(secret)
    const decided = reopened.decideCandidate({
      identity: identity(),
      candidateId: 'candidate-1',
      approvalToken: created.approval_token,
      decision: 'owner_confirmed',
      decidedAt: new Date(BASE_TIME.getTime() + 1_000),
      createId: idFactory('confirm')
    })
    expect(decided.memory?.content).toBe(secret)
    expect(
      reopened.search(identity(), 'silent notifications', 'historical', 10)
        .records
    ).toHaveLength(1)
    reopened.close()
  })

  it('records rejection without creating durable memory', () => {
    const databasePath = createDatabasePath()
    const store = createStore(databasePath)
    const created = store.createCandidate({
      identity: identity(),
      traceId: 'trace-reject',
      candidateId: 'candidate-reject',
      draft: draft('This statement should be rejected.'),
      createdAt: BASE_TIME
    })

    const result = store.decideCandidate({
      identity: identity(),
      candidateId: 'candidate-reject',
      approvalToken: created.approval_token,
      decision: 'rejected',
      decidedAt: new Date(BASE_TIME.getTime() + 1_000),
      createId: idFactory('reject')
    })

    expect(result.memory).toBeNull()
    expect(result.receipt.decision).toBe('rejected')
    expect(store.countOwnerMemories('owner-1')).toBe(0)
    expect(store.readCandidate('owner-1', 'candidate-reject')).toBeNull()
    store.close()
  })

  it('never treats durable memory as current-state evidence', () => {
    const databasePath = createDatabasePath()
    const store = createStore(databasePath)
    confirm(store, 'candidate-current', 'The server was online yesterday.')

    const result = store.search(identity(), 'server online', 'current', 10)

    expect(result.records).toEqual([])
    expect(result.limitations.join(' ')).toContain(
      'current_state_requires_fresh_evidence'
    )
    store.close()
  })

  it('isolates records and search projections by owner', () => {
    const databasePath = createDatabasePath()
    const store = createStore(databasePath)
    confirm(store, 'candidate-owner', 'Owner one likes jasmine tea.')

    expect(store.countOwnerMemories('owner-1')).toBe(1)
    expect(store.countOwnerMemories('owner-2')).toBe(0)
    expect(
      store.search(identity('owner-2'), 'jasmine tea', 'historical', 10).records
    ).toEqual([])
    store.close()
  })

  it('excludes superseded records from normal retrieval while retaining lineage', () => {
    const databasePath = createDatabasePath()
    const store = createStore(databasePath)
    const original = confirm(
      store,
      'candidate-original',
      'The preferred meeting time is nine in the morning.'
    ).memory
    expect(original).not.toBeNull()

    const replacement = confirm(
      store,
      'candidate-replacement',
      'The preferred meeting time is ten in the morning.',
      { supersession_links: [original!.memory_id] }
    ).memory

    const records = store.search(
      identity(),
      'preferred meeting time',
      'historical',
      10
    ).records
    expect(records.map((record) => record.memory_id)).toEqual([
      replacement!.memory_id
    ])
    expect(replacement?.supersedes).toEqual([original!.memory_id])
    store.close()
  })

  it('physically purges canonical, search, graph, and linked candidate data and prevents recall', () => {
    const databasePath = createDatabasePath()
    const store = createStore(databasePath)
    const original = confirm(
      store,
      'candidate-purge-original',
      'Disposable test memory about a cobalt bicycle.'
    ).memory!
    const replacement = confirm(
      store,
      'candidate-purge-replacement',
      'Replacement memory about a cobalt bicycle.',
      { supersession_links: [original.memory_id] }
    ).memory!
    const pending = store.createCandidate({
      identity: identity(),
      traceId: 'trace-linked-pending',
      candidateId: 'candidate-linked-pending',
      draft: draft('Pending derivative memory.', {
        derivation_links: [replacement.memory_id]
      }),
      createdAt: new Date(BASE_TIME.getTime() + 2_000)
    })
    expect(pending.candidate.candidate_id).toBe('candidate-linked-pending')

    const planned = store.createPurgePlan({
      identity: identity(),
      traceId: 'trace-purge-plan',
      memoryIds: [original.memory_id, replacement.memory_id],
      reasonCode: 'test_data_removal',
      createdAt: new Date(BASE_TIME.getTime() + 3_000),
      createId: idFactory('purge-plan')
    })
    store.decidePurgePlan({
      identity: identity(),
      planId: planned.plan.plan_id,
      approvalToken: planned.approvalToken,
      decision: 'approved',
      decidedAt: new Date(BASE_TIME.getTime() + 4_000),
      createId: idFactory('purge-approval')
    })
    const receipt = store.executePurgePlan({
      identity: identity(),
      planId: planned.plan.plan_id,
      executedAt: new Date(BASE_TIME.getTime() + 5_000),
      createId: idFactory('purge-execution')
    })

    expect(receipt.execution_status).toBe('succeeded')
    expect(receipt.verification_status).toBe('succeeded')
    expect(store.countOwnerMemories('owner-1')).toBe(0)
    expect(
      store.search(identity(), 'cobalt bicycle', 'historical', 10).records
    ).toEqual([])
    expect(
      store.readCandidate('owner-1', 'candidate-linked-pending')
    ).toBeNull()
    expect(store.verifyOwnerEventChain('owner-1').valid).toBe(true)
    store.close()

    expect(tableCount(databasePath, 'greenfield_memory_records')).toBe(0)
    expect(tableCount(databasePath, 'greenfield_memory_search_terms')).toBe(0)
    expect(tableCount(databasePath, 'greenfield_memory_graph_edges')).toBe(0)
    expect(tableCount(databasePath, 'greenfield_memory_candidates')).toBe(0)
    expect(tableCount(databasePath, 'greenfield_memory_purge_receipts')).toBe(1)
  })

  it('exports only authenticated owner records with a deterministic bundle hash', () => {
    const databasePath = createDatabasePath()
    const store = createStore(databasePath)
    confirm(store, 'candidate-export', 'Historical exportable memory.')

    const bundle = store.exportOwner(identity(), BASE_TIME)

    expect(bundle.record_count).toBe(1)
    expect(bundle.records[0]?.owner_id).toBe('owner-1')
    expect(bundle.bundle_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(store.exportOwner(identity('owner-2'), BASE_TIME).record_count).toBe(0)
    store.close()
  })
})
