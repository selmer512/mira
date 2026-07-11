import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  EncryptedSqliteMemoryStore,
  GreenfieldExecutionError,
  MEMORY_CANDIDATE_CREATE_CAPABILITY,
  MEMORY_CONFIRM_CAPABILITY,
  MEMORY_EXPORT_CAPABILITY,
  MEMORY_PURGE_CAPABILITY,
  MEMORY_READ_CAPABILITY,
  MemoryCandidateRequestOrchestrator,
  MemoryLifecycleService,
  type IdentityResolver,
  type MemoryTraceStore,
  type TracePersistenceReceipt,
  type VerticalSliceEnvelope
} from '@/core/greenfield'
import { createMemoryRoute } from '@/core/http-server/api/greenfield/memory'

const MEMORY_KEY = Buffer.alloc(32, 47).toString('base64')
const LOOKUP_KEY = Buffer.alloc(32, 53).toString('base64')
const BASE_TIME = new Date('2026-07-11T16:00:00.000Z')
const temporaryDirectories: string[] = []

function createDatabasePath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mira-memory-route-'))
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
  return () => `memory-route-id-${++value}`
}

function identityResolver(): IdentityResolver {
  return {
    resolve: async (input) => {
      if (input.credential !== 'correct-key') {
        throw new GreenfieldExecutionError(
          'identity.credential_invalid',
          'Credential is invalid.',
          401
        )
      }
      if (input.deviceId !== 'device-1') {
        throw new GreenfieldExecutionError(
          'identity.device_not_paired',
          'Device is not paired.',
          403
        )
      }
      return {
        owner_id: 'owner-1',
        device_id: 'device-1',
        auth_session_id: 'session-1',
        authenticated_at: input.authenticatedAt.toISOString(),
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
  }
}

function persistenceReceipt(envelope: VerticalSliceEnvelope): TracePersistenceReceipt {
  return {
    traceId: envelope.origin.trace_id,
    recordHash: 'b'.repeat(64),
    previousRecordHash: null,
    retentionUntil: '2026-08-10T16:00:00.000Z',
    encryptionKeyId: 'trace-key-id',
    redactionStatus: 'session_redacted'
  }
}

function candidateBody() {
  return {
    device_id: 'device-1',
    title: 'Historical preference',
    content: 'The owner preferred window seats during the 2024 trip.',
    memory_class: 'semantic',
    temporal_status: 'historical',
    observed_at: BASE_TIME.toISOString(),
    valid_from: null,
    valid_until: null,
    privacy_zone: 'private',
    confidence: 1,
    salience: 0.8,
    retention_policy: 'owner_confirmed',
    source_refs: ['owner://statement/window-seat'],
    derivation_links: [],
    contradiction_links: [],
    supersession_links: []
  }
}

async function createHarness() {
  const databasePath = createDatabasePath()
  const store = new EncryptedSqliteMemoryStore({
    enabled: true,
    databasePath,
    masterKeyBase64: MEMORY_KEY,
    ownerLookupKeyBase64: LOOKUP_KEY,
    keyVersion: 'v1',
    candidateTtlSeconds: 900,
    purgePlanTtlSeconds: 300
  })
  const service = new MemoryLifecycleService(store)
  const resolver = identityResolver()
  const traceStore: MemoryTraceStore = {
    append: vi.fn(async (envelope) => persistenceReceipt(envelope))
  }
  const runtime = new MemoryCandidateRequestOrchestrator({
    identityResolver: resolver,
    memoryService: service,
    traceStore,
    now: createClock(),
    createId: createIds()
  })
  const fastify = Fastify()
  await fastify.register(createMemoryRoute(resolver, runtime, service), {
    apiVersion: 'v1'
  })
  return { databasePath, store, service, traceStore, fastify }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('authenticated memory lifecycle routes', () => {
  it('creates, confirms, retrieves, and exports an owner memory with no-store responses', async () => {
    const { store, traceStore, fastify } = await createHarness()
    const created = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/memory/candidate',
      headers: { 'x-api-key': 'correct-key' },
      payload: candidateBody()
    })

    expect(created.statusCode).toBe(200)
    expect(created.headers['cache-control']).toBe('no-store')
    const createdPayload = created.json()
    expect(createdPayload.candidate.confirmation_status).toBe('pending')
    expect(traceStore.append).toHaveBeenCalledTimes(1)

    const decided = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/memory/candidate/decision',
      headers: { 'x-api-key': 'correct-key' },
      payload: {
        device_id: 'device-1',
        candidate_id: createdPayload.candidate.candidate_id,
        approval_token: createdPayload.approval_token,
        decision: 'owner_confirmed'
      }
    })
    expect(decided.statusCode).toBe(200)
    expect(decided.json().receipt.verification_status).toBe('succeeded')

    const searched = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/memory/search?device_id=device-1&query=window%20seats&time_scope=historical&limit=10',
      headers: { 'x-api-key': 'correct-key' }
    })
    expect(searched.statusCode).toBe(200)
    expect(searched.json().result.records).toHaveLength(1)

    const exported = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/memory/export?device_id=device-1',
      headers: { 'x-api-key': 'correct-key' }
    })
    expect(exported.statusCode).toBe(200)
    expect(exported.json().export_bundle.record_count).toBe(1)
    expect(exported.json().export_bundle.bundle_hash).toMatch(/^[a-f0-9]{64}$/)

    await fastify.close()
    store.close()
  })

  it('refuses to use durable memory for current state and re-verifies credential and device', async () => {
    const { store, fastify } = await createHarness()
    const current = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/memory/search?device_id=device-1&query=status&time_scope=current',
      headers: { 'x-api-key': 'correct-key' }
    })
    const wrongCredential = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/memory/export?device_id=device-1',
      headers: { 'x-api-key': 'wrong-key' }
    })
    const wrongDevice = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/memory/export?device_id=attacker',
      headers: { 'x-api-key': 'correct-key' }
    })

    expect(current.statusCode).toBe(200)
    expect(current.json().result.records).toEqual([])
    expect(current.json().result.limitations.join(' ')).toContain(
      'current_state_requires_fresh_evidence'
    )
    expect(wrongCredential.statusCode).toBe(401)
    expect(wrongDevice.statusCode).toBe(403)

    await fastify.close()
    store.close()
  })

  it('requires separate approval and verified execution for exact physical purge', async () => {
    const { store, fastify } = await createHarness()
    const created = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/memory/candidate',
      headers: { 'x-api-key': 'correct-key' },
      payload: candidateBody()
    })
    const createdPayload = created.json()
    const decided = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/memory/candidate/decision',
      headers: { 'x-api-key': 'correct-key' },
      payload: {
        device_id: 'device-1',
        candidate_id: createdPayload.candidate.candidate_id,
        approval_token: createdPayload.approval_token,
        decision: 'owner_confirmed'
      }
    })
    const memoryId = decided.json().memory.memory_id

    const planned = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/memory/purge/plan',
      headers: { 'x-api-key': 'correct-key' },
      payload: {
        device_id: 'device-1',
        memory_ids: [memoryId],
        reason_code: 'owner_requested_forget'
      }
    })
    expect(planned.statusCode).toBe(200)
    const plannedPayload = planned.json()

    const premature = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/memory/purge/execute',
      headers: { 'x-api-key': 'correct-key' },
      payload: {
        device_id: 'device-1',
        plan_id: plannedPayload.plan.plan_id
      }
    })
    expect(premature.statusCode).toBe(403)

    const approved = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/memory/purge/decision',
      headers: { 'x-api-key': 'correct-key' },
      payload: {
        device_id: 'device-1',
        plan_id: plannedPayload.plan.plan_id,
        approval_token: plannedPayload.approval_token,
        decision: 'approved'
      }
    })
    expect(approved.statusCode).toBe(200)

    const executed = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/memory/purge/execute',
      headers: { 'x-api-key': 'correct-key' },
      payload: {
        device_id: 'device-1',
        plan_id: plannedPayload.plan.plan_id
      }
    })
    expect(executed.statusCode).toBe(200)
    expect(executed.json().receipt.execution_status).toBe('succeeded')
    expect(executed.json().receipt.verification_status).toBe('succeeded')

    const searched = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/memory/search?device_id=device-1&query=window%20seats&time_scope=historical',
      headers: { 'x-api-key': 'correct-key' }
    })
    expect(searched.json().result.records).toEqual([])

    await fastify.close()
    store.close()
  })

  it('strips undeclared owner fields before candidate authorization', async () => {
    const { store, fastify } = await createHarness()
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/memory/candidate',
      headers: { 'x-api-key': 'correct-key' },
      payload: {
        ...candidateBody(),
        owner_id: 'attacker'
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().candidate.owner_id).toBe('owner-1')

    await fastify.close()
    store.close()
  })
})
