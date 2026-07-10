import type {
  ActionApproval,
  ActionProposal,
  EvidenceObservation,
  IdentityContext,
  LocalRoutingDecision,
  MemoryCandidate,
  OperationalStateEvent,
  TraceSpan,
  VerificationReceipt
} from './contracts'

export type PolicyDecision =
  | {
      allowed: true
      code: 'allowed'
      reasons: string[]
    }
  | {
      allowed: false
      code: string
      reasons: string[]
    }

const ALLOWED: PolicyDecision = {
  allowed: true,
  code: 'allowed',
  reasons: []
}

function denied(code: string, ...reasons: string[]): PolicyDecision {
  return {
    allowed: false,
    code,
    reasons
  }
}

function hasAllPermissions(
  identity: IdentityContext,
  requiredPermissions: string[]
): boolean {
  const granted = new Set(identity.permissions)

  return requiredPermissions.every((permission) => granted.has(permission))
}

export function evaluateIdentity(identity: IdentityContext): PolicyDecision {
  if (
    identity.trust_level !== 'paired' &&
    identity.trust_level !== 'trusted' &&
    identity.trust_level !== 'owner_admin'
  ) {
    return denied(
      'identity.device_not_trusted',
      'The requesting device is not paired or trusted.'
    )
  }

  if (!identity.auth_session_id) {
    return denied(
      'identity.session_missing',
      'An authenticated owner session is required.'
    )
  }

  return ALLOWED
}

export function isEvidenceFreshAt(
  evidence: EvidenceObservation,
  referenceTime: Date
): boolean {
  const referenceTimestamp = referenceTime.getTime()
  const observedAt = Date.parse(evidence.observed_at)
  const validFrom = Date.parse(evidence.valid_from)
  const validUntil = evidence.valid_until
    ? Date.parse(evidence.valid_until)
    : Number.POSITIVE_INFINITY

  return (
    observedAt <= referenceTimestamp &&
    validFrom <= referenceTimestamp &&
    referenceTimestamp <= validUntil
  )
}

export function evaluateEvidenceForRoute(
  evidence: EvidenceObservation,
  identity: IdentityContext,
  routing: LocalRoutingDecision,
  referenceTime: Date
): PolicyDecision {
  if (evidence.owner_id !== identity.owner_id) {
    return denied(
      'evidence.owner_mismatch',
      'Evidence belongs to a different owner.'
    )
  }

  if (!hasAllPermissions(identity, evidence.permissions)) {
    return denied(
      'evidence.permission_missing',
      'The owner session lacks a permission required by the evidence source.'
    )
  }

  if (
    routing.time_scope === 'current' &&
    !isEvidenceFreshAt(evidence, referenceTime)
  ) {
    return denied(
      'evidence.stale_for_current_state',
      'Current-state requests require evidence valid at response time.'
    )
  }

  if (routing.evidence_requirement === 'forbidden') {
    return denied(
      'evidence.forbidden_by_route',
      'The validated route forbids evidence attachment.'
    )
  }

  return ALLOWED
}

export function evaluateCurrentStateEvidenceSet(
  evidence: EvidenceObservation[],
  identity: IdentityContext,
  routing: LocalRoutingDecision,
  referenceTime: Date
): PolicyDecision {
  if (routing.time_scope !== 'current') {
    return ALLOWED
  }

  if (routing.evidence_requirement !== 'required') {
    return denied(
      'routing.current_state_requires_evidence',
      'A current-state route must require evidence.'
    )
  }

  const usableEvidence = evidence.filter(
    (observation) =>
      evaluateEvidenceForRoute(
        observation,
        identity,
        routing,
        referenceTime
      ).allowed
  )

  if (usableEvidence.length === 0) {
    return denied(
      'evidence.current_state_unavailable',
      'No fresh, authorized evidence is available for the current-state request.'
    )
  }

  return ALLOWED
}

function actionRequiresApproval(action: ActionProposal): boolean {
  return (
    action.confirmation_required ||
    action.risk === 'high' ||
    action.risk === 'critical'
  )
}

export function evaluateActionProposal(
  action: ActionProposal,
  identity: IdentityContext,
  approval: ActionApproval | null
): PolicyDecision {
  const identityDecision = evaluateIdentity(identity)
  if (!identityDecision.allowed) {
    return identityDecision
  }

  if (
    action.requested_by_owner_id !== identity.owner_id ||
    action.requested_by_device_id !== identity.device_id ||
    action.auth_session_id !== identity.auth_session_id
  ) {
    return denied(
      'action.identity_mismatch',
      'The action request does not match the authenticated owner, device, and session.'
    )
  }

  if (!hasAllPermissions(identity, action.required_permissions)) {
    return denied(
      'action.permission_missing',
      'The owner session lacks one or more action permissions.'
    )
  }

  if (
    (action.risk === 'high' || action.risk === 'critical') &&
    !action.confirmation_required
  ) {
    return denied(
      'action.risky_confirmation_not_declared',
      'High-risk and critical actions must declare confirmation as required.'
    )
  }

  if (actionRequiresApproval(action)) {
    if (!approval) {
      return denied(
        'action.approval_missing',
        'The action requires an explicit owner approval.'
      )
    }

    if (
      approval.action_id !== action.action_id ||
      approval.trace_id !== action.trace_id ||
      approval.owner_id !== identity.owner_id ||
      approval.auth_session_id !== identity.auth_session_id
    ) {
      return denied(
        'action.approval_mismatch',
        'The approval does not match the proposed action and authenticated session.'
      )
    }

    if (approval.decision !== 'approved') {
      return denied(
        'action.owner_rejected',
        'The owner rejected the proposed action.'
      )
    }
  }

  return ALLOWED
}

export function evaluateVerificationReceipt(
  action: ActionProposal,
  receipt: VerificationReceipt
): PolicyDecision {
  if (
    receipt.action_id !== action.action_id ||
    receipt.trace_id !== action.trace_id
  ) {
    return denied(
      'receipt.action_mismatch',
      'The receipt does not belong to the proposed action and trace.'
    )
  }

  if (
    receipt.execution_status === 'succeeded' &&
    receipt.verification_status !== 'succeeded'
  ) {
    return denied(
      'receipt.success_not_verified',
      'An action cannot be reported as successful without successful verification.'
    )
  }

  if (
    receipt.verification_status === 'succeeded' &&
    receipt.verification_evidence_refs.length === 0
  ) {
    return denied(
      'receipt.verification_evidence_missing',
      'Successful verification requires at least one verification evidence reference.'
    )
  }

  return ALLOWED
}

export function evaluateMemoryPersistence(
  candidate: MemoryCandidate,
  identity: IdentityContext
): PolicyDecision {
  if (candidate.owner_id !== identity.owner_id) {
    return denied(
      'memory.owner_mismatch',
      'The memory candidate belongs to a different owner.'
    )
  }

  if (candidate.confirmation_status === 'rejected') {
    return denied(
      'memory.owner_rejected',
      'An owner-rejected memory candidate must not be stored.'
    )
  }

  if (candidate.confirmation_status === 'pending') {
    return denied(
      'memory.confirmation_pending',
      'A pending memory candidate is not eligible for durable storage.'
    )
  }

  if (
    (candidate.memory_class === 'identity' ||
      candidate.memory_class === 'model_hypothesis') &&
    candidate.confirmation_status !== 'owner_confirmed'
  ) {
    return denied(
      'memory.explicit_confirmation_required',
      'Identity memories and model hypotheses require explicit owner confirmation.'
    )
  }

  if (candidate.source_refs.length === 0) {
    return denied(
      'memory.provenance_missing',
      'Durable memory requires source provenance.'
    )
  }

  return ALLOWED
}

export function evaluateTraceContinuity(
  spans: TraceSpan[],
  expectedTraceId: string,
  expectedOriginEventId: string
): PolicyDecision {
  if (spans.length === 0) {
    return denied('trace.empty', 'At least one trace span is required.')
  }

  const spanById = new Map(spans.map((span) => [span.span_id, span]))
  if (spanById.size !== spans.length) {
    return denied('trace.duplicate_span_id', 'Trace span IDs must be unique.')
  }

  const roots = spans.filter((span) => span.parent_span_id === null)
  if (roots.length !== 1) {
    return denied(
      'trace.root_count_invalid',
      'A vertical-slice trace must have exactly one root span.'
    )
  }

  for (const span of spans) {
    if (span.trace_id !== expectedTraceId) {
      return denied(
        'trace.id_mismatch',
        `Span ${span.span_id} has a different trace ID.`
      )
    }

    if (span.origin_event_id !== expectedOriginEventId) {
      return denied(
        'trace.origin_mismatch',
        `Span ${span.span_id} is not linked to the originating event.`
      )
    }

    if (span.parent_span_id && !spanById.has(span.parent_span_id)) {
      return denied(
        'trace.orphan_span',
        `Span ${span.span_id} references a missing parent.`
      )
    }

    const visited = new Set<string>()
    let cursor: TraceSpan | undefined = span

    while (cursor) {
      if (visited.has(cursor.span_id)) {
        return denied(
          'trace.cycle_detected',
          `Span ${span.span_id} participates in a parent cycle.`
        )
      }

      visited.add(cursor.span_id)
      cursor = cursor.parent_span_id
        ? spanById.get(cursor.parent_span_id)
        : undefined
    }

    if (!visited.has(roots[0]!.span_id)) {
      return denied(
        'trace.disconnected_span',
        `Span ${span.span_id} does not reach the origin root.`
      )
    }
  }

  return ALLOWED
}

export function evaluateOperationalStates(
  events: OperationalStateEvent[],
  spans: TraceSpan[],
  expectedTraceId: string
): PolicyDecision {
  const spanIds = new Set(spans.map((span) => span.span_id))

  for (const event of events) {
    if (event.trace_id !== expectedTraceId) {
      return denied(
        'ui_state.trace_mismatch',
        `Operational state ${event.event_id} belongs to a different trace.`
      )
    }

    if (!spanIds.has(event.span_id)) {
      return denied(
        'ui_state.span_missing',
        `Operational state ${event.event_id} is not backed by a real trace span.`
      )
    }
  }

  return ALLOWED
}