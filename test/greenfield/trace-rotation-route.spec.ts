import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import {
  GreenfieldExecutionError,
  TRACE_ROTATION_PLAN_CAPABILITY,
  type IdentityResolver,
  type TraceRotationPlan
} from '@/core/greenfield'
import { createTraceRotationRoute } from '@/core/http-server/api/greenfield/trace-rotation'

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
        permissions: ['trace.operations.read', TRACE_ROTATION_PLAN_CAPABILITY],
        privacy_zones: ['private']
      }
    }
  }
}

function plan(): TraceRotationPlan {
  return {
    rotation_plan_id: 'rotation-plan-1',
    target_key_version: 'v2',
    target_encryption_key_id: '0123456789abcdef',
    source_key_versions: ['v1'],
    trace_count: 1,
    operation_plan_count: 0,
    trace_ids: ['trace-1'],
    operation_plan_ids: [],
    record_hashes: ['a'.repeat(64)],
    estimated_rewrite_bytes: 1024,
    required_free_bytes: 4096,
    available_free_bytes: 8192,
    backup: {
      status: 'verified',
      path_ref: 'backup:abcdef',
      size_bytes: 4096,
      integrity_check: 'ok',
      migration_versions: [1, 2, 3, 4],
      trace_count: 1,
      operation_plan_count: 0,
      verified_at: '2026-07-11T01:30:00.000Z',
      issue: null
    },
    interruption_checkpoints: ['checkpoint'],
    verification_criteria: ['verify'],
    rollback_limits: ['limit'],
    blockers: ['rotation.reencryption_executor_not_implemented'],
    execution_supported: false,
    ready_for_execution: false,
    created_at: '2026-07-11T01:30:00.000Z',
    expires_at: '2026-07-11T01:45:00.000Z',
    plan_hash: 'b'.repeat(64)
  }
}

describe('trace rotation planning routes', () => {
  it('creates an authenticated no-store rotation plan', async () => {
    const fastify = Fastify()
    const createPlan = vi.fn(() => plan())
    await fastify.register(
      createTraceRotationRoute(identityResolver(), {
        createPlan,
        readPlan: vi.fn(() => null)
      }),
      { apiVersion: 'v1' }
    )

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/trace-rotation/plan',
      headers: { 'x-api-key': 'correct-key' },
      payload: { device_id: 'device-1', target_key_version: 'v2' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ success: true, plan: plan() })
    expect(createPlan).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: 'owner-1', device_id: 'device-1' }),
      'v2'
    )
    await fastify.close()
  })

  it('re-verifies credentials before planning', async () => {
    const fastify = Fastify()
    const createPlan = vi.fn(() => plan())
    await fastify.register(
      createTraceRotationRoute(identityResolver(), {
        createPlan,
        readPlan: vi.fn(() => null)
      }),
      { apiVersion: 'v1' }
    )

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/trace-rotation/plan',
      headers: { 'x-api-key': 'wrong-key' },
      payload: { device_id: 'device-1', target_key_version: 'v2' }
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      success: false,
      code: 'identity.credential_invalid'
    })
    expect(createPlan).not.toHaveBeenCalled()
    await fastify.close()
  })

  it('rejects an unpaired device and undeclared body fields', async () => {
    const fastify = Fastify()
    const createPlan = vi.fn(() => plan())
    await fastify.register(
      createTraceRotationRoute(identityResolver(), {
        createPlan,
        readPlan: vi.fn(() => null)
      }),
      { apiVersion: 'v1' }
    )

    const unpaired = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/trace-rotation/plan',
      headers: { 'x-api-key': 'correct-key' },
      payload: { device_id: 'attacker', target_key_version: 'v2' }
    })
    const invalid = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/trace-rotation/plan',
      headers: { 'x-api-key': 'correct-key' },
      payload: {
        device_id: 'device-1',
        target_key_version: 'v2',
        owner_id: 'attacker'
      }
    })

    expect(unpaired.statusCode).toBe(403)
    expect(invalid.statusCode).toBe(400)
    expect(createPlan).not.toHaveBeenCalled()
    await fastify.close()
  })

  it('reads only owner-scoped persisted plans', async () => {
    const fastify = Fastify()
    const readPlan = vi.fn(() => plan())
    await fastify.register(
      createTraceRotationRoute(identityResolver(), {
        createPlan: vi.fn(() => plan()),
        readPlan
      }),
      { apiVersion: 'v1' }
    )

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/trace-rotation/plan?device_id=device-1&rotation_plan_id=rotation-plan-1',
      headers: { 'x-api-key': 'correct-key' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(readPlan).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: 'owner-1' }),
      'rotation-plan-1'
    )
    await fastify.close()
  })

  it('returns a deterministic owner-scoped not-found response', async () => {
    const fastify = Fastify()
    await fastify.register(
      createTraceRotationRoute(identityResolver(), {
        createPlan: vi.fn(() => plan()),
        readPlan: vi.fn(() => null)
      }),
      { apiVersion: 'v1' }
    )

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/trace-rotation/plan?device_id=device-1&rotation_plan_id=missing',
      headers: { 'x-api-key': 'correct-key' }
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      success: false,
      code: 'trace_rotation.plan_not_found',
      message: 'The rotation plan was not found for this owner.'
    })
    await fastify.close()
  })
})
