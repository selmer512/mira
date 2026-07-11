import { describe, expect, it } from 'vitest'

import {
  buildPlanReview,
  formatRemaining,
  getOperationPresentation,
  isReasonCodeValid,
  receiptEvidenceRows,
  rotationStatusSummary
} from '../../app/src/js/trace-operations-model.js'

describe('trace operations UI model', () => {
  it('formats real plan expiry without inventing completion state', () => {
    expect(
      formatRemaining(
        '2026-07-10T23:05:30.000Z',
        Date.parse('2026-07-10T23:00:00.000Z')
      )
    ).toBe('5m 30s remaining')
    expect(
      formatRemaining(
        '2026-07-10T22:59:59.000Z',
        Date.parse('2026-07-10T23:00:00.000Z')
      )
    ).toBe('expired')
  })

  it('uses explicit critical and irreversible language for purge', () => {
    const presentation = getOperationPresentation('purge')
    expect(presentation.risk).toBe('critical')
    expect(presentation.warning).toMatch(/cannot be undone/i)
    expect(presentation.approveLabel).toMatch(/irreversible/i)
  })

  it('builds an exact immutable plan review', () => {
    const review = buildPlanReview(
      {
        plan_id: 'plan-1',
        operation: 'export',
        risk: 'high',
        scope_hash: 'scope-hash',
        trace_count: 2,
        created_at: '2026-07-10T23:00:00.000Z',
        expires_at: '2026-07-10T23:05:00.000Z',
        verification_criteria: ['exact traces', 'valid bundle hash'],
        rollback_supported: false
      },
      ['trace-1', 'trace-2'],
      Date.parse('2026-07-10T23:00:00.000Z')
    )

    expect(review).toMatchObject({
      planId: 'plan-1',
      traceCount: 2,
      traceIds: ['trace-1', 'trace-2'],
      risk: 'high',
      expired: false,
      rollbackSupported: false
    })
  })

  it('validates stable reason codes without silently rewriting them', () => {
    expect(isReasonCodeValid('owner_requested_export')).toBe(true)
    expect(isReasonCodeValid('')).toBe(true)
    expect(isReasonCodeValid('Owner Requested Export')).toBe(false)
    expect(isReasonCodeValid('../unsafe')).toBe(false)
  })

  it('shows only receipt-backed verification evidence', () => {
    const rows = receiptEvidenceRows({
      execution_status: 'succeeded',
      verification_status: 'succeeded',
      record_count: 2,
      receipt_hash: 'receipt-hash',
      output_hash: 'output-hash',
      purge_receipt_id: null,
      executed_at: '2026-07-10T23:01:00.000Z',
      verified_at: '2026-07-10T23:01:01.000Z'
    })
    expect(rows).toContainEqual(['Verification', 'succeeded'])
    expect(rows).toContainEqual(['Receipt hash', 'receipt-hash'])
    expect(receiptEvidenceRows(null)).toEqual([])
  })

  it('does not present blocked rotation as ready', () => {
    expect(
      rotationStatusSummary({
        status: 'blocked',
        blockers: ['one', 'two'],
        warnings: []
      })
    ).toEqual({
      label: 'Rotation blocked',
      detail: '2 deterministic blockers remain.'
    })
  })
})
