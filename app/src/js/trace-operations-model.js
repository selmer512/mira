const REASON_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/

export function isReasonCodeValid(value) {
  return value === '' || REASON_CODE_PATTERN.test(value)
}

export function formatRemaining(expiresAt, referenceTime = Date.now()) {
  const expiresAtMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresAtMs)) {
    return 'invalid expiry'
  }
  const remaining = expiresAtMs - referenceTime
  if (remaining <= 0) {
    return 'expired'
  }
  const totalSeconds = Math.ceil(remaining / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${seconds}s remaining` : `${seconds}s remaining`
}

export function getOperationPresentation(operation) {
  if (operation === 'purge') {
    return {
      title: 'Permanently purge selected traces',
      risk: 'critical',
      warning:
        'This physically deletes the exact selected traces. The operation cannot be undone. A backup restore is not implemented.',
      approveLabel: 'Approve irreversible purge',
      executeLabel: 'Purge selected traces'
    }
  }
  return {
    title: 'Export selected traces',
    risk: 'high',
    warning:
      'The verified export contains private trace data. Store and share the downloaded file carefully.',
    approveLabel: 'Approve export',
    executeLabel: 'Export selected traces'
  }
}

export function buildPlanReview(plan, selectedTraceIds, referenceTime = Date.now()) {
  const traceIds = [...selectedTraceIds]
  return {
    planId: plan.plan_id,
    operation: plan.operation,
    risk: plan.risk,
    scopeHash: plan.scope_hash,
    traceCount: plan.trace_count,
    traceIds,
    createdAt: plan.created_at,
    expiresAt: plan.expires_at,
    expiryLabel: formatRemaining(plan.expires_at, referenceTime),
    expired: Date.parse(plan.expires_at) <= referenceTime,
    verificationCriteria: [...plan.verification_criteria],
    rollbackSupported: plan.rollback_supported
  }
}

export function receiptEvidenceRows(receipt) {
  if (!receipt) {
    return []
  }
  return [
    ['Execution', receipt.execution_status],
    ['Verification', receipt.verification_status],
    ['Records', String(receipt.record_count)],
    ['Receipt hash', receipt.receipt_hash],
    ['Output hash', receipt.output_hash || 'none'],
    ['Purge receipt', receipt.purge_receipt_id || 'none'],
    ['Executed', receipt.executed_at],
    ['Verified', receipt.verified_at]
  ]
}

export function rotationStatusSummary(readiness) {
  if (!readiness) {
    return {
      label: 'Not checked',
      detail: 'Connect to load current key and trace evidence.'
    }
  }
  if (readiness.status === 'blocked') {
    return {
      label: 'Rotation blocked',
      detail: `${readiness.blockers.length} deterministic blocker${
        readiness.blockers.length === 1 ? '' : 's'
      } remain.`
    }
  }
  if (readiness.status === 'attention_required') {
    return {
      label: 'Attention required',
      detail: `${readiness.warnings.length} warning${
        readiness.warnings.length === 1 ? '' : 's'
      } should be resolved before rotation.`
    }
  }
  return {
    label: 'Data ready',
    detail:
      'The current inventory is internally consistent. Rotation execution is still unavailable unless explicitly supported.'
  }
}
