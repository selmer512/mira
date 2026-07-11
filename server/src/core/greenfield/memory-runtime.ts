import { randomUUID } from 'node:crypto'

import type {
  IdentityContext,
  LocalRoutingDecision,
  MemoryCandidate,
  OperationalStateEvent,
  OwnerResponse,
  TraceSpan,
  VerticalSliceEnvelope
} from './contracts'
import {
  MEMORY_CANDIDATE_CREATE_CAPABILITY,
  type MemoryCandidateDraft,
  type MemoryCandidatePersistenceReceipt
} from './memory-contracts'
import {
  MemoryLifecycleService,
  MemoryServiceError
} from './memory-service'
import {
  GreenfieldExecutionError,
  type IdentityResolver
} from './runtime'
import {
  TraceStoreError,
  type TracePersistenceReceipt
} from './trace-store'
import { validateVerticalSliceEnvelope } from './validation'

export interface MemoryCandidateRequest {
  device_id: string
  credential: string
  title: string
  content: string
  memory_class: MemoryCandidate['memory_class']
  temporal_status: MemoryCandidate['temporal_status']
  observed_at: string
  valid_from: string | null
  valid_until: string | null
  privacy_zone: string
  confidence: number
  salience: number
  retention_policy: string
  source_refs: string[]
  derivation_links: string[]
  contradiction_links: string[]
  supersession_links: string[]
}

export interface MemoryTraceStore {
  append(envelope: VerticalSliceEnvelope): Promise<TracePersistenceReceipt>
}

export interface MemoryCandidateExecutionResult {
  answer: string
  candidate: MemoryCandidate
  candidate_content: string
  approval_token: string
  candidate_persistence: MemoryCandidatePersistenceReceipt
  envelope: VerticalSliceEnvelope
  trace_persistence: TracePersistenceReceipt
}

export interface MemoryCandidateRuntimeDependencies {
  identityResolver: IdentityResolver
  memoryService: MemoryLifecycleService
  traceStore: MemoryTraceStore
  now?: () => Date
  createId?: () => string
}

function createSpan(input: {
  traceId: string
  spanId: string
  parentSpanId: string | null
  originEventId: string
  identity: IdentityContext
  component: string
  componentType: TraceSpan['component_type']
  operation: string
  startedAt: Date
  finishedAt: Date
  inputRefs?: string[]
  outputRefs?: string[]
  dataRefs?: string[]
  decisionAudits?: TraceSpan['decision_audits']
  verificationStatus?: TraceSpan['verification_status']
  confidence?: number | null
}): TraceSpan {
  return {
    trace_id: input.traceId,
    span_id: input.spanId,
    parent_span_id: input.parentSpanId,
    linked_span_ids: [],
    origin_event_id: input.originEventId,
    owner_id: input.identity.owner_id,
    device_id: input.identity.device_id,
    component: input.component,
    component_type: input.componentType,
    operation: input.operation,
    started_at: input.startedAt.toISOString(),
    finished_at: input.finishedAt.toISOString(),
    status: 'succeeded',
    implementation_version: 'greenfield-memory-runtime-v1',
    input_refs: input.inputRefs || [],
    output_refs: input.outputRefs || [],
    data_refs: input.dataRefs || [],
    decision_audits: input.decisionAudits || [],
    confidence: input.confidence ?? null,
    error_ref: null,
    verification_status: input.verificationStatus || 'not_required',
    privacy_classification: 'private'
  }
}

function createOperationalState(input: {
  eventId: string
  traceId: string
  spanId: string
  deviceId: string
  state: OperationalStateEvent['state']
  occurredAt: Date
  sourceComponent: string
  detailRef?: string | null
}): OperationalStateEvent {
  return {
    event_id: input.eventId,
    trace_id: input.traceId,
    span_id: input.spanId,
    device_id: input.deviceId,
    state: input.state,
    occurred_at: input.occurredAt.toISOString(),
    source_component: input.sourceComponent,
    detail_ref: input.detailRef || null
  }
}

export class MemoryCandidateRequestOrchestrator {
  private readonly now: () => Date
  private readonly createId: () => string

  public constructor(
    private readonly dependencies: MemoryCandidateRuntimeDependencies
  ) {
    this.now = dependencies.now || ((): Date => new Date())
    this.createId = dependencies.createId || randomUUID
  }

  public async execute(
    request: MemoryCandidateRequest
  ): Promise<MemoryCandidateExecutionResult> {
    const authenticatedAt = this.now()
    const identity = await this.dependencies.identityResolver.resolve({
      deviceId: request.device_id,
      credential: request.credential,
      authenticatedAt
    })
    const traceId = this.createId()
    const originEventId = this.createId()
    const rootSpanId = this.createId()
    const policySpanId = this.createId()
    const memorySpanId = this.createId()
    const responseSpanId = this.createId()
    const candidateId = this.createId()
    const responseId = this.createId()
    const requestRef = `inline://greenfield/memory-request/${originEventId}`
    const sourceRefs = [...new Set([requestRef, ...request.source_refs])]

    const policyStartedAt = this.now()
    const routing: LocalRoutingDecision = {
      request_id: this.createId(),
      trace_id: traceId,
      intent: 'memory.candidate.create',
      time_scope: 'atemporal',
      evidence_requirement: 'forbidden',
      selected_capabilities: [MEMORY_CANDIDATE_CREATE_CAPABILITY],
      server_escalation_required: false,
      server_escalation_reason: null,
      local_model: {
        provider: 'deterministic',
        model: 'structured-memory-candidate-policy',
        version: '1',
        mode: 'no_think'
      },
      confidence: 1,
      limitations: [
        'Only owner-supplied structured content is proposed; no model inference is promoted to durable memory.'
      ]
    }
    const policyFinishedAt = this.now()

    const memoryStartedAt = this.now()
    const draft: MemoryCandidateDraft = {
      title: request.title,
      content: request.content,
      memory_class: request.memory_class,
      source_refs: sourceRefs,
      observed_at: request.observed_at,
      valid_from: request.valid_from,
      valid_until: request.valid_until,
      temporal_status: request.temporal_status,
      confidence: request.confidence,
      privacy_zone: request.privacy_zone,
      salience: request.salience,
      retention_policy: request.retention_policy,
      derivation_links: request.derivation_links,
      contradiction_links: request.contradiction_links,
      supersession_links: request.supersession_links
    }

    let challenge: ReturnType<MemoryLifecycleService['createCandidate']>
    try {
      challenge = this.dependencies.memoryService.createCandidate({
        identity,
        traceId,
        candidateId,
        draft,
        createdAt: memoryStartedAt
      })
    } catch (error) {
      throw this.translateError(error)
    }
    const memoryFinishedAt = this.now()

    const responseStartedAt = this.now()
    const answer =
      'I prepared this as a pending memory candidate with provenance. It is not durable memory until you explicitly confirm it.'
    const responseFinishedAt = this.now()
    const response: OwnerResponse = {
      response_id: responseId,
      trace_id: traceId,
      content_ref: `inline://greenfield/memory-response/${responseId}`,
      evidence_refs: [],
      limitations: [
        'The candidate remains pending and cannot influence retrieval until owner confirmation.',
        'Current-world claims still require fresh evidence even after confirmation.'
      ],
      created_at: responseFinishedAt.toISOString()
    }

    const candidateRef = `memory-candidate://${candidateId}`
    const spans: TraceSpan[] = [
      createSpan({
        traceId,
        spanId: rootSpanId,
        parentSpanId: null,
        originEventId,
        identity,
        component: 'greenfield-memory-http-entry',
        componentType: 'identity',
        operation: 'authenticate-owner-and-device',
        startedAt: authenticatedAt,
        finishedAt: policyStartedAt,
        inputRefs: [requestRef],
        outputRefs: [`trace://${traceId}`]
      }),
      createSpan({
        traceId,
        spanId: policySpanId,
        parentSpanId: rootSpanId,
        originEventId,
        identity,
        component: 'greenfield-memory-policy',
        componentType: 'policy',
        operation: 'validate-memory-candidate-authority-and-provenance',
        startedAt: policyStartedAt,
        finishedAt: policyFinishedAt,
        inputRefs: [requestRef],
        outputRefs: [`routing://${routing.request_id}`],
        decisionAudits: [
          {
            decision: 'create_pending_candidate_only',
            evidence_refs: sourceRefs,
            alternatives: [
              'Reject invalid or unauthorized content.',
              'Require fresh evidence for present-state claims.',
              'Wait for explicit owner confirmation before durable storage.'
            ],
            policy_constraints: [
              MEMORY_CANDIDATE_CREATE_CAPABILITY,
              'memory.provenance_required',
              'memory.owner_confirmation_required',
              'memory.current_state_requires_fresh_evidence'
            ],
            confidence: 1,
            uncertainty: [],
            selection_reason:
              'The owner supplied structured content and the deterministic policy permits only a pending candidate.',
            fallback_reason: null,
            verification_criteria: [
              'Candidate is encrypted and bound to the owner and origin trace.',
              'Candidate cannot be retrieved as durable memory before confirmation.',
              'Trace persistence succeeds before the approval token is returned.'
            ]
          }
        ],
        confidence: 1
      }),
      createSpan({
        traceId,
        spanId: memorySpanId,
        parentSpanId: policySpanId,
        originEventId,
        identity,
        component: 'greenfield-memory-store',
        componentType: 'memory',
        operation: 'persist-encrypted-pending-memory-candidate',
        startedAt: memoryStartedAt,
        finishedAt: memoryFinishedAt,
        inputRefs: sourceRefs,
        outputRefs: [candidateRef],
        dataRefs: [
          `memory-record-hash://${challenge.persistence.record_hash}`,
          `memory-content-hash://${challenge.persistence.content_hash}`
        ],
        verificationStatus: 'succeeded',
        confidence: challenge.candidate.confidence
      }),
      createSpan({
        traceId,
        spanId: responseSpanId,
        parentSpanId: memorySpanId,
        originEventId,
        identity,
        component: 'greenfield-memory-response-composer',
        componentType: 'response',
        operation: 'request-explicit-owner-memory-confirmation',
        startedAt: responseStartedAt,
        finishedAt: responseFinishedAt,
        inputRefs: [candidateRef],
        outputRefs: [`response://${responseId}`]
      })
    ]

    const operationalStates: OperationalStateEvent[] = [
      createOperationalState({
        eventId: this.createId(),
        traceId,
        spanId: policySpanId,
        deviceId: identity.device_id,
        state: 'thinking_locally',
        occurredAt: policyStartedAt,
        sourceComponent: 'greenfield-memory-policy'
      }),
      createOperationalState({
        eventId: this.createId(),
        traceId,
        spanId: memorySpanId,
        deviceId: identity.device_id,
        state: 'syncing_memory',
        occurredAt: memoryStartedAt,
        sourceComponent: 'greenfield-memory-store',
        detailRef: candidateRef
      }),
      createOperationalState({
        eventId: this.createId(),
        traceId,
        spanId: responseSpanId,
        deviceId: identity.device_id,
        state: 'waiting_for_approval',
        occurredAt: responseStartedAt,
        sourceComponent: 'greenfield-memory-response-composer',
        detailRef: candidateRef
      }),
      createOperationalState({
        eventId: this.createId(),
        traceId,
        spanId: responseSpanId,
        deviceId: identity.device_id,
        state: 'speaking',
        occurredAt: responseFinishedAt,
        sourceComponent: 'greenfield-memory-response-composer'
      })
    ]

    const envelope: VerticalSliceEnvelope = {
      identity,
      origin: {
        event_id: originEventId,
        trace_id: traceId,
        owner_id: identity.owner_id,
        device_id: identity.device_id,
        event_type: 'owner_request',
        occurred_at: authenticatedAt.toISOString(),
        content_ref: requestRef,
        privacy_classification: 'private'
      },
      routing,
      evidence: [],
      spans,
      response,
      action: null,
      approval: null,
      receipt: null,
      memory_candidate: challenge.candidate,
      operational_states: operationalStates
    }
    const validation = validateVerticalSliceEnvelope(
      envelope,
      responseFinishedAt
    )
    if (!validation.valid) {
      this.dependencies.memoryService.rollbackCandidate(
        identity.owner_id,
        candidateId,
        traceId,
        responseFinishedAt
      )
      throw new GreenfieldExecutionError(
        'memory.envelope_validation_failed',
        'The memory candidate produced an invalid causal envelope.',
        500,
        validation.issues
      )
    }

    let tracePersistence: TracePersistenceReceipt
    try {
      tracePersistence = await this.dependencies.traceStore.append(
        validation.envelope
      )
    } catch (error) {
      this.dependencies.memoryService.rollbackCandidate(
        identity.owner_id,
        candidateId,
        traceId,
        this.now()
      )
      throw this.translateError(error, 'memory.trace_persistence_failed')
    }

    return {
      answer,
      candidate: challenge.candidate,
      candidate_content: challenge.content,
      approval_token: challenge.approval_token,
      candidate_persistence: challenge.persistence,
      envelope: validation.envelope,
      trace_persistence: tracePersistence
    }
  }

  private translateError(
    error: unknown,
    fallbackCode = 'memory.request_failed'
  ): GreenfieldExecutionError {
    if (error instanceof GreenfieldExecutionError) return error
    if (error instanceof MemoryServiceError || error instanceof TraceStoreError) {
      return new GreenfieldExecutionError(
        error.code,
        error.message,
        error.statusCode,
        error.details
      )
    }
    return new GreenfieldExecutionError(
      fallbackCode,
      'The memory candidate request failed unexpectedly.',
      500,
      error instanceof Error ? error.message : String(error)
    )
  }
}
