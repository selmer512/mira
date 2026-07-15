import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

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
  type HarnessCapabilityManifest,
  type HarnessPreparedContext,
  type HarnessStepResult
} from '@/core/harness'

class TestIdentityResolver implements IdentityResolver {
  public async resolve(input: IdentityResolveInput): Promise<IdentityContext> {
    if (input.credential !== 'owner-secret') {
      throw new GreenfieldExecutionError(
        'identity.credential_invalid',
        'Credential invalid.',
        401
      )
    }
    if (input.deviceId !== 'device-1') {
      throw new GreenfieldExecutionError(
        'identity.device_not_paired',
        'Device invalid.',
        403
      )
    }
    return {
      owner_id: 'owner-1',
      device_id: 'device-1',
      auth_session_id: 'session-1',
      authenticated_at: input.authenticatedAt.toISOString(),
      trust_level: 'owner_admin',
      permissions: ['test.final', 'test.handoff', 'test.approval', 'test.slow'],
      privacy_zones: ['private']
    }
  }
}

function manifest(
  capabilityId: string,
  overrides: Partial<HarnessCapabilityManifest> = {}
): HarnessCapabilityManifest {
  return {
    capability_id: capabilityId,
    name: capabilityId,
    description: `Test capability ${capabilityId}`,
    version: '1',
    execution_kind: 'deterministic',
    required_permissions: [capabilityId],
    allowed_privacy_zones: ['private'],
    risk: 'low',
    confirmation: 'never',
    supports_streaming: true,
    supports_cancellation: true,
    supports_handoffs: false,
    input_schema_ref: `schema://${capabilityId}/input`,
    output_schema_ref: `schema://${capabilityId}/output`,
    provider: 'test',
    model: null,
    tags: ['test'],
    ...overrides
  }
}

abstract class BaseAdapter implements HarnessCapabilityAdapter {
  public abstract readonly manifest: HarnessCapabilityManifest

  public async prepareContext(
    input: HarnessAdapterExecutionInput
  ): Promise<HarnessPreparedContext> {
    return {
      context_ref: `context://test/${input.task.task_id}`,
      values: {},
      evidence_refs: [],
      memory_refs: [],
      limitations: []
    }
  }

  public abstract execute(
    input: HarnessAdapterExecutionInput
  ): Promise<HarnessStepResult>
}

class FinalAdapter extends BaseAdapter {
  public readonly manifest = manifest('test.final')

  public async execute(
    input: HarnessAdapterExecutionInput
  ): Promise<HarnessStepResult> {
    input.signal.throwIfAborted()
    return {
      type: 'final',
      message: [{ type: 'text', text: `completed:${input.input}` }],
      artifacts: [
        {
          name: 'result',
          kind: 'answer',
          media_type: 'text/plain',
          parts: [{ type: 'text', text: input.input }],
          privacy_classification: 'private',
          metadata: {}
        }
      ],
      trace_id: input.task.task_id
    }
  }
}

class HandoffAdapter extends BaseAdapter {
  public readonly manifest = manifest('test.handoff', {
    supports_handoffs: true
  })

  public async execute(
    input: HarnessAdapterExecutionInput
  ): Promise<HarnessStepResult> {
    return {
      type: 'handoff',
      capability_id: 'test.final',
      input: `handoff:${input.input}`,
      reason: 'delegate to final adapter'
    }
  }
}

class LoopAdapter extends BaseAdapter {
  public readonly manifest = manifest('test.handoff', {
    supports_handoffs: true
  })

  public async execute(
    input: HarnessAdapterExecutionInput
  ): Promise<HarnessStepResult> {
    return {
      type: 'handoff',
      capability_id: 'test.handoff',
      input: input.input,
      reason: 'loop for step-limit test'
    }
  }
}

class ApprovalAdapter extends BaseAdapter {
  public readonly manifest = manifest('test.approval', {
    risk: 'high',
    confirmation: 'when_requested'
  })

  public async execute(): Promise<HarnessStepResult> {
    return {
      type: 'approval_required',
      checkpoint: {
        summary: 'Approve test operation',
        risk: 'high',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        required_permissions: ['test.approval'],
        scope: { item_count: 1 },
        verification_criteria: ['result is final'],
        rollback_limitations: ['test only']
      }
    }
  }

  public async resume(
    input: HarnessAdapterExecutionInput
  ): Promise<HarnessStepResult> {
    return {
      type: 'final',
      message: [{ type: 'text', text: 'approved and completed' }],
      artifacts: [],
      trace_id: input.task.task_id
    }
  }
}

class SlowAdapter extends BaseAdapter {
  public readonly manifest = manifest('test.slow')

  public async execute(
    input: HarnessAdapterExecutionInput
  ): Promise<HarnessStepResult> {
    await new Promise<never>((_resolve, reject) => {
      input.signal.addEventListener(
        'abort',
        () => reject(input.signal.reason),
        { once: true }
      )
    })
    throw new Error('unreachable')
  }
}

function createKernel(
  adapters: HarnessCapabilityAdapter[],
  maxSteps = 8
): MiraHarnessKernel {
  const registry = new HarnessCapabilityRegistry()
  for (const adapter of adapters) {
    registry.register(adapter)
  }
  return new MiraHarnessKernel({
    identityResolver: new TestIdentityResolver(),
    registry,
    store: new InMemoryHarnessTaskStore(),
    hooks: new HarnessHookBus(),
    guardrails: createDefaultHarnessGuardrails(),
    maxSteps,
    createId: randomUUID
  })
}

function startRequest(capabilityId: string, input = 'hello') {
  return {
    device_id: 'device-1',
    credential: 'owner-secret',
    context_id: 'context-1',
    idempotency_key: `idempotency-${capabilityId}-${input}`,
    capability_id: capabilityId,
    input,
    metadata: {}
  }
}

describe('MiraHarnessKernel', () => {
  it('completes a capability with ordered lifecycle events and artifacts', async () => {
    const kernel = createKernel([new FinalAdapter()])
    const created = await kernel.start(startRequest('test.final'))
    const terminal = await kernel.waitForTerminal(created.task.task_id)

    expect(terminal.task.state).toBe('completed')
    expect(terminal.task.artifacts).toHaveLength(1)
    expect(terminal.events.map((event) => event.sequence)).toEqual(
      terminal.events.map((_event, index) => index + 1)
    )
    expect(terminal.events[0]?.type).toBe('task.created')
    expect(terminal.events.at(-1)?.type).toBe('task.completed')
    expect(
      terminal.events.every(
        (event) =>
          event.otel.attributes['mira.harness.task.id'] === terminal.task.task_id
      )
    ).toBe(true)
  })

  it('returns the original task for an identical idempotent request', async () => {
    const kernel = createKernel([new FinalAdapter()])
    const request = startRequest('test.final')
    const first = await kernel.start(request)
    const second = await kernel.start(request)

    expect(second.task.task_id).toBe(first.task.task_id)
  })

  it('rejects reuse of an idempotency key with different input', async () => {
    const kernel = createKernel([new FinalAdapter()])
    const request = startRequest('test.final')
    await kernel.start(request)

    await expect(
      kernel.start({ ...request, input: 'different' })
    ).rejects.toMatchObject({ code: 'harness.idempotency_conflict' })
  })

  it('executes a declared bounded handoff', async () => {
    const kernel = createKernel([new HandoffAdapter(), new FinalAdapter()])
    const created = await kernel.start(startRequest('test.handoff'))
    const terminal = await kernel.waitForTerminal(created.task.task_id)

    expect(terminal.task.state).toBe('completed')
    expect(terminal.task.active_capability_id).toBe('test.final')
    expect(terminal.events.some((event) => event.type === 'handoff.requested')).toBe(
      true
    )
  })

  it('fails a handoff loop at the deterministic step limit', async () => {
    const kernel = createKernel([new LoopAdapter()], 2)
    const created = await kernel.start(startRequest('test.handoff'))
    const terminal = await kernel.waitForTerminal(created.task.task_id)

    expect(terminal.task.state).toBe('failed')
    expect(terminal.task.error?.code).toBe('harness.step_limit_exceeded')
  })

  it('pauses for approval and resumes only after the matching owner decision', async () => {
    const kernel = createKernel([new ApprovalAdapter()])
    const created = await kernel.start(startRequest('test.approval'))

    let pending = created
    for (let attempt = 0; attempt < 100; attempt += 1) {
      pending = await kernel.read({
        device_id: 'device-1',
        credential: 'owner-secret',
        task_id: created.task.task_id
      })
      if (pending.task.state === 'approval_required') break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    expect(pending.task.state).toBe('approval_required')
    expect(pending.task.approval).not.toBeNull()
    await kernel.decide({
      device_id: 'device-1',
      credential: 'owner-secret',
      task_id: pending.task.task_id,
      approval_id: pending.task.approval?.approval_id || '',
      decision: 'approved'
    })
    const terminal = await kernel.waitForTerminal(pending.task.task_id)
    expect(terminal.task.state).toBe('completed')
    expect(terminal.events.some((event) => event.type === 'approval.decided')).toBe(
      true
    )
  })

  it('cancels an active capability through AbortSignal', async () => {
    const kernel = createKernel([new SlowAdapter()])
    const created = await kernel.start(startRequest('test.slow'))
    await new Promise((resolve) => setTimeout(resolve, 10))

    const canceled = await kernel.cancel({
      device_id: 'device-1',
      credential: 'owner-secret',
      task_id: created.task.task_id,
      reason: 'owner stopped the task'
    })
    expect(canceled.task.state).toBe('canceled')
    expect(canceled.events.at(-1)?.type).toBe('task.canceled')
  })

  it('rejects a capability when the session lacks its permission', async () => {
    class ForbiddenAdapter extends FinalAdapter {
      public readonly manifest = manifest('test.forbidden')
    }
    const kernel = createKernel([new ForbiddenAdapter()])
    const created = await kernel.start(startRequest('test.forbidden'))
    const terminal = await kernel.waitForTerminal(created.task.task_id)

    expect(terminal.task.state).toBe('rejected')
    expect(terminal.task.error?.code).toBe('harness.permission_denied')
  })

  it('denies task reads from a different authenticated session', async () => {
    const kernel = createKernel([new FinalAdapter()])
    const created = await kernel.start(startRequest('test.final'))

    await expect(
      kernel.read({
        device_id: 'device-1',
        credential: 'different-secret',
        task_id: created.task.task_id
      })
    ).rejects.toMatchObject({ code: 'identity.credential_invalid' })
  })
})
