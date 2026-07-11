import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import {
  GreenfieldExecutionError,
  TRACE_OPERATIONS_READ_CAPABILITY,
  type IdentityResolver,
  type TraceOperationsDashboard
} from '@/core/greenfield'
import { createTraceOperationsDashboardRoute } from '@/core/http-server/api/greenfield/trace-operations-dashboard'

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
        permissions: [TRACE_OPERATIONS_READ_CAPABILITY],
        privacy_zones: ['private']
      }
    }
  }
}

function dashboard(): TraceOperationsDashboard {
  return {
    owner_ref: 'owner:abcdef',
    device_ref: 'device:abcdef',
    readiness: {
      observed_at: '2026-07-10T23:00:00.000Z',
      status: 'blocked',
      rotation_supported: false,
      active_key: {
        key_version: 'v1',
        encryption_key_id: '0123456789abcdef',
        algorithm: 'aes-256-gcm',
        registered_at: '2026-07-10T23:00:00.000Z',
        metadata_integrity_valid: true
      },
      chain: {
        valid: true,
        recordCount: 1,
        issue: null
      },
      trace_inventory: {
        total: 1,
        catalog_count: 1,
        catalog_truncated: false,
        active_key_count: 1,
        unknown_key_version_count: 0,
        versions: [
          {
            encryption_key_id: '0123456789abcdef',
            key_version: 'v1',
            trace_count: 1,
            active: true
          }
        ]
      },
      operation_inventory: {
        total: 0,
        active_unexpired: 0,
        approved_unexecuted: 0,
        unreadable_with_active_key: 0,
        verified_receipts: 0
      },
      blockers: ['rotation.reencryption_executor_not_implemented'],
      warnings: [],
      migration_versions: [1, 2, 3]
    },
    traces: [
      {
        trace_id: 'trace-1',
        event_type: 'owner_request',
        occurred_at: '2026-07-10T22:59:00.000Z',
        completed_at: '2026-07-10T22:59:01.000Z',
        privacy_classification: 'private',
        record_hash: 'a'.repeat(64),
        retention_until: '2026-08-09T22:59:01.000Z',
        encryption_key_id: '0123456789abcdef',
        encryption_key_version: 'v1',
        created_at: '2026-07-10T22:59:01.000Z'
      }
    ],
    plans: []
  }
}

describe('trace operations dashboard route', () => {
  it('returns an authenticated owner dashboard with no-store headers', async () => {
    const fastify = Fastify()
    const getDashboard = vi.fn(async () => dashboard())
    await fastify.register(
      createTraceOperationsDashboardRoute(identityResolver(), { getDashboard }),
      { apiVersion: 'v1' }
    )

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/trace-operations/dashboard?device_id=device-1',
      headers: { 'x-api-key': 'correct-key' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ success: true, dashboard: dashboard() })
    expect(getDashboard).toHaveBeenCalledTimes(1)
    await fastify.close()
  })

  it('re-verifies the credential before reading owner metadata', async () => {
    const fastify = Fastify()
    const getDashboard = vi.fn(async () => dashboard())
    await fastify.register(
      createTraceOperationsDashboardRoute(identityResolver(), { getDashboard }),
      { apiVersion: 'v1' }
    )

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/trace-operations/dashboard?device_id=device-1',
      headers: { 'x-api-key': 'wrong-key' }
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({
      success: false,
      code: 'identity.credential_invalid'
    })
    expect(getDashboard).not.toHaveBeenCalled()
    await fastify.close()
  })

  it('rejects an unpaired device before dashboard access', async () => {
    const fastify = Fastify()
    const getDashboard = vi.fn(async () => dashboard())
    await fastify.register(
      createTraceOperationsDashboardRoute(identityResolver(), { getDashboard }),
      { apiVersion: 'v1' }
    )

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/trace-operations/dashboard?device_id=attacker',
      headers: { 'x-api-key': 'correct-key' }
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      success: false,
      code: 'identity.device_not_paired'
    })
    expect(getDashboard).not.toHaveBeenCalled()
    await fastify.close()
  })

  it('rejects undeclared query fields through the Fastify schema', async () => {
    const fastify = Fastify()
    const getDashboard = vi.fn(async () => dashboard())
    await fastify.register(
      createTraceOperationsDashboardRoute(identityResolver(), { getDashboard }),
      { apiVersion: 'v1' }
    )

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/trace-operations/dashboard?device_id=device-1&owner_id=attacker',
      headers: { 'x-api-key': 'correct-key' }
    })

    expect(response.statusCode).toBe(400)
    expect(getDashboard).not.toHaveBeenCalled()
    await fastify.close()
  })
})
