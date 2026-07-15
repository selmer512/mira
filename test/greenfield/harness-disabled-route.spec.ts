import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import type { IdentityResolver } from '@/core/greenfield/runtime'
import {
  HarnessCapabilityRegistry,
  HarnessHookBus,
  InMemoryHarnessTaskStore,
  MiraHarnessKernel,
  createDefaultHarnessGuardrails
} from '@/core/harness'
import { createHarnessRoute } from '@/core/http-server/api/greenfield/harness'

const identityResolver: IdentityResolver = {
  resolve: async (input) => ({
    owner_id: 'owner-disabled',
    device_id: input.deviceId,
    auth_session_id: 'session-disabled',
    authenticated_at: input.authenticatedAt.toISOString(),
    trust_level: 'owner_admin',
    permissions: ['system.status.read'],
    privacy_zones: ['private']
  })
}

describe('disabled owner harness route', () => {
  it('returns 503 before identity or transient task execution', async () => {
    const kernel = new MiraHarnessKernel({
      identityResolver,
      registry: new HarnessCapabilityRegistry(),
      store: new InMemoryHarnessTaskStore(),
      hooks: new HarnessHookBus(),
      guardrails: createDefaultHarnessGuardrails()
    })
    const fastify = Fastify()
    await fastify.register(createHarnessRoute(kernel, false), {
      apiVersion: 'v1'
    })
    await fastify.ready()

    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/harness/card?device_id=paired-device',
      headers: { 'x-api-key': 'not-inspected' }
    })

    expect(response.statusCode).toBe(503)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({
      success: false,
      code: 'harness.disabled'
    })

    await fastify.close()
  })
})
