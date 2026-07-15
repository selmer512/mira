import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { IdentityContext } from '@/core/greenfield/contracts'
import {
  GreenfieldExecutionError,
  type IdentityResolveInput,
  type IdentityResolver
} from '@/core/greenfield/runtime'
import {
  HarnessCapabilityRegistry,
  HarnessHookBus,
  InMemoryHarnessTaskStore,
  MiraHarnessKernel,
  createDefaultHarnessGuardrails,
  type HarnessAdapterExecutionInput,
  type HarnessCapabilityAdapter,
  type HarnessPreparedContext,
  type HarnessStepResult
} from '@/core/harness'
import { createHarnessRoute } from '@/core/http-server/api/greenfield/harness'

class RouteIdentityResolver implements IdentityResolver {
  public async resolve(input: IdentityResolveInput): Promise<IdentityContext> {
    if (input.credential !== 'route-secret') {
      throw new GreenfieldExecutionError(
        'identity.credential_invalid',
        'Invalid credential.',
        401
      )
    }
    if (input.deviceId !== 'paired-device') {
      throw new GreenfieldExecutionError(
        'identity.device_not_paired',
        'Invalid device.',
        403
      )
    }
    return {
      owner_id: 'owner-route',
      device_id: 'paired-device',
      auth_session_id: 'session-route',
      authenticated_at: input.authenticatedAt.toISOString(),
      trust_level: 'owner_admin',
      permissions: ['route.answer', 'route.slow'],
      privacy_zones: ['private']
    }
  }
}

class RouteAnswerAdapter implements HarnessCapabilityAdapter {
  public readonly manifest = {
    capability_id: 'route.answer',
    name: 'Route answer',
    description: 'Deterministic route adapter.',
    version: '1',
    execution_kind: 'deterministic' as const,
    required_permissions: ['route.answer'],
    allowed_privacy_zones: ['private'],
    risk: 'low' as const,
    confirmation: 'never' as const,
    supports_streaming: true,
    supports_cancellation: true,
    supports_handoffs: false,
    input_schema_ref: 'schema://route/answer/input',
    output_schema_ref: 'schema://route/answer/output',
    provider: 'test',
    model: null,
    tags: ['test']
  }

  public async prepareContext(
    input: HarnessAdapterExecutionInput
  ): Promise<HarnessPreparedContext> {
    return {
      context_ref: `context://route/${input.task.task_id}`,
      values: {},
      evidence_refs: [],
      memory_refs: [],
      limitations: []
    }
  }

  public async execute(
    input: HarnessAdapterExecutionInput
  ): Promise<HarnessStepResult> {
    return {
      type: 'final',
      message: [{ type: 'text', text: `route:${input.input}` }],
      artifacts: [],
      trace_id: input.task.task_id
    }
  }
}

class RouteSlowAdapter extends RouteAnswerAdapter {
  public readonly manifest = {
    ...super.manifest,
    capability_id: 'route.slow',
    name: 'Route slow',
    required_permissions: ['route.slow']
  }

  public async execute(
    input: HarnessAdapterExecutionInput
  ): Promise<HarnessStepResult> {
    await new Promise<never>((_resolve, reject) => {
      input.signal.addEventListener('abort', () => reject(input.signal.reason), {
        once: true
      })
    })
    throw new Error('unreachable')
  }
}

function createKernel(): MiraHarnessKernel {
  const registry = new HarnessCapabilityRegistry()
  registry.register(new RouteAnswerAdapter())
  registry.register(new RouteSlowAdapter())
  return new MiraHarnessKernel({
    identityResolver: new RouteIdentityResolver(),
    registry,
    store: new InMemoryHarnessTaskStore(),
    hooks: new HarnessHookBus(),
    guardrails: createDefaultHarnessGuardrails()
  })
}

describe('harness HTTP routes', () => {
  const fastify = Fastify()

  beforeEach(async () => {
    await fastify.register(createHarnessRoute(createKernel()), {
      apiVersion: 'v1'
    })
    await fastify.ready()
  })

  afterEach(async () => {
    await fastify.close()
  })

  it('returns an owner-scoped capability card with no-store semantics', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/v1/harness/card?device_id=paired-device',
      headers: { 'x-api-key': 'route-secret' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    const body = response.json()
    expect(body.success).toBe(true)
    expect(body.card.capabilities.map((item: { capability_id: string }) => item.capability_id)).toEqual([
      'route.answer',
      'route.slow'
    ])
  })

  it('creates a task and exposes incremental ordered events', async () => {
    const createdResponse = await fastify.inject({
      method: 'POST',
      url: '/api/v1/harness/tasks',
      headers: {
        'x-api-key': 'route-secret',
        'content-type': 'application/json'
      },
      payload: {
        device_id: 'paired-device',
        context_id: 'context-route',
        idempotency_key: 'route-idempotency',
        capability_id: 'route.answer',
        input: 'hello'
      }
    })

    expect(createdResponse.statusCode).toBe(202)
    expect(createdResponse.headers['cache-control']).toBe('no-store')
    const created = createdResponse.json()
    expect(created.task.state).toMatch(/queued|working|completed/)

    let view = created
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await fastify.inject({
        method: 'GET',
        url: `/api/v1/harness/tasks/${created.task.task_id}?device_id=paired-device`,
        headers: { 'x-api-key': 'route-secret' }
      })
      view = response.json()
      if (view.task.state === 'completed') break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    expect(view.task.state).toBe('completed')
    const after = await fastify.inject({
      method: 'GET',
      url: `/api/v1/harness/tasks/${created.task.task_id}?device_id=paired-device&after_sequence=1`,
      headers: { 'x-api-key': 'route-secret' }
    })
    const afterBody = after.json()
    expect(afterBody.events.every((event: { sequence: number }) => event.sequence > 1)).toBe(
      true
    )
  })

  it('rejects invalid credentials and unpaired devices', async () => {
    const invalidCredential = await fastify.inject({
      method: 'GET',
      url: '/api/v1/harness/card?device_id=paired-device',
      headers: { 'x-api-key': 'wrong' }
    })
    expect(invalidCredential.statusCode).toBe(401)

    const invalidDevice = await fastify.inject({
      method: 'GET',
      url: '/api/v1/harness/card?device_id=other-device',
      headers: { 'x-api-key': 'route-secret' }
    })
    expect(invalidDevice.statusCode).toBe(403)
  })

  it('strips undeclared identity fields instead of trusting client assertions', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/harness/tasks',
      headers: {
        'x-api-key': 'route-secret',
        'content-type': 'application/json'
      },
      payload: {
        device_id: 'paired-device',
        owner_id: 'attacker-owner',
        context_id: 'context-strip',
        idempotency_key: 'strip-idempotency',
        capability_id: 'route.answer',
        input: 'hello'
      }
    })

    expect(response.statusCode).toBe(202)
    expect(response.json().task.owner_id).toBe('owner-route')
  })

  it('cancels a running task through the authenticated route', async () => {
    const created = await fastify.inject({
      method: 'POST',
      url: '/api/v1/harness/tasks',
      headers: {
        'x-api-key': 'route-secret',
        'content-type': 'application/json'
      },
      payload: {
        device_id: 'paired-device',
        context_id: 'context-cancel',
        idempotency_key: 'cancel-idempotency',
        capability_id: 'route.slow',
        input: 'wait'
      }
    })
    const taskId = created.json().task.task_id
    await new Promise((resolve) => setTimeout(resolve, 10))

    const canceled = await fastify.inject({
      method: 'POST',
      url: `/api/v1/harness/tasks/${taskId}/cancel`,
      headers: {
        'x-api-key': 'route-secret',
        'content-type': 'application/json'
      },
      payload: {
        device_id: 'paired-device',
        reason: 'owner canceled'
      }
    })

    expect(canceled.statusCode).toBe(200)
    expect(canceled.json().task.state).toBe('canceled')
  })
})
