import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  EncryptedSqliteMemoryStore,
  MEMORY_CANDIDATE_CREATE_CAPABILITY,
  MEMORY_CONFIRM_CAPABILITY,
  MEMORY_READ_CAPABILITY,
  type IdentityContext
} from '@/core/greenfield'

const MEMORY_KEY = Buffer.alloc(32, 59).toString('base64')
const LOOKUP_KEY = Buffer.alloc(32, 61).toString('base64')
const BASE_TIME = new Date('2026-07-11T17:00:00.000Z')
const temporaryDirectories: string[] = []

function createDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-memory-order-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'memory.sqlite')
}

function identity(): IdentityContext {
  return {
    owner_id: 'owner-1',
    device_id: 'device-1',
    auth_session_id: 'session-1',
    authenticated_at: BASE_TIME.toISOString(),
    trust_level: 'paired',
    permissions: [
      MEMORY_CANDIDATE_CREATE_CAPABILITY,
      MEMORY_CONFIRM_CAPABILITY,
      MEMORY_READ_CAPABILITY
    ],
    privacy_zones: ['private']
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('memory event append ordering', () => {
  it('keeps the hash chain valid when a later appended event has an earlier timestamp', () => {
    const store = new EncryptedSqliteMemoryStore({
      enabled: true,
      databasePath: createDatabasePath(),
      masterKeyBase64: MEMORY_KEY,
      ownerLookupKeyBase64: LOOKUP_KEY,
      keyVersion: 'v1',
      candidateTtlSeconds: 900,
      purgePlanTtlSeconds: 300
    })
    const candidate = store.createCandidate({
      identity: identity(),
      traceId: 'trace-order-1',
      candidateId: 'candidate-order-1',
      createdAt: BASE_TIME,
      draft: {
        title: 'Clock rollback test',
        content: 'This memory verifies append ordering across clock rollback.',
        memory_class: 'semantic',
        source_refs: ['test://clock-rollback'],
        observed_at: BASE_TIME.toISOString(),
        valid_from: null,
        valid_until: null,
        temporal_status: 'historical',
        confidence: 1,
        privacy_zone: 'private',
        salience: 0.5,
        retention_policy: 'test_only',
        derivation_links: [],
        contradiction_links: [],
        supersession_links: []
      }
    })
    store.decideCandidate({
      identity: identity(),
      candidateId: candidate.candidate.candidate_id,
      approvalToken: candidate.approval_token,
      decision: 'owner_confirmed',
      decidedAt: new Date(BASE_TIME.getTime() + 1_000),
      createId: (() => {
        let value = 0
        return () => `decision-order-${++value}`
      })()
    })

    store.search(
      identity(),
      'clock rollback',
      'historical',
      10,
      new Date(BASE_TIME.getTime() - 60_000)
    )

    expect(store.verifyOwnerEventChain('owner-1')).toMatchObject({
      valid: true,
      issue: null
    })
    store.close()
  })
})
