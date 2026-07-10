import { describe, expect, it } from 'vitest'

import {
  evaluateMemoryPersistence,
  validateVerticalSliceEnvelope,
  type ActionApproval,
  type ActionProposal,
  type MemoryCandidate,
  type VerticalSliceEnvelope
} from '@/core/greenfield'

const REFERENCE_TIME = new Date('2026-07-10T17:00:00.000Z')

function buildEnvelope(): VerticalSliceEnvelope {
  return {
    identity: {
      owner_id: 'owner-1',
      device_id: 'device-1',
      auth_session_id: 'session-1',
      authenticated_at: '2026-07-10T16:55:00.000Z',
      trust_level: 'trusted',
      permissions: ['calendar.read', 'calendar.write'],
      privacy_zones: ['private']
    },
    origin: {
      event_id: 'event-1',
      trace_id: 'trace-1',
      owner_id: 'owner-1',
      device_id: 'device-1',
      event_type: 'owner_request',
      occurred_at: '2026-07-10T16:59:00.000Z',
      content_ref: 'encrypted://requests/event-1',
      privacy_classification: 'private'
    },
    routing: {
      request_id: 'request-1',
      trace_id: 'trace-1',
      intent: 'calendar.review',
      time_scope: 'current',
      evidence_requirement: 'required',
      selected_capabilities: ['calendar.read'],
      server_escalation_required: false,
      server_escalation_reason: null,
      local_model: {
        provider: 'edge-provider',
        model: 'MiniCPM5-1B',
        version: 'candidate-1',
        mode: 'no_think'
      },
      confidence: 0.94,
      limitations: []
    },
    evidence: [
      {
        evidence_id: 'evidence-1',
        trace_id: 'trace-1',
        source_id: 'calendar-primary',
        observed_at: '2026-07-10T16:59:30.000Z',
        valid_from: '2026-07-10T16:59:30.000Z',
        valid_until: '2026-07-10T17:04:30.000Z',
        owner_id: 'owner-1',
        device_id: 'device-1',
        confidence: 1,
        permissions: ['calendar.read'],
        privacy_classification: 'private',
        payload_ref: 'encrypted://evidence/evidence-1',
        limitations: [],
        content_hash: 'sha256:evidence-1',
        revision: 'calendar-revision-1'
      }
    ],
    spans: [
      {
        trace_id: 'trace-1',
        span_id: 'span-root',
        parent_span_id: null,
        linked_span_ids: [],
        origin_event_id: 'event-1',
        owner_id: 'owner-1',
        device_id: 'device-1',
        component: 'request-entry',
        component_type: 'identity',
        operation: 'authenticate-and-open-trace',
        started_at: '2026-07-10T16:59:00.000Z',
        finished_at: '2026-07-10T16:59:01.000Z',
        status: 'succeeded',
        implementation_version: 'greenfield-v1',
        input_refs: ['encrypted://requests/event-1'],
        output_refs: ['trace://trace-1/span-root'],
        data_refs: [],
        decision_audits: [],
        confidence: null,
        error_ref: null,
        verification_status: 'not_required',
        privacy_classification: 'private'
      },
      {
        trace_id: 'trace-1',
        span_id: 'span-routing',
        parent_span_id: 'span-root',
        linked_span_ids: [],
        origin_event_id: 'event-1',
        owner_id: 'owner-1',
        device_id: 'device-1',
        component: 'edge-cognition',
        component_type: 'edge_model',
        operation: 'classify-request',
        started_at: '2026-07-10T16:59:01.000Z',
        finished_at: '2026-07-10T16:59:02.000Z',
        status: 'succeeded',
        implementation_version: 'minicpm-provider-v1',
        input_refs: ['encrypted://requests/event-1'],
        output_refs: ['routing://request-1'],
        data_refs: [],
        decision_audits: [
          {
            decision: 'Use fresh calendar evidence without server escalation.',
            evidence_refs: [],
            alternatives: ['Escalate to server reasoning.'],
            policy_constraints: [
              'Current-state answers require current evidence.'
            ],
            confidence: 0.94,
            uncertainty: [],
            selection_reason: 'The request is a direct calendar read.',
            fallback_reason: null,
            verification_criteria: [
              'Calendar evidence must be valid at response time.'
            ]
          }
        ],
        confidence: 0.94,
        error_ref: null,
        verification_status: 'not_required',
        privacy_classification: 'private'
      },
      {
        trace_id: 'trace-1',
        span_id: 'span-evidence',
        parent_span_id: 'span-routing',
        linked_span_ids: [],
        origin_event_id: 'event-1',
        owner_id: 'owner-1',
        device_id: 'device-1',
        component: 'evidence-service',
        component_type: 'evidence',
        operation: 'retrieve-calendar',
        started_at: '2026-07-10T16:59:02.000Z',
        finished_at: '2026-07-10T16:59:03.000Z',
        status: 'succeeded',
        implementation_version: 'greenfield-v1',
        input_refs: ['routing://request-1'],
        output_refs: ['evidence://evidence-1'],
        data_refs: ['encrypted://evidence/evidence-1'],
        decision_audits: [],
        confidence: 1,
        error_ref: null,
        verification_status: 'succeeded',
        privacy_classification: 'private'
      },
      {
        trace_id: 'trace-1',
        span_id: 'span-response',
        parent_span_id: 'span-evidence',
        linked_span_ids: [],
        origin_event_id: 'event-1',
        owner_id: 'owner-1',
        device_id: 'device-1',
        component: 'response-service',
        component_type: 'response',
        operation: 'compose-grounded-response',
        started_at: '2026-07-10T16:59:03.000Z',
        finished_at: '2026-07-10T16:59:04.000Z',
        status: 'succeeded',
        implementation_version: 'greenfield-v1',
        input_refs: ['evidence://evidence-1'],
        output_refs: ['response://response-1'],
        data_refs: [],
        decision_audits: [],
        confidence: 1,
        error_ref: null,
        verification_status: 'not_required',
        privacy_classification: 'private'
      }
    ],
    response: {
      response_id: 'response-1',
      trace_id: 'trace-1',
      content_ref: 'encrypted://responses/response-1',
      evidence_refs: ['evidence-1'],
      limitations: [],
      created_at: '2026-07-10T16:59:04.000Z'
    },
    action: null,
    approval: null,
    receipt: null,
    memory_candidate: null,
    operational_states: [
      {
        event_id: 'state-1',
        trace_id: 'trace-1',
        span_id: 'span-routing',
        device_id: 'device-1',
        state: 'thinking_locally',
        occurred_at: '2026-07-10T16:59:01.000Z',
        source_component: 'edge-cognition',
        detail_ref: null
      },
      {
        event_id: 'state-2',
        trace_id: 'trace-1',
        span_id: 'span-response',
        device_id: 'device-1',
        state: 'speaking',
        occurred_at: '2026-07-10T16:59:04.000Z',
        source_component: 'response-service',
        detail_ref: null
      }
    ]
  }
}

function buildHighRiskAction(): ActionProposal {
  return {
    action_id: 'action-1',
    trace_id: 'trace-1',
    capability: 'calendar.write',
    risk: 'high',
    required_permissions: ['calendar.write'],
    confirmation_required: true,
    requested_by_owner_id: 'owner-1',
    requested_by_device_id: 'device-1',
    auth_session_id: 'session-1',
    arguments_ref: 'encrypted://actions/action-1/arguments',
    expected_result: 'A calendar event exists with the requested fields.',
    verification: {
      method: 'calendar-event-readback',
      criteria: ['The event ID exists in the source calendar.'],
      external_source_required: true
    },
    rollback: {
      supported: true,
      method: 'delete-created-calendar-event',
      limitations: []
    },
    status: 'proposed'
  }
}

function buildApproval(): ActionApproval {
  return {
    approval_id: 'approval-1',
    action_id: 'action-1',
    trace_id: 'trace-1',
    owner_id: 'owner-1',
    auth_session_id: 'session-1',
    decision: 'approved',
    decided_at: '2026-07-10T16:59:10.000Z'
  }
}

function issueCodes(result: ReturnType<typeof validateVerticalSliceEnvelope>): string[] {
  return result.valid ? [] : result.issues.map((issue) => issue.code)
}

describe('greenfield vertical-slice contracts', () => {
  it('accepts an authenticated, traced, fresh-evidence response', () => {
    const result = validateVerticalSliceEnvelope(
      buildEnvelope(),
      REFERENCE_TIME
    )

    expect(result.valid).toBe(true)
  })

  it('accepts an explicit limitation when current evidence is unavailable', () => {
    const envelope = buildEnvelope()
    envelope.evidence = []
    envelope.response.evidence_refs = []
    envelope.response.limitations = [
      'The calendar source is unavailable, so no current schedule can be confirmed.'
    ]

    const result = validateVerticalSliceEnvelope(envelope, REFERENCE_TIME)

    expect(result.valid).toBe(true)
  })

  it('rejects stale evidence used for a current-state answer', () => {
    const envelope = buildEnvelope()
    envelope.evidence[0]!.valid_until = '2026-07-10T16:59:59.000Z'

    const result = validateVerticalSliceEnvelope(envelope, REFERENCE_TIME)

    expect(result.valid).toBe(false)
    expect(issueCodes(result)).toContain('evidence.stale_for_current_state')
  })

  it('rejects an unpaired requesting device', () => {
    const envelope = buildEnvelope()
    envelope.identity.trust_level = 'untrusted'

    const result = validateVerticalSliceEnvelope(envelope, REFERENCE_TIME)

    expect(result.valid).toBe(false)
    expect(issueCodes(result)).toContain('identity.device_not_trusted')
  })

  it('rejects an orphaned trace span', () => {
    const envelope = buildEnvelope()
    envelope.spans[1]!.parent_span_id = 'missing-span'

    const result = validateVerticalSliceEnvelope(envelope, REFERENCE_TIME)

    expect(result.valid).toBe(false)
    expect(issueCodes(result)).toContain('trace.orphan_span')
  })

  it('rejects a high-risk action without explicit owner approval', () => {
    const envelope = buildEnvelope()
    envelope.action = buildHighRiskAction()

    const result = validateVerticalSliceEnvelope(envelope, REFERENCE_TIME)

    expect(result.valid).toBe(false)
    expect(issueCodes(result)).toContain('action.approval_missing')
  })

  it('accepts a high-risk proposal when the matching owner approves it', () => {
    const envelope = buildEnvelope()
    envelope.action = buildHighRiskAction()
    envelope.approval = buildApproval()

    const result = validateVerticalSliceEnvelope(envelope, REFERENCE_TIME)

    expect(result.valid).toBe(true)
  })

  it('rejects a successful action that was not successfully verified', () => {
    const envelope = buildEnvelope()
    envelope.action = {
      ...buildHighRiskAction(),
      status: 'succeeded'
    }
    envelope.approval = buildApproval()
    envelope.receipt = {
      receipt_id: 'receipt-1',
      action_id: 'action-1',
      trace_id: 'trace-1',
      requested_action: 'Create a calendar event.',
      actor_ref: 'identity://owner-1',
      executor_ref: 'connector://calendar-primary',
      input_ref: 'encrypted://actions/action-1/arguments',
      approval_ref: 'approval://approval-1',
      execution_status: 'succeeded',
      output_ref: 'calendar://event-created',
      verification_method: 'calendar-event-readback',
      verification_status: 'failed',
      verification_evidence_refs: [],
      executed_at: '2026-07-10T16:59:11.000Z',
      verified_at: '2026-07-10T16:59:12.000Z',
      failure_ref: 'error://verification-1',
      rollback_status: 'available'
    }

    const result = validateVerticalSliceEnvelope(envelope, REFERENCE_TIME)

    expect(result.valid).toBe(false)
    expect(issueCodes(result)).toContain('receipt.success_not_verified')
  })

  it('prevents an owner-rejected memory candidate from being persisted', () => {
    const envelope = buildEnvelope()
    const candidate: MemoryCandidate = {
      candidate_id: 'candidate-1',
      owner_id: 'owner-1',
      trace_id: 'trace-1',
      memory_class: 'long_term_episodic',
      title: 'Calendar review',
      content_ref: 'encrypted://memory-candidates/candidate-1',
      source_refs: ['evidence://evidence-1'],
      observed_at: '2026-07-10T16:59:30.000Z',
      valid_from: '2026-07-10T16:59:30.000Z',
      valid_until: null,
      temporal_status: 'historical',
      confidence: 0.9,
      confirmation_status: 'rejected',
      privacy_zone: 'private',
      salience: 0.4,
      retention_policy: 'retain_until_owner_purge',
      embedding_version: null,
      derivation_links: [],
      contradiction_links: [],
      supersession_links: []
    }

    const decision = evaluateMemoryPersistence(candidate, envelope.identity)

    expect(decision.allowed).toBe(false)
    expect(decision.code).toBe('memory.owner_rejected')
  })

  it('rejects UI state that is not driven by a real trace span', () => {
    const envelope = buildEnvelope()
    envelope.operational_states[0]!.span_id = 'decorative-timer'

    const result = validateVerticalSliceEnvelope(envelope, REFERENCE_TIME)

    expect(result.valid).toBe(false)
    expect(issueCodes(result)).toContain('ui_state.span_missing')
  })
})