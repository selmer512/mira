import type { IdentityContext, PrivacyClassification } from '@/core/greenfield/contracts'

export const HARNESS_PROTOCOL_VERSION = '2026-07-15'

export type HarnessTaskState =
  | 'queued'
  | 'working'
  | 'input_required'
  | 'approval_required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected'

export type HarnessExecutionKind =
  | 'deterministic'
  | 'evidence'
  | 'model'
  | 'tool'
  | 'agent'
  | 'workflow'
  | 'action'

export type HarnessEventType =
  | 'task.created'
  | 'task.status_changed'
  | 'guardrail.started'
  | 'guardrail.completed'
  | 'hook.started'
  | 'hook.completed'
  | 'capability.selected'
  | 'context.assembled'
  | 'adapter.started'
  | 'adapter.completed'
  | 'handoff.requested'
  | 'approval.requested'
  | 'approval.decided'
  | 'artifact.created'
  | 'task.completed'
  | 'task.failed'
  | 'task.canceled'

export type HarnessHookStage =
  | 'before_classification'
  | 'after_classification'
  | 'before_context_assembly'
  | 'after_context_assembly'
  | 'before_model_call'
  | 'after_model_call'
  | 'before_action'
  | 'after_action'
  | 'before_verification'
  | 'after_verification'
  | 'before_memory_write'
  | 'after_memory_write'

export interface HarnessCapabilityManifest {
  capability_id: string
  name: string
  description: string
  version: string
  execution_kind: HarnessExecutionKind
  required_permissions: string[]
  allowed_privacy_zones: string[]
  risk: 'low' | 'medium' | 'high' | 'critical'
  confirmation: 'never' | 'when_requested' | 'always'
  supports_streaming: boolean
  supports_cancellation: boolean
  supports_handoffs: boolean
  input_schema_ref: string
  output_schema_ref: string
  provider: string
  model: string | null
  tags: string[]
}

export interface HarnessCard {
  harness_id: string
  name: string
  version: string
  protocol_version: string
  description: string
  capabilities: HarnessCapabilityManifest[]
  features: {
    task_lifecycle: true
    event_stream: true
    idempotency: true
    cancellation: true
    approvals: true
    handoffs: true
    sessions: true
    capability_negotiation: true
  }
  interoperability: {
    mcp_ready_ports: true
    a2a_task_semantics: true
    otel_genai_trace_attributes: true
  }
}

export interface HarnessMessagePart {
  type: 'text' | 'json' | 'reference'
  text?: string
  data?: unknown
  ref?: string
}

export interface HarnessMessage {
  message_id: string
  role: 'owner' | 'assistant' | 'system' | 'tool' | 'agent'
  parts: HarnessMessagePart[]
  created_at: string
  capability_id: string
}

export interface HarnessArtifact {
  artifact_id: string
  name: string
  kind: 'answer' | 'evidence' | 'trace' | 'receipt' | 'data' | 'ui'
  media_type: string
  parts: HarnessMessagePart[]
  created_at: string
  capability_id: string
  privacy_classification: PrivacyClassification
  metadata: Record<string, unknown>
}

export interface HarnessApprovalCheckpoint {
  approval_id: string
  capability_id: string
  summary: string
  risk: 'medium' | 'high' | 'critical'
  requested_at: string
  expires_at: string
  required_permissions: string[]
  scope: Record<string, unknown>
  verification_criteria: string[]
  rollback_limitations: string[]
}

export interface HarnessTaskError {
  code: string
  message: string
  retryable: boolean
  details: unknown
}

export interface HarnessTask {
  task_id: string
  context_id: string
  owner_id: string
  device_id: string
  auth_session_id: string
  idempotency_key: string
  capability_id: string
  active_capability_id: string
  state: HarnessTaskState
  input_hash: string
  messages: HarnessMessage[]
  artifacts: HarnessArtifact[]
  approval: HarnessApprovalCheckpoint | null
  error: HarnessTaskError | null
  trace_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  step_count: number
  max_steps: number
}

export interface HarnessEvent {
  event_id: string
  task_id: string
  context_id: string
  sequence: number
  type: HarnessEventType
  occurred_at: string
  state: HarnessTaskState
  capability_id: string
  phase: string | null
  message: string
  data: Record<string, unknown>
  otel: {
    trace_id: string | null
    span_name: string
    attributes: Record<string, string | number | boolean>
  }
}

export interface HarnessTaskView {
  task: HarnessTask
  events: HarnessEvent[]
  latest_sequence: number
}

export interface HarnessStartRequest {
  device_id: string
  credential: string
  context_id: string
  idempotency_key: string
  capability_id: string
  input: string
  metadata?: Record<string, unknown>
}

export interface HarnessReadRequest {
  device_id: string
  credential: string
  task_id: string
  after_sequence?: number
}

export interface HarnessCancelRequest {
  device_id: string
  credential: string
  task_id: string
  reason?: string
}

export interface HarnessDecisionRequest {
  device_id: string
  credential: string
  task_id: string
  approval_id: string
  decision: 'approved' | 'rejected'
}

export interface HarnessCardRequest {
  device_id: string
  credential: string
}

export interface HarnessPreparedContext {
  context_ref: string
  values: Record<string, unknown>
  evidence_refs: string[]
  memory_refs: string[]
  limitations: string[]
}

export interface HarnessAdapterExecutionInput {
  task: HarnessTask
  identity: IdentityContext
  input: string
  metadata: Record<string, unknown>
  context: HarnessPreparedContext
  signal: AbortSignal
}

export interface HarnessAdapterResumeInput extends HarnessAdapterExecutionInput {
  approval: HarnessApprovalCheckpoint
}

export interface HarnessFinalStepResult {
  type: 'final'
  message: HarnessMessagePart[]
  artifacts: Omit<HarnessArtifact, 'artifact_id' | 'created_at' | 'capability_id'>[]
  trace_id?: string | null
  limitations?: string[]
}

export interface HarnessHandoffStepResult {
  type: 'handoff'
  capability_id: string
  input: string
  metadata?: Record<string, unknown>
  reason: string
}

export interface HarnessApprovalStepResult {
  type: 'approval_required'
  checkpoint: Omit<
    HarnessApprovalCheckpoint,
    'approval_id' | 'capability_id' | 'requested_at'
  >
}

export type HarnessStepResult =
  | HarnessFinalStepResult
  | HarnessHandoffStepResult
  | HarnessApprovalStepResult

export interface HarnessCapabilityAdapter {
  readonly manifest: HarnessCapabilityManifest
  prepareContext(input: HarnessAdapterExecutionInput): Promise<HarnessPreparedContext>
  execute(input: HarnessAdapterExecutionInput): Promise<HarnessStepResult>
  resume?(input: HarnessAdapterResumeInput): Promise<HarnessStepResult>
}

export interface HarnessGuardrailContext {
  request: HarnessStartRequest
  identity: IdentityContext
  manifest: HarnessCapabilityManifest
}

export interface HarnessOutputGuardrailContext {
  task: HarnessTask
  identity: IdentityContext
  manifest: HarnessCapabilityManifest
  result: HarnessFinalStepResult
}

export interface HarnessGuardrailResult {
  allowed: boolean
  code: string
  message: string
  details?: unknown
}

export interface HarnessGuardrail {
  readonly guardrail_id: string
  readonly stage: 'input' | 'output'
  readonly priority: number
  evaluate(
    context: HarnessGuardrailContext | HarnessOutputGuardrailContext
  ): Promise<HarnessGuardrailResult>
}

export interface HarnessHookContext {
  task: HarnessTask
  identity: IdentityContext
  manifest: HarnessCapabilityManifest
  input_ref: string
  context_ref: string | null
  metadata: Record<string, unknown>
}

export interface HarnessHook {
  readonly hook_id: string
  readonly stage: HarnessHookStage
  readonly priority: number
  readonly enabled: boolean
  run(context: HarnessHookContext): Promise<void>
}
