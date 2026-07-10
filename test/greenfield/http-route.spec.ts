import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import {
  CapabilityLocalCognitionProvider,
  EnvironmentIdentityResolver,
  GreenfieldRequestOrchestrator,
  SYSTEM_STATUS_CAPABILITY,
  SystemStatusEvidenceProvider,
  SystemStatusResponseComposer,
  type RuntimeStatusReader,
  type RuntimeStatusSnapshot
} from '@/core/greenfield'
import { createPostGreenfieldRequest } from '@/core/http-server/api/greenfield/post'

class TestStatusReader implements RuntimeStatusReader {
  public async read(observedAt: Date): Promise<RuntimeStatusSnapshot> {
    return {
      status: 'online',
      observed_at: observedAt.toISOString(),
      uptime_seconds: 12,
      version: 'test',
      routing_mode: 'smart',
      llm_provider_ready: true,
      local_model: 'test-local-model',
      limitations: []
    }
  }
}

function createRuntime(): GreenfieldRequestOrchestrator {
  return new GreenfieldRequestOrchestrator({
    identityResolver: EnvironmentIdentityResolver.fromProcessEnv({
      MIRA_GREENFIELD_ENABLED: 'true',
      MIRA_GREENFIELD_OWNER_ID: 'owner-1',
      MIRA_GREENFIELD_PAIRED_DEVICE_ID: 'device-1',
      MIRA_GREENFIELD_PERMISSIONS: SYSTEM_STATUS_CAPABILITY,
      MIRA_GREENFIELD_PRIVACY_ZONES: 'private'
    }),
    localCognitionProvider: new CapabilityLocalCognitionProvider(),
    evidenceProvider: new SystemStatusEvidenceProvider(new TestStatusReader()),
    responseComposer: new SystemStatusResponseComposer()
  })
}

describe('greenfield HTTP route', () => {
  it('returns a traced response from the mounted plugin', async () => {
    const fastify = Fastify()
    await fastify.register(createPostGreenfieldRequest(createRuntime()), {
      apiVersion: 'v1'
    })

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/request',
      headers: {
        'x-api-key': 'test-api-key'
      },
      payload: {
        device_id: 'device-1',
        capability: SYSTEM_STATUS_CAPABILITY,
        input: 'Report the current Mira system status.'
      }
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.success).toBe(true)
    expect(body.envelope.origin.trace_id).toBeTruthy()
    expect(body.envelope.response.evidence_refs).toHaveLength(1)

    await fastify.close()
  })

  it('does not accept client-supplied trust fields', async () => {
    const fastify = Fastify()
    await fastify.register(createPostGreenfieldRequest(createRuntime()), {
      apiVersion: 'v1'
    })

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/request',
      headers: {
        'x-api-key': 'test-api-key'
      },
      payload: {
        device_id: 'device-1',
        capability: SYSTEM_STATUS_CAPABILITY,
        input: 'Report the current Mira system status.',
        trust_level: 'owner_admin'
      }
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.success).toBe(true)
    expect(body.envelope.identity.trust_level).toBe('paired')
    expect(body.envelope.identity.trust_level).not.toBe('owner_admin')

    await fastify.close()
  })
})
