import { createHash, randomUUID } from 'node:crypto'

import type { IdentityContext } from '@/core/greenfield/contracts'
import type { IdentityResolver } from '@/core/greenfield/runtime'

import type {
  HarnessAdapterExecutionInput,
  HarnessApprovalCheckpoint,
  HarnessCancelRequest,
  HarnessCapabilityAdapter,
  HarnessCard,
  HarnessCardRequest,
  HarnessDecisionRequest,
  HarnessEvent,
  HarnessEventType,
  HarnessFinalStepResult,
  HarnessGuardrail,
  HarnessGuardrailContext,
  HarnessHookContext,
  HarnessHookStage,
  HarnessPreparedContext,
  HarnessReadRequest,
  HarnessStartRequest,
  HarnessStepResult,
  HarnessTask,
  HarnessTaskState,
  HarnessTaskView
} from './contracts'
import { HarnessGuardrailError } from './guardrails'
import { HarnessHookBus } from './hooks'
import { HarnessCapabilityRegistry, HarnessRegistryError } from './registry'
import type { HarnessEventAppend, HarnessTaskStore } from './store'

const TERMINAL_STATES = new Set<HarnessTaskState>([
  'completed',
  'failed',
  'canceled',
  'rejected'
])

const STATE_TRANSITIONS: Record<HarnessTaskState, HarnessTaskState[]> = {
  queued: ['working', 'failed', 'canceled', 'rejected'],
  working: [
    'approval_required',
    'input_required',
    'completed',
    'failed',
    'canceled',
    'rejected'
  ],
  input_required: ['working', 'failed', 'canceled', 'rejected'],
  approval_required: ['working', 'failed', 'canceled', 'rejected'],
  completed: [],
  failed: [],
  canceled: [],
  rejected: []
}

interface ExecutionState {
  input: string
  metadata: Record<string, unknown>
  context: HarnessPreparedContext | null
}

export interface HarnessKernelDependencies {
  identityResolver: IdentityResolver
  registry: HarnessCapabilityRegistry
  store: HarnessTaskStore
  hooks: HarnessHookBus
  guardrails: HarnessGuardrail[]
  now?: () => Date
  createId?: () => string
  maxSteps?: number
  executionTimeoutMs?: number
}

export class HarnessKernelError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'HarnessKernelError'
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    )
  }
  return value
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function inputHash(request: HarnessStartRequest): string {
  return sha256(
    JSON.stringify(
      canonicalize({
        capability_id: request.capability_id,
        context_id: request.context_id,
        input: request.input.normalize('NFKC').trim(),
        metadata: request.metadata || {}
      })
    )
  )
}

function messageText(task: HarnessTask): string {
  const ownerMessage = task.messages.find((message) => message.role === 'owner')
  const textPart = ownerMessage?.parts.find((part) => part.type === 'text')
  return textPart?.text || ''
}

function isTerminal(state: HarnessTaskState): boolean {
  return TERMINAL_STATES.has(state)
}

function createEmptyContext(): HarnessPreparedContext {
  return {
    context_ref: 'context://pending',
    values: {},
    evidence_refs: [],
    memory_refs: [],
    limitations: []
  }
}

export class MiraHarnessKernel {
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly maxSteps: number
  private readonly executionTimeoutMs: number
  private readonly executionStates = new Map<string, ExecutionState>()
  private readonly controllers = new Map<string, AbortController>()

  public constructor(private readonly dependencies: HarnessKernelDependencies) {
    this.now = dependencies.now || ((): Date => new Date())
    this.createId = dependencies.createId || randomUUID
    this.maxSteps = dependencies.maxSteps || 12
    this.executionTimeoutMs = dependencies.executionTimeoutMs || 120_000
  }

  public async getCard(request: HarnessCardRequest): Promise<HarnessCard> {
    const identity = await this.resolveIdentity(
      request.device_id,
      request.credential
    )
    return this.dependencies.registry.createCard(
      identity.permissions,
      identity.privacy_zones
    )
  }

  public async start(request: HarnessStartRequest): Promise<HarnessTaskView> {
    const identity = await this.resolveIdentity(
      request.device_id,
      request.credential
    )
    const adapter = this.getAdapter(request.capability_id)
    const requestHash = inputHash(request)
    const existing = this.dependencies.store.findByIdempotency(
      identity.owner_id,
      request.idempotency_key
    )

    if (existing) {
      if (
        existing.input_hash !== requestHash ||
        existing.capability_id !== request.capability_id ||
        existing.context_id !== request.context_id
      ) {
        throw new HarnessKernelError(
          'harness.idempotency_conflict',
          'The idempotency key is already bound to different task input.',
          409
        )
      }
      this.assertTaskAccess(existing, identity)
      const view = this.dependencies.store.readView(existing.task_id)
      if (!view) {
        throw new HarnessKernelError(
          'harness.task_not_found',
          'The idempotent harness task could not be read.',
          404
        )
      }
      return view
    }

    const createdAt = this.now().toISOString()
    const taskId = this.createId()
    const task: HarnessTask = {
      task_id: taskId,
      context_id: request.context_id,
      owner_id: identity.owner_id,
      device_id: identity.device_id,
      auth_session_id: identity.auth_session_id,
      idempotency_key: request.idempotency_key,
      capability_id: adapter.manifest.capability_id,
      active_capability_id: adapter.manifest.capability_id,
      state: 'queued',
      input_hash: requestHash,
      messages: [
        {
          message_id: this.createId(),
          role: 'owner',
          parts: [{ type: 'text', text: request.input.normalize('NFKC').trim() }],
          created_at: createdAt,
          capability_id: adapter.manifest.capability_id
        }
      ],
      artifacts: [],
      approval: null,
      error: null,
      trace_id: taskId,
      created_at: createdAt,
      updated_at: createdAt,
      completed_at: null,
      step_count: 0,
      max_steps: this.maxSteps
    }

    this.dependencies.store.create(task)
    this.executionStates.set(task.task_id, {
      input: request.input.normalize('NFKC').trim(),
      metadata: structuredClone(request.metadata || {}),
      context: null
    })
    this.emit(task, 'task.created', 'Task accepted by the Mira harness.', {
      input_hash: requestHash,
      requested_capability_id: request.capability_id
    })

    queueMicrotask(() => {
      void this.run(task.task_id, identity).catch(() => undefined)
    })

    const view = this.dependencies.store.readView(task.task_id)
    if (!view) {
      throw new HarnessKernelError(
        'harness.task_not_found',
        'The newly created harness task could not be read.',
        500
      )
    }
    return view
  }

  public async read(request: HarnessReadRequest): Promise<HarnessTaskView> {
    const identity = await this.resolveIdentity(
      request.device_id,
      request.credential
    )
    const task = this.readTask(request.task_id)
    this.assertTaskAccess(task, identity)
    const view = this.dependencies.store.readView(
      task.task_id,
      request.after_sequence || 0
    )
    if (!view) {
      throw new HarnessKernelError(
        'harness.task_not_found',
        'The harness task was not found.',
        404
      )
    }
    return view
  }

  public async cancel(request: HarnessCancelRequest): Promise<HarnessTaskView> {
    const identity = await this.resolveIdentity(
      request.device_id,
      request.credential
    )
    let task = this.readTask(request.task_id)
    this.assertTaskAccess(task, identity)
    const manifest = this.getAdapter(task.active_capability_id).manifest

    if (isTerminal(task.state)) {
      return this.requireView(task.task_id)
    }
    if (!manifest.supports_cancellation) {
      throw new HarnessKernelError(
        'harness.cancellation_not_supported',
        'The active capability does not support cancellation.',
        409
      )
    }

    this.controllers.get(task.task_id)?.abort(
      new Error(request.reason || 'Canceled by the authenticated owner.')
    )
    task = this.transition(task, 'canceled')
    task.error = {
      code: 'harness.canceled_by_owner',
      message: request.reason || 'The task was canceled by the authenticated owner.',
      retryable: false,
      details: null
    }
    task.completed_at = this.now().toISOString()
    task = this.save(task)
    this.emit(task, 'task.canceled', 'The owner canceled the harness task.', {
      reason_provided: Boolean(request.reason)
    })
    this.cleanup(task.task_id)
    return this.requireView(task.task_id)
  }

  public async decide(
    request: HarnessDecisionRequest
  ): Promise<HarnessTaskView> {
    const identity = await this.resolveIdentity(
      request.device_id,
      request.credential
    )
    let task = this.readTask(request.task_id)
    this.assertTaskAccess(task, identity)

    if (task.state !== 'approval_required' || !task.approval) {
      throw new HarnessKernelError(
        'harness.approval_not_pending',
        'The harness task is not waiting for an approval decision.',
        409
      )
    }
    if (task.approval.approval_id !== request.approval_id) {
      throw new HarnessKernelError(
        'harness.approval_mismatch',
        'The approval identifier does not match the pending checkpoint.',
        409
      )
    }
    if (Date.parse(task.approval.expires_at) <= this.now().getTime()) {
      task = this.failTask(
        task,
        'harness.approval_expired',
        'The approval checkpoint expired before a decision was recorded.',
        false,
        null
      )
      return this.requireView(task.task_id)
    }

    this.emit(task, 'approval.decided', 'The owner recorded an approval decision.', {
      approval_id: request.approval_id,
      decision: request.decision
    })

    if (request.decision === 'rejected') {
      task = this.transition(task, 'rejected')
      task.error = {
        code: 'harness.approval_rejected',
        message: 'The authenticated owner rejected the pending operation.',
        retryable: false,
        details: { approval_id: request.approval_id }
      }
      task.completed_at = this.now().toISOString()
      task = this.save(task)
      this.cleanup(task.task_id)
      return this.requireView(task.task_id)
    }

    const approval = structuredClone(task.approval)
    task = this.transition(task, 'working')
    task = this.save(task)
    this.emit(task, 'task.status_changed', 'The approved task resumed.', {
      previous_state: 'approval_required',
      approval_id: approval.approval_id
    })
    queueMicrotask(() => {
      void this.run(task.task_id, identity, approval).catch(() => undefined)
    })
    return this.requireView(task.task_id)
  }

  public async waitForTerminal(
    taskId: string,
    timeoutMs = 5_000
  ): Promise<HarnessTaskView> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const view = this.dependencies.store.readView(taskId)
      if (view && isTerminal(view.task.state)) {
        return view
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new HarnessKernelError(
      'harness.wait_timeout',
      'The harness task did not reach a terminal state before the wait timeout.',
      504
    )
  }

  private async run(
    taskId: string,
    identity: IdentityContext,
    approval: HarnessApprovalCheckpoint | null = null
  ): Promise<void> {
    let task = this.readTask(taskId)
    if (isTerminal(task.state)) {
      return
    }
    if (task.state !== 'working') {
      task = this.transition(task, 'working')
      task = this.save(task)
      this.emit(task, 'task.status_changed', 'Harness execution started.', {
        previous_state: 'queued'
      })
    }

    const controller = this.controllers.get(taskId) || new AbortController()
    this.controllers.set(taskId, controller)

    try {
      while (true) {
        task = this.readTask(taskId)
        if (controller.signal.aborted || task.state === 'canceled') {
          return
        }
        if (task.step_count >= task.max_steps) {
          throw new HarnessKernelError(
            'harness.step_limit_exceeded',
            'The task exceeded the deterministic handoff and execution-step limit.',
            422,
            { max_steps: task.max_steps }
          )
        }

        const execution = this.executionStates.get(taskId) || {
          input: messageText(task),
          metadata: {},
          context: null
        }
        this.executionStates.set(taskId, execution)
        const adapter = this.getAdapter(task.active_capability_id)
        const manifest = adapter.manifest
        const activeRequest: HarnessStartRequest = {
          device_id: task.device_id,
          credential: '',
          context_id: task.context_id,
          idempotency_key: task.idempotency_key,
          capability_id: manifest.capability_id,
          input: execution.input,
          metadata: execution.metadata
        }

        await this.runGuardrails('input', task, identity, manifest, activeRequest)
        await this.runHooks('before_classification', task, identity, manifest, null)
        this.emit(task, 'capability.selected', 'The harness selected a capability adapter.', {
          execution_kind: manifest.execution_kind,
          provider: manifest.provider,
          model: manifest.model || 'none'
        })
        await this.runHooks('after_classification', task, identity, manifest, null)

        await this.runHooks('before_context_assembly', task, identity, manifest, null)
        const context = await adapter.prepareContext({
          task,
          identity,
          input: execution.input,
          metadata: execution.metadata,
          context: execution.context || createEmptyContext(),
          signal: controller.signal
        })
        execution.context = structuredClone(context)
        this.executionStates.set(taskId, execution)
        this.emit(task, 'context.assembled', 'Capability context was assembled.', {
          context_ref: context.context_ref,
          evidence_count: context.evidence_refs.length,
          memory_count: context.memory_refs.length,
          limitation_count: context.limitations.length
        })
        await this.runHooks(
          'after_context_assembly',
          task,
          identity,
          manifest,
          context.context_ref
        )

        if (manifest.confirmation === 'always' && !approval) {
          task = this.requireApproval(task, manifest.capability_id, {
            summary: `Approve ${manifest.name}`,
            risk: manifest.risk === 'low' ? 'medium' : manifest.risk,
            expires_at: new Date(this.now().getTime() + 300_000).toISOString(),
            required_permissions: [...manifest.required_permissions],
            scope: { context_ref: context.context_ref },
            verification_criteria: [
              'The adapter result must pass deterministic output guardrails.',
              'Any action receipt must be independently verified.'
            ],
            rollback_limitations: [
              'Rollback support depends on the selected capability adapter.'
            ]
          })
          return
        }

        const hookStages = this.executionHookStages(manifest.execution_kind)
        if (hookStages.before) {
          await this.runHooks(
            hookStages.before,
            task,
            identity,
            manifest,
            context.context_ref
          )
        }

        this.emit(task, 'adapter.started', 'Capability adapter execution started.', {
          execution_kind: manifest.execution_kind,
          step: task.step_count + 1
        })
        const timeoutController = new AbortController()
        const timeout = setTimeout(() => {
          timeoutController.abort(new Error('Harness adapter execution timed out.'))
        }, this.executionTimeoutMs)
        timeout.unref?.()
        const signal = AbortSignal.any([
          controller.signal,
          timeoutController.signal
        ])
        const adapterInput: HarnessAdapterExecutionInput = {
          task,
          identity,
          input: execution.input,
          metadata: execution.metadata,
          context,
          signal
        }
        let result: HarnessStepResult
        try {
          result =
            approval && adapter.resume
              ? await adapter.resume({ ...adapterInput, approval })
              : await adapter.execute(adapterInput)
        } finally {
          clearTimeout(timeout)
        }
        approval = null
        this.emit(task, 'adapter.completed', 'Capability adapter execution completed.', {
          result_type: result.type,
          step: task.step_count + 1
        })

        if (hookStages.after) {
          await this.runHooks(
            hookStages.after,
            task,
            identity,
            manifest,
            context.context_ref
          )
        }

        task = this.readTask(taskId)
        task.step_count += 1
        task = this.save(task)

        if (result.type === 'handoff') {
          if (!manifest.supports_handoffs) {
            throw new HarnessKernelError(
              'harness.handoff_not_supported',
              'The active capability attempted a handoff without declaring support.',
              500
            )
          }
          this.getAdapter(result.capability_id)
          task.active_capability_id = result.capability_id
          task = this.save(task)
          execution.input = result.input.normalize('NFKC').trim()
          execution.metadata = structuredClone(result.metadata || {})
          execution.context = null
          this.executionStates.set(taskId, execution)
          this.emit(task, 'handoff.requested', 'Execution handed off to another capability.', {
            from_capability_id: manifest.capability_id,
            to_capability_id: result.capability_id,
            reason: result.reason
          })
          continue
        }

        if (result.type === 'approval_required') {
          if (manifest.confirmation === 'never') {
            throw new HarnessKernelError(
              'harness.unexpected_approval_request',
              'The adapter requested approval despite declaring that approval is never required.',
              500
            )
          }
          this.requireApproval(task, manifest.capability_id, result.checkpoint)
          return
        }

        await this.runGuardrails(
          'output',
          task,
          identity,
          manifest,
          activeRequest,
          result
        )
        this.completeTask(task, manifest.capability_id, result)
        return
      }
    } catch (error) {
      task = this.readTask(taskId)
      if (task.state === 'canceled' || controller.signal.aborted) {
        return
      }
      if (error instanceof HarnessGuardrailError) {
        this.rejectTask(task, error.code, error.message, error.details)
        return
      }
      if (error instanceof HarnessKernelError) {
        this.failTask(task, error.code, error.message, false, error.details)
        return
      }
      if (error instanceof HarnessRegistryError) {
        this.failTask(task, error.code, error.message, false, error.details)
        return
      }
      this.failTask(
        task,
        'harness.unexpected_failure',
        'The harness task failed unexpectedly.',
        false,
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private async runGuardrails(
    stage: 'input' | 'output',
    task: HarnessTask,
    identity: IdentityContext,
    manifest: HarnessCapabilityAdapter['manifest'],
    request: HarnessStartRequest,
    result?: HarnessFinalStepResult
  ): Promise<void> {
    const guardrails = this.dependencies.guardrails
      .filter((guardrail) => guardrail.stage === stage)
      .sort(
        (left, right) =>
          left.priority - right.priority ||
          left.guardrail_id.localeCompare(right.guardrail_id)
      )

    for (const guardrail of guardrails) {
      this.emit(task, 'guardrail.started', 'A deterministic guardrail started.', {
        guardrail_id: guardrail.guardrail_id,
        stage
      })
      const context: HarnessGuardrailContext = {
        request,
        identity,
        manifest
      }
      const guardrailResult = await guardrail.evaluate(
        stage === 'output' && result
          ? { task, identity, manifest, result }
          : context
      )
      this.emit(task, 'guardrail.completed', 'A deterministic guardrail completed.', {
        guardrail_id: guardrail.guardrail_id,
        stage,
        allowed: guardrailResult.allowed,
        code: guardrailResult.code
      })
      if (!guardrailResult.allowed) {
        throw new HarnessGuardrailError(
          guardrailResult.code,
          guardrailResult.message,
          guardrailResult.details || null
        )
      }
    }
  }

  private async runHooks(
    stage: HarnessHookStage,
    task: HarnessTask,
    identity: IdentityContext,
    manifest: HarnessCapabilityAdapter['manifest'],
    contextRef: string | null
  ): Promise<void> {
    const hookContext: HarnessHookContext = {
      task,
      identity,
      manifest,
      input_ref: `sha256:${task.input_hash}`,
      context_ref: contextRef,
      metadata: {}
    }
    this.emit(task, 'hook.started', 'A harness lifecycle hook stage started.', {
      stage
    })
    const executed = await this.dependencies.hooks.run(stage, hookContext)
    this.emit(task, 'hook.completed', 'A harness lifecycle hook stage completed.', {
      stage,
      executed_hook_ids: executed
    })
  }

  private requireApproval(
    task: HarnessTask,
    capabilityId: string,
    checkpoint: Omit<
      HarnessApprovalCheckpoint,
      'approval_id' | 'capability_id' | 'requested_at'
    >
  ): HarnessTask {
    let next = this.transition(task, 'approval_required')
    const approval: HarnessApprovalCheckpoint = {
      ...structuredClone(checkpoint),
      approval_id: this.createId(),
      capability_id: capabilityId,
      requested_at: this.now().toISOString()
    }
    next.approval = approval
    next = this.save(next)
    this.emit(next, 'approval.requested', 'The task requires an owner decision.', {
      approval_id: approval.approval_id,
      risk: approval.risk,
      expires_at: approval.expires_at,
      required_permissions: approval.required_permissions
    })
    return next
  }

  private completeTask(
    task: HarnessTask,
    capabilityId: string,
    result: HarnessFinalStepResult
  ): HarnessTask {
    const completedAt = this.now().toISOString()
    let next = this.transition(task, 'completed')
    next.messages.push({
      message_id: this.createId(),
      role: 'assistant',
      parts: structuredClone(result.message),
      created_at: completedAt,
      capability_id: capabilityId
    })
    for (const artifact of result.artifacts) {
      const storedArtifact = {
        ...structuredClone(artifact),
        artifact_id: this.createId(),
        created_at: completedAt,
        capability_id: capabilityId
      }
      next.artifacts.push(storedArtifact)
      this.emit(next, 'artifact.created', 'A harness artifact was created.', {
        artifact_id: storedArtifact.artifact_id,
        kind: storedArtifact.kind,
        media_type: storedArtifact.media_type
      })
    }
    next.trace_id = result.trace_id || next.trace_id
    next.approval = null
    next.completed_at = completedAt
    next = this.save(next)
    this.emit(next, 'task.completed', 'The harness task completed successfully.', {
      artifact_count: next.artifacts.length,
      message_count: next.messages.length,
      limitation_count: result.limitations?.length || 0
    })
    this.cleanup(next.task_id)
    return next
  }

  private rejectTask(
    task: HarnessTask,
    code: string,
    message: string,
    details: unknown
  ): HarnessTask {
    let next = this.transition(task, 'rejected')
    next.error = { code, message, retryable: false, details }
    next.completed_at = this.now().toISOString()
    next = this.save(next)
    this.emit(next, 'task.failed', 'A deterministic guardrail rejected the task.', {
      code,
      rejected: true
    })
    this.cleanup(next.task_id)
    return next
  }

  private failTask(
    task: HarnessTask,
    code: string,
    message: string,
    retryable: boolean,
    details: unknown
  ): HarnessTask {
    if (isTerminal(task.state)) {
      return task
    }
    let next = this.transition(task, 'failed')
    next.error = { code, message, retryable, details }
    next.completed_at = this.now().toISOString()
    next = this.save(next)
    this.emit(next, 'task.failed', 'The harness task failed.', {
      code,
      retryable
    })
    this.cleanup(next.task_id)
    return next
  }

  private transition(task: HarnessTask, state: HarnessTaskState): HarnessTask {
    if (task.state === state) {
      return structuredClone(task)
    }
    if (!STATE_TRANSITIONS[task.state].includes(state)) {
      throw new HarnessKernelError(
        'harness.state_transition_invalid',
        `Harness task cannot transition from ${task.state} to ${state}.`,
        500
      )
    }
    const next = structuredClone(task)
    next.state = state
    next.updated_at = this.now().toISOString()
    return next
  }

  private save(task: HarnessTask): HarnessTask {
    task.updated_at = this.now().toISOString()
    return this.dependencies.store.replace(task)
  }

  private emit(
    task: HarnessTask,
    type: HarnessEventType,
    message: string,
    data: Record<string, unknown>,
    phase: string | null = null
  ): HarnessEvent {
    const event: HarnessEventAppend = {
      event_id: this.createId(),
      task_id: task.task_id,
      context_id: task.context_id,
      type,
      occurred_at: this.now().toISOString(),
      state: task.state,
      capability_id: task.active_capability_id,
      phase,
      message,
      data: structuredClone(data),
      otel: {
        trace_id: task.trace_id,
        span_name: `mira.harness.${type}`,
        attributes: {
          'gen_ai.operation.name': type,
          'gen_ai.agent.name': 'mira-owner-harness',
          'mira.harness.task.id': task.task_id,
          'mira.harness.context.id': task.context_id,
          'mira.harness.capability.id': task.active_capability_id,
          'mira.harness.task.state': task.state
        }
      }
    }
    return this.dependencies.store.appendEvent(event)
  }

  private executionHookStages(executionKind: string): {
    before: HarnessHookStage | null
    after: HarnessHookStage | null
  } {
    if (executionKind === 'model' || executionKind === 'agent') {
      return { before: 'before_model_call', after: 'after_model_call' }
    }
    if (executionKind === 'action') {
      return { before: 'before_action', after: 'after_action' }
    }
    return { before: null, after: null }
  }

  private getAdapter(capabilityId: string): HarnessCapabilityAdapter {
    try {
      return this.dependencies.registry.get(capabilityId)
    } catch (error) {
      if (error instanceof HarnessRegistryError) {
        throw new HarnessKernelError(error.code, error.message, 404, error.details)
      }
      throw error
    }
  }

  private readTask(taskId: string): HarnessTask {
    const task = this.dependencies.store.read(taskId)
    if (!task) {
      throw new HarnessKernelError(
        'harness.task_not_found',
        'The harness task was not found.',
        404
      )
    }
    return task
  }

  private requireView(taskId: string): HarnessTaskView {
    const view = this.dependencies.store.readView(taskId)
    if (!view) {
      throw new HarnessKernelError(
        'harness.task_not_found',
        'The harness task was not found.',
        404
      )
    }
    return view
  }

  private async resolveIdentity(
    deviceId: string,
    credential: string
  ): Promise<IdentityContext> {
    return this.dependencies.identityResolver.resolve({
      deviceId,
      credential,
      authenticatedAt: this.now()
    })
  }

  private assertTaskAccess(task: HarnessTask, identity: IdentityContext): void {
    if (
      task.owner_id !== identity.owner_id ||
      task.device_id !== identity.device_id ||
      task.auth_session_id !== identity.auth_session_id
    ) {
      throw new HarnessKernelError(
        'harness.task_access_denied',
        'The task does not belong to this authenticated owner session.',
        403
      )
    }
  }

  private cleanup(taskId: string): void {
    this.controllers.delete(taskId)
    this.executionStates.delete(taskId)
  }
}
