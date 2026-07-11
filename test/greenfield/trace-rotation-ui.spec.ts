import { describe, expect, it } from 'vitest'

import {
  backupAssessment,
  buildRotationPlanReview,
  formatBytes,
  isKeyVersionValid,
  storageAssessment
} from '../../app/src/js/trace-rotation-model.js'

function plan(overrides = {}) {
  return {
    rotation_plan_id: 'rotation-plan-1',
    target_key_version: 'v2',
    target_encryption_key_id: '0123456789abcdef',
    source_key_versions: ['v1'],
    trace_count: 1,
    operation_plan_count: 1,
    trace_ids: ['trace-1'],
    operation_plan_ids: ['operation-plan-1'],
    record_hashes: ['a'.repeat(64)],
    estimated_rewrite_bytes: 1024,
    required_free_bytes: 4096,
    available_free_bytes: 8192,
    backup: {
      status: 'verified',
      path_ref: 'backup:abcdef',
      size_bytes: 4096,
      integrity_check: 'ok',
      migration_versions: [1, 2, 3, 4],
      trace_count: 1,
      operation_plan_count: 1,
      verified_at: '2026-07-11T01:30:00.000Z',
      issue: null
    },
    interruption_checkpoints: ['checkpoint'],
    verification_criteria: ['verify'],
    rollback_limits: ['limit'],
    blockers: ['rotation.reencryption_executor_not_implemented'],
    execution_supported: false,
    ready_for_execution: false,
    created_at: '2026-07-11T01:30:00.000Z',
    expires_at: '2026-07-11T01:45:00.000Z',
    plan_hash: 'b'.repeat(64),
    ...overrides
  }
}

describe('trace rotation UI model', () => {
  it('accepts stable lowercase key versions only', () => {
    expect(isKeyVersionValid('v2')).toBe(true)
    expect(isKeyVersionValid('owner-key_2026.07')).toBe(true)
    expect(isKeyVersionValid('V2')).toBe(false)
    expect(isKeyVersionValid('../secret')).toBe(false)
  })

  it('formats storage evidence without inventing unavailable capacity', () => {
    expect(formatBytes(1024)).toBe('1.00 KiB')
    expect(formatBytes(null)).toBe('unavailable')
  })

  it('reports verified backup evidence and sufficient storage', () => {
    expect(backupAssessment(plan().backup)).toMatchObject({
      status: 'ready',
      label: 'Backup verified'
    })
    expect(storageAssessment(plan())).toMatchObject({
      status: 'ready',
      label: 'Storage headroom available'
    })
  })

  it('reports missing backup and insufficient storage as blocked', () => {
    expect(
      backupAssessment({
        ...plan().backup,
        status: 'missing',
        issue: 'Backup file is absent.'
      })
    ).toEqual({
      status: 'blocked',
      label: 'Backup missing',
      detail: 'Backup file is absent.'
    })
    expect(
      storageAssessment({
        ...plan(),
        available_free_bytes: 1024,
        required_free_bytes: 4096
      })
    ).toMatchObject({
      status: 'blocked',
      label: 'Insufficient storage headroom'
    })
  })

  it('builds an exact immutable planning-only review', () => {
    const review = buildRotationPlanReview(plan())

    expect(review.traceIds).toEqual(['trace-1'])
    expect(review.operationPlanIds).toEqual(['operation-plan-1'])
    expect(review.recordHashes).toEqual(['a'.repeat(64)])
    expect(review.executionSupported).toBe(false)
    expect(review.readyForExecution).toBe(false)
    expect(review.blockers).toContain(
      'rotation.reencryption_executor_not_implemented'
    )
  })

  it('rejects executable or mismatched server plans', () => {
    expect(() =>
      buildRotationPlanReview(plan({ execution_supported: true }))
    ).toThrow(/unsafe executable/)
    expect(() =>
      buildRotationPlanReview(plan({ record_hashes: [] }))
    ).toThrow(/scope does not match/)
  })
})
