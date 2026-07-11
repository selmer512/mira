import { describe, expect, it } from 'vitest'

import {
  evaluateActionProposal,
  evaluateEvidenceForRoute,
  evaluateMemoryPersistence,
  validateVerticalSliceEnvelope,
  type ActionProposal,
  type EvidenceObservation,
  type IdentityContext,
  type LocalRoutingDecision,
  type MemoryCandidate,
  type VerticalSliceEnvelope
} from '@/core/greenfield'

const identity: IdentityContext = {
  owner_id: 'owner-1',
  device_id: 'device-1',
  auth_session_id: 'session-1',
  authenticated_at: '2026-07-10T16:55:00.000Z',
  trust_level: 'trusted',
  permissions: ['calendar.create'],
  privacy_zones: ['private']
}

const routing: LocalRoutingDecision = {
  request_id: 'request-1',
  trace_id: 'trace-1',
  intent: 'historical.summary',
  time_scope: 'historical',
  evidence_requirement: 'optional',
  selected_capabilities: [],
  server_escalation_required: false,
  server_escalation_reason: null,
  local_model: {
    provider: 'edge-provider',
    model: 'MiniCPM5-1B',
    version: 'candidate-1',
    mode: 'no_think'
  },
  confidence: 0.9,
  limitations: []
}

function buildMinimalEnvelope(): VerticalSliceEnvelope {
  return {
    identity: { ...identity },
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
    routing: { ...routing },
    evidence: [],
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
      }
    ],
    response: {
      response_id: 'response-1',
      trace_id: 'trace-1',
      content_ref: 'encrypted://responses/response-1',
      evidence_refs: [],
      limitations: [],
      created_at: '2026-07-10T16:59:01.000Z'
    },
    action: null,
    approval: null,
    receipt: null,
    memory_candidate: null,
    operational_states: []
  }
}

describe('greenfield deterministic security boundaries', () => {
  it('denies a capability that is not allowlisted by session permissions', () => {
    const action: ActionProposal = {
      action_id: 'action-1',
      trace_id: 'trace-1',
      capability: 'calendar.write',
      risk: 'low',
      required_permissions: ['calendar.create'],
      confirmation_required: false,
      requested_by_owner_id: 'owner-1',
      requested_by_device_id: 'device-1',
      auth_session_id: 'session-1',
      arguments_ref: 'encrypted://actions/action-1/arguments',
      expected_result: 'A calendar event exists.',
      verification: {
        method: 'calendar-event-readback',
        criteria: ['The event exists in the source calendar.'],
        external_source_required: true
      },
      rollback: {
        supported: true,
        method: 'delete-created-event',
        limitations: []
      },
      status: 'proposed'
    }

    const decision = evaluateActionProposal(action, identity, null)

    expect(decision.allowed).toBe(false)
    expect(decision.code).toBe('action.capability_not_allowed')
  })

  it('denies evidence outside the session privacy zones', () => {
    const evidence: EvidenceObservation = {
      evidence_id: 'evidence-1',
      trace_id: 'trace-1',
      source_id: 'health-source',
      observed_at: '2026-07-10T16:59:00.000Z',
      valid_from: '2026-07-10T16:59:00.000Z',
      valid_until: null,
      owner_id: 'owner-1',
      device_id: 'device-1',
      confidence: 1,
      permissions: [],
      privacy_classification: 'sensitive',
      payload_ref: 'encrypted://evidence/evidence-1',
      limitations: [],
      content_hash: 'sha256:evidence-1',
      revision: 'revision-1'
    }

    const decision = evaluateEvidenceForRoute(
      evidence,
      identity,
      routing,
      new Date('2026-07-10T17:00:00.000Z')
    )

    expect(decision.allowed).toBe(false)
    expect(decision.code).toBe('evidence.privacy_zone_denied')
  })

  it('denies durable memory writes outside the session privacy zones', () => {
    const candidate: MemoryCandidate = {
      candidate_id: 'candidate-1',
      owner_id: 'owner-1',
      trace_id: 'trace-1',
      memory_class: 'semantic',
      title: 'Restricted fact',
      content_ref: 'encrypted://memory-candidates/candidate-1',
      source_refs: ['source://1'],
      observed_at: '2026-07-10T16:59:00.000Z',
      valid_from: null,
      valid_until: null,
      temporal_status: 'unknown',
      confidence: 0.8,
      confirmation_status: 'owner_confirmed',
      privacy_zone: 'restricted',
      salience: 0.5,
      retention_policy: 'retain_until_owner_purge',
      embedding_version: null,
      derivation_links: [],
      contradiction_links: [],
      supersession_links: []
    }

    const decision = evaluateMemoryPersistence(candidate, identity)

    expect(decision.allowed).toBe(false)
    expect(decision.code).toBe('memory.privacy_zone_denied')
  })

  it('rejects a trace span attributed to another owner', () => {
    const envelope = buildMinimalEnvelope()
    envelope.spans[0]!.owner_id = 'owner-2'

    const result = validateVerticalSliceEnvelope(envelope)

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.code)).toContain(
        'trace.identity_mismatch'
      )
    }
  })

  it('rejects a UI state targeted at a different device', () => {
    const envelope = buildMinimalEnvelope()
    envelope.operational_states = [
      {
        event_id: 'state-1',
        trace_id: 'trace-1',
        span_id: 'span-root',
        device_id: 'device-2',
        state: 'listening',
        occurred_at: '2026-07-10T16:59:00.000Z',
        source_component: 'request-entry',
        detail_ref: null
      }
    ]

    const result = validateVerticalSliceEnvelope(envelope)

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.code)).toContain(
        'ui_state.device_mismatch'
      )
    }
  })
})
