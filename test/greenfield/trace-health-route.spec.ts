import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import {
  GreenfieldExecutionError,
  type IdentityResolver,
  type TraceMaintenanceHealth
} from '@/core/greenfield'
import { createTraceHealthRoute } from '@/core/http-server/api/greenfield/health'

function identityResolver(ownerId = 'owner-1'): IdentityResolver {
  return {
    resolve: async (input) => {
      if (input.deviceId !== 'device-1') {
        throw new GreenfieldExecutionError(
          'identity.device_not_paired',
          'Device is not paired.',
          403
        )
      }

      return {
        owner_id: ownerId,
        device_id: 'device-1',
        auth_session_id: 'session-1',
        authenticated_at: input.authenticatedAt.toISOString(),
        trust_level: 'paired',
        permissions: ['system.status.read'],
        privacy_zones: ['private']
      }
    }
  }
}

function health(ownerId = 'owner-1'): TraceMaintenanceHealth {
  return {
    ownerId,
    observedAt: '2026-07-10T20:30:00.000Z',
    chain: {
      valid: true,
      recordCount: 2,
      issue: null
    },
    traceCount: 2,
    purgeReceiptCount: 1,
    migrationVersions: [1]
  }
}

describe('authenticated trace health route', () => {
  it('returns non-destructive owner trace health', async () => {
    const fastify = Fastify()
    await fastify.register(
      createTraceHealthRoute(identityResolver(), {
        getHealth: async () => health()
      }),
      { apiVersion: 'v1' }
    )

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/trace-health?device_id=device-1',
      headers: {
        'x-api-key': 'test-key'
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      success: true,
      health: health()
    })
    await fastify.close()
  })

  it('rejects an unpaired device before reading health', async () => {
    const fastify = Fastify()
    let healthReads = 0
    await fastify.register(
      createTraceHealthRoute(identityResolver(), {
        getHealth: async () => {
          healthReads += 1
          return health()
        }
      }),
      { apiVersion: 'v1' }
    )

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/trace-health?device_id=attacker',
      headers: {
        'x-api-key': 'test-key'
      }
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      success: false,
      code: 'identity.device_not_paired'
    })
    expect(healthReads).toBe(0)
    await fastify.close()
  })

  it('prevents cross-owner health disclosure', async () => {
    const fastify = Fastify()
    await fastify.register(
      createTraceHealthRoute(identityResolver('owner-1'), {
        getHealth: async () => health('owner-2')
      }),
      { apiVersion: 'v1' }
    )

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/greenfield/trace-health?device_id=device-1',
      headers: {
        'x-api-key': 'test-key'
      }
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      success: false,
      code: 'trace.health_owner_mismatch'
    })
    await fastify.close()
  })
})
