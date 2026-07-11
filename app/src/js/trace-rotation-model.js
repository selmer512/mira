const KEY_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function isKeyVersionValid(value) {
  return KEY_VERSION_PATTERN.test(String(value || ''))
}

export function formatBytes(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return 'unavailable'
  }
  const bytes = Math.max(0, Number(value))
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let amount = bytes
  let index = -1
  do {
    amount /= 1024
    index += 1
  } while (amount >= 1024 && index < units.length - 1)
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[index]}`
}

export function storageAssessment(plan) {
  const available = plan.available_free_bytes
  if (available === null || available === undefined) {
    return {
      status: 'unknown',
      label: 'Storage headroom unavailable',
      detail: `${formatBytes(plan.required_free_bytes)} required by the current plan.`
    }
  }
  const sufficient = Number(available) >= Number(plan.required_free_bytes)
  return {
    status: sufficient ? 'ready' : 'blocked',
    label: sufficient ? 'Storage headroom available' : 'Insufficient storage headroom',
    detail: `${formatBytes(available)} available; ${formatBytes(
      plan.required_free_bytes
    )} required.`
  }
}

export function backupAssessment(backup) {
  const labels = {
    verified: 'Backup verified',
    missing: 'Backup missing',
    invalid: 'Backup invalid',
    not_configured: 'Backup not configured'
  }
  return {
    status: backup.status === 'verified' ? 'ready' : 'blocked',
    label: labels[backup.status] || `Backup ${backup.status}`,
    detail:
      backup.status === 'verified'
        ? `${formatBytes(backup.size_bytes)} · integrity ${backup.integrity_check}`
        : backup.issue || 'Backup evidence is not ready.'
  }
}

export function buildRotationPlanReview(plan) {
  if (!plan || typeof plan !== 'object') {
    throw new Error('Rotation plan is missing.')
  }
  if (plan.execution_supported !== false || plan.ready_for_execution !== false) {
    throw new Error('The server returned an unsafe executable rotation plan.')
  }
  if (!isKeyVersionValid(plan.target_key_version)) {
    throw new Error('The target key version is invalid.')
  }
  if (!Array.isArray(plan.trace_ids) || !Array.isArray(plan.record_hashes)) {
    throw new Error('The exact trace scope is invalid.')
  }
  if (plan.trace_ids.length !== plan.record_hashes.length) {
    throw new Error('The exact trace and record-hash scope does not match.')
  }
  if (!Array.isArray(plan.blockers)) {
    throw new Error('Rotation blockers are missing.')
  }
  return {
    planId: plan.rotation_plan_id,
    planHash: plan.plan_hash,
    targetVersion: plan.target_key_version,
    targetKeyId: plan.target_encryption_key_id,
    sourceVersions: [...plan.source_key_versions],
    traceIds: [...plan.trace_ids],
    operationPlanIds: [...plan.operation_plan_ids],
    recordHashes: [...plan.record_hashes],
    traceCount: plan.trace_count,
    operationPlanCount: plan.operation_plan_count,
    estimatedRewriteBytes: plan.estimated_rewrite_bytes,
    requiredFreeBytes: plan.required_free_bytes,
    availableFreeBytes: plan.available_free_bytes,
    backup: { ...plan.backup },
    storage: storageAssessment(plan),
    backupStatus: backupAssessment(plan.backup),
    checkpoints: [...plan.interruption_checkpoints],
    verificationCriteria: [...plan.verification_criteria],
    rollbackLimits: [...plan.rollback_limits],
    blockers: [...plan.blockers],
    createdAt: plan.created_at,
    expiresAt: plan.expires_at,
    executionSupported: false,
    readyForExecution: false
  }
}
