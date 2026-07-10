import Ajv, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'

import {
  VerticalSliceEnvelopeSchema,
  type VerticalSliceEnvelope
} from './contracts'
import {
  evaluateActionProposal,
  evaluateCurrentStateEvidenceSet,
  evaluateEvidenceForRoute,
  evaluateIdentity,
  evaluateOperationalStates,
  evaluateTraceContinuity,
  evaluateVerificationReceipt,
  type PolicyDecision
} from './policy'

export interface ValidationIssue {
  code: string
  path: string
  message: string
}

export type VerticalSliceValidationResult =
  | {
      valid: true
      envelope: VerticalSliceEnvelope
      issues: []
    }
  | {
      valid: false
      issues: ValidationIssue[]
    }

const ajv = new Ajv({
  allErrors: true,
  strict: true
})
addFormats(ajv)

const validateSchema = ajv.compile<VerticalSliceEnvelope>(
  VerticalSliceEnvelopeSchema
)

function schemaIssue(error: ErrorObject): ValidationIssue {
  return {
    code: `schema.${error.keyword}`,
    path: error.instancePath || '/',
    message: error.message || 'Schema validation failed.'
  }
}

function appendPolicyDecision(
  issues: ValidationIssue[],
  path: string,
  decision: PolicyDecision
): void {
  if (decision.allowed) {
    return
  }

  for (const reason of decision.reasons) {
    issues.push({
      code: decision.code,
      path,
      message: reason
    })
  }
}

function validateIdentityAndTrace(
  envelope: VerticalSliceEnvelope,
  issues: ValidationIssue[]
): void {
  appendPolicyDecision(
    issues,
    '/identity',
    evaluateIdentity(envelope.identity)
  )

  if (
    envelope.origin.owner_id !== envelope.identity.owner_id ||
    envelope.origin.device_id !== envelope.identity.device_id
  ) {
    issues.push({
      code: 'origin.identity_mismatch',
      path: '/origin',
      message:
        'The origin event must match the authenticated owner and requesting device.'
    })
  }

  appendPolicyDecision(
    issues,
    '/spans',
    evaluateTraceContinuity(
      envelope.spans,
      envelope.origin.trace_id,
      envelope.origin.event_id
    )
  )

  if (envelope.routing.trace_id !== envelope.origin.trace_id) {
    issues.push({
      code: 'routing.trace_mismatch',
      path: '/routing/trace_id',
      message: 'The local routing decision must remain on the origin trace.'
    })
  }

  if (envelope.response.trace_id !== envelope.origin.trace_id) {
    issues.push({
      code: 'response.trace_mismatch',
      path: '/response/trace_id',
      message: 'The owner-facing response must remain on the origin trace.'
    })
  }
}

function validateEvidence(
  envelope: VerticalSliceEnvelope,
  referenceTime: Date,
  issues: ValidationIssue[]
): void {
  for (const [index, observation] of envelope.evidence.entries()) {
    const path = `/evidence/${index}`

    if (observation.trace_id !== envelope.origin.trace_id) {
      issues.push({
        code: 'evidence.trace_mismatch',
        path: `${path}/trace_id`,
        message: 'Evidence must remain on the origin trace.'
      })
    }

    appendPolicyDecision(
      issues,
      path,
      evaluateEvidenceForRoute(
        observation,
        envelope.identity,
        envelope.routing,
        referenceTime
      )
    )
  }

  const evidenceById = new Set(
    envelope.evidence.map((observation) => observation.evidence_id)
  )

  for (const evidenceRef of envelope.response.evidence_refs) {
    if (!evidenceById.has(evidenceRef)) {
      issues.push({
        code: 'response.evidence_reference_missing',
        path: '/response/evidence_refs',
        message: `Response evidence reference ${evidenceRef} is not present in the envelope.`
      })
    }
  }

  const currentStateDecision = evaluateCurrentStateEvidenceSet(
    envelope.evidence,
    envelope.identity,
    envelope.routing,
    referenceTime
  )

  if (!currentStateDecision.allowed) {
    const isExplicitLimitation =
      envelope.response.evidence_refs.length === 0 &&
      envelope.response.limitations.length > 0

    if (!isExplicitLimitation) {
      appendPolicyDecision(
        issues,
        '/response',
        currentStateDecision
      )
    }
  }
}

function validateEscalation(
  envelope: VerticalSliceEnvelope,
  issues: ValidationIssue[]
): void {
  if (
    envelope.routing.server_escalation_required &&
    !envelope.routing.server_escalation_reason
  ) {
    issues.push({
      code: 'routing.escalation_reason_missing',
      path: '/routing/server_escalation_reason',
      message: 'Server escalation requires a structured reason.'
    })
  }

  if (
    !envelope.routing.server_escalation_required &&
    envelope.routing.server_escalation_reason
  ) {
    issues.push({
      code: 'routing.unexpected_escalation_reason',
      path: '/routing/server_escalation_reason',
      message: 'A non-escalated route must not claim an escalation reason.'
    })
  }
}

function validateActionLifecycle(
  envelope: VerticalSliceEnvelope,
  issues: ValidationIssue[]
): void {
  if (!envelope.action) {
    if (envelope.approval) {
      issues.push({
        code: 'approval.action_missing',
        path: '/approval',
        message: 'An approval cannot exist without an action proposal.'
      })
    }

    if (envelope.receipt) {
      issues.push({
        code: 'receipt.action_missing',
        path: '/receipt',
        message: 'A verification receipt cannot exist without an action proposal.'
      })
    }

    return
  }

  if (envelope.action.trace_id !== envelope.origin.trace_id) {
    issues.push({
      code: 'action.trace_mismatch',
      path: '/action/trace_id',
      message: 'The action proposal must remain on the origin trace.'
    })
  }

  appendPolicyDecision(
    issues,
    '/action',
    evaluateActionProposal(
      envelope.action,
      envelope.identity,
      envelope.approval
    )
  )

  if (
    (envelope.action.status === 'succeeded' ||
      envelope.action.status === 'failed' ||
      envelope.action.status === 'rolled_back') &&
    !envelope.receipt
  ) {
    issues.push({
      code: 'action.receipt_missing',
      path: '/receipt',
      message: 'A completed action lifecycle requires a verification receipt.'
    })
  }

  if (envelope.receipt) {
    appendPolicyDecision(
      issues,
      '/receipt',
      evaluateVerificationReceipt(envelope.action, envelope.receipt)
    )
  }
}

function validateMemoryCandidate(
  envelope: VerticalSliceEnvelope,
  issues: ValidationIssue[]
): void {
  const candidate = envelope.memory_candidate
  if (!candidate) {
    return
  }

  if (candidate.trace_id !== envelope.origin.trace_id) {
    issues.push({
      code: 'memory.trace_mismatch',
      path: '/memory_candidate/trace_id',
      message: 'The memory candidate must remain on the origin trace.'
    })
  }

  if (candidate.owner_id !== envelope.identity.owner_id) {
    issues.push({
      code: 'memory.owner_mismatch',
      path: '/memory_candidate/owner_id',
      message: 'The memory candidate must belong to the authenticated owner.'
    })
  }
}

function validateOperationalStateEvents(
  envelope: VerticalSliceEnvelope,
  issues: ValidationIssue[]
): void {
  appendPolicyDecision(
    issues,
    '/operational_states',
    evaluateOperationalStates(
      envelope.operational_states,
      envelope.spans,
      envelope.origin.trace_id
    )
  )
}

export function validateVerticalSliceEnvelope(
  value: unknown,
  referenceTime = new Date()
): VerticalSliceValidationResult {
  if (!validateSchema(value)) {
    return {
      valid: false,
      issues: (validateSchema.errors || []).map(schemaIssue)
    }
  }

  const envelope = value
  const issues: ValidationIssue[] = []

  validateIdentityAndTrace(envelope, issues)
  validateEvidence(envelope, referenceTime, issues)
  validateEscalation(envelope, issues)
  validateActionLifecycle(envelope, issues)
  validateMemoryCandidate(envelope, issues)
  validateOperationalStateEvents(envelope, issues)

  if (issues.length > 0) {
    return {
      valid: false,
      issues
    }
  }

  return {
    valid: true,
    envelope,
    issues: []
  }
}