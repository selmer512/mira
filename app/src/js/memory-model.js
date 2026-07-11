const REASON_CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function isMemoryReasonCodeValid(value) {
  return REASON_CODE_PATTERN.test(value)
}

export function formatMemoryRemaining(expiresAt, referenceTime = Date.now()) {
  const expiresAtMs = Date.parse(expiresAt)
  if (!Number.isFinite(expiresAtMs)) return 'invalid expiry'
  const remaining = expiresAtMs - referenceTime
  if (remaining <= 0) return 'expired'
  const seconds = Math.ceil(remaining / 1_000)
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes > 0
    ? `${minutes}m ${remainder}s remaining`
    : `${remainder}s remaining`
}

export function buildMemoryCandidateReview(
  candidate,
  content,
  persistence,
  referenceTime = Date.now()
) {
  return {
    candidateId: candidate.candidate_id,
    traceId: candidate.trace_id,
    memoryClass: candidate.memory_class,
    temporalStatus: candidate.temporal_status,
    title: candidate.title,
    content,
    sourceRefs: [...candidate.source_refs],
    confidence: candidate.confidence,
    salience: candidate.salience,
    privacyZone: candidate.privacy_zone,
    retentionPolicy: candidate.retention_policy,
    derivationLinks: [...candidate.derivation_links],
    contradictionLinks: [...candidate.contradiction_links],
    supersessionLinks: [...candidate.supersession_links],
    recordHash: persistence.record_hash,
    contentHash: persistence.content_hash,
    createdAt: persistence.created_at,
    expiresAt: persistence.expires_at,
    expiryLabel: formatMemoryRemaining(persistence.expires_at, referenceTime),
    expired: Date.parse(persistence.expires_at) <= referenceTime,
    confirmationRequired: persistence.confirmation_required === true
  }
}

export function getMemoryTimeScopePresentation(timeScope) {
  if (timeScope === 'current') {
    return {
      allowed: false,
      label: 'Fresh evidence required',
      warning:
        'Durable memory cannot establish present-world state. Mira must retrieve fresh source evidence instead.'
    }
  }
  if (timeScope === 'prospective') {
    return {
      allowed: true,
      label: 'Prospective memory',
      warning:
        'Prospective records describe plans or expected future events, not verified completion.'
    }
  }
  if (timeScope === 'historical') {
    return {
      allowed: true,
      label: 'Historical memory',
      warning:
        'Historical memory explains prior events and preferences; it does not prove current state.'
    }
  }
  return {
    allowed: true,
    label: 'Atemporal memory',
    warning:
      'Atemporal retrieval is suitable for stable owner preferences and concepts, subject to provenance and confirmation.'
  }
}

export function buildMemoryPurgeReview(plan, referenceTime = Date.now()) {
  return {
    planId: plan.plan_id,
    actionId: plan.action_id,
    traceId: plan.trace_id,
    risk: plan.risk,
    memoryIds: [...plan.memory_ids],
    recordHashes: [...plan.record_hashes],
    scopeHash: plan.scope_hash,
    reasonCode: plan.reason_code,
    createdAt: plan.created_at,
    expiresAt: plan.expires_at,
    expiryLabel: formatMemoryRemaining(plan.expires_at, referenceTime),
    expired: Date.parse(plan.expires_at) <= referenceTime,
    verificationCriteria: [...plan.verification_criteria],
    rollbackSupported: plan.rollback_supported,
    rollbackLimitations: [...plan.rollback_limitations],
    planHash: plan.plan_hash
  }
}

export function memoryReceiptEvidenceRows(receipt) {
  if (!receipt) return []
  return [
    ['Execution', receipt.execution_status],
    ['Verification', receipt.verification_status],
    ['Records', String(receipt.record_count)],
    ['Scope hash', receipt.scope_hash],
    ['Reason', receipt.reason_code],
    ['Receipt hash', receipt.receipt_hash],
    ['Executed', receipt.executed_at],
    ['Verified', receipt.verified_at],
    ['Rollback', receipt.rollback_status]
  ]
}

export function isVerifiedMemoryPurgeReceipt(receipt) {
  return Boolean(
    receipt &&
      receipt.execution_status === 'succeeded' &&
      receipt.verification_status === 'succeeded'
  )
}

export function parseReferenceList(value) {
  return [
    ...new Set(
      String(value || '')
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  ]
}

export function formatMemoryRecordSummary(record) {
  return {
    id: record.memory_id,
    title: record.title,
    content: record.content,
    classification: `${record.memory_class} · ${record.temporal_status}`,
    observedAt: record.observed_at,
    provenance: [...record.source_refs],
    confidence: record.confidence,
    salience: record.salience,
    recordHash: record.record_hash,
    supersedes: [...record.supersedes],
    contradicts: [...record.contradicts],
    derivedFrom: [...record.derived_from],
    projectionStatus: record.projection_status
  }
}
