import fs from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  buildMemoryCandidateReview,
  buildMemoryPurgeReview,
  formatMemoryRemaining,
  getMemoryTimeScopePresentation,
  isMemoryReasonCodeValid,
  isVerifiedMemoryPurgeReceipt,
  memoryReceiptEvidenceRows,
  parseReferenceList
} from '../../app/src/js/memory-model.js'

describe('memory owner UI model', () => {
  it('keeps a candidate pending and exposes exact provenance and expiry', () => {
    const review = buildMemoryCandidateReview(
      {
        candidate_id: 'candidate-1',
        trace_id: 'trace-1',
        memory_class: 'semantic',
        temporal_status: 'historical',
        title: 'Owner preference',
        source_refs: ['owner://statement/1'],
        confidence: 1,
        salience: 0.8,
        privacy_zone: 'private',
        retention_policy: 'owner_confirmed',
        derivation_links: [],
        contradiction_links: [],
        supersession_links: []
      },
      'The owner preferred the window seat.',
      {
        record_hash: 'a'.repeat(64),
        content_hash: 'b'.repeat(64),
        created_at: '2026-07-11T17:00:00.000Z',
        expires_at: '2026-07-11T17:15:00.000Z',
        confirmation_required: true
      },
      Date.parse('2026-07-11T17:00:00.000Z')
    )

    expect(review).toMatchObject({
      candidateId: 'candidate-1',
      traceId: 'trace-1',
      confirmationRequired: true,
      expired: false,
      expiryLabel: '15m 0s remaining'
    })
    expect(review.sourceRefs).toEqual(['owner://statement/1'])
  })

  it('never presents durable memory as current-state evidence', () => {
    expect(getMemoryTimeScopePresentation('current')).toMatchObject({
      allowed: false,
      label: 'Fresh evidence required'
    })
    expect(getMemoryTimeScopePresentation('current').warning).toMatch(
      /fresh source evidence/i
    )
    expect(getMemoryTimeScopePresentation('historical').allowed).toBe(true)
  })

  it('builds an exact critical purge review with irreversible limits', () => {
    const review = buildMemoryPurgeReview(
      {
        plan_id: 'plan-1',
        action_id: 'action-1',
        trace_id: 'trace-1',
        risk: 'critical',
        memory_ids: ['memory-1', 'memory-2'],
        record_hashes: ['a'.repeat(64), 'b'.repeat(64)],
        scope_hash: 'scope-hash',
        reason_code: 'owner_requested_forget',
        created_at: '2026-07-11T17:00:00.000Z',
        expires_at: '2026-07-11T17:05:00.000Z',
        verification_criteria: ['canonical absence', 'projection absence'],
        rollback_supported: false,
        rollback_limitations: ['Physical purge is irreversible.'],
        plan_hash: 'c'.repeat(64)
      },
      Date.parse('2026-07-11T17:00:00.000Z')
    )

    expect(review).toMatchObject({
      planId: 'plan-1',
      risk: 'critical',
      memoryIds: ['memory-1', 'memory-2'],
      rollbackSupported: false,
      expired: false
    })
    expect(review.rollbackLimitations.join(' ')).toMatch(/irreversible/i)
  })

  it('requires receipt-backed execution and verification for purge success', () => {
    const receipt = {
      execution_status: 'succeeded',
      verification_status: 'succeeded',
      record_count: 2,
      scope_hash: 'scope-hash',
      reason_code: 'owner_requested_forget',
      receipt_hash: 'receipt-hash',
      executed_at: '2026-07-11T17:01:00.000Z',
      verified_at: '2026-07-11T17:01:01.000Z',
      rollback_status: 'unavailable'
    }
    expect(isVerifiedMemoryPurgeReceipt(receipt)).toBe(true)
    expect(
      isVerifiedMemoryPurgeReceipt({
        ...receipt,
        verification_status: 'failed'
      })
    ).toBe(false)
    expect(memoryReceiptEvidenceRows(receipt)).toContainEqual([
      'Receipt hash',
      'receipt-hash'
    ])
  })

  it('validates stable reason codes and exact reference lists', () => {
    expect(isMemoryReasonCodeValid('owner_requested_forget')).toBe(true)
    expect(isMemoryReasonCodeValid('Owner requested forget')).toBe(false)
    expect(isMemoryReasonCodeValid('../unsafe')).toBe(false)
    expect(parseReferenceList('one, two\none')).toEqual(['one', 'two'])
    expect(
      formatMemoryRemaining(
        '2026-07-11T17:00:00.000Z',
        Date.parse('2026-07-11T17:00:01.000Z')
      )
    ).toBe('expired')
  })

  it('keeps credentials and approval challenges out of browser persistence', () => {
    const source = fs.readFileSync(
      'app/src/js/memory-panel.js',
      'utf8'
    )

    expect(source).not.toContain('localStorage')
    expect(source).not.toContain('sessionStorage')
    expect(source).not.toContain('document.cookie')
    expect(source).toContain("state.apiKey = ''")
    expect(source).toContain('state.candidateApprovalToken = null')
    expect(source).toContain('state.purgeApprovalToken = null')
    expect(source).toContain("data-action=\"approve-purge\"")
    expect(source).toContain("data-action=\"execute-purge\"")
    expect(source).toContain('textContent')
  })
})
