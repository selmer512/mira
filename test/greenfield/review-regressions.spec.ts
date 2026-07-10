import { describe, expect, it } from 'vitest'

import {
  evaluateActionProposal,
  evaluateVerificationReceipt,
  type ActionApproval,
  type ActionProposal,
  type IdentityContext,
  type VerificationReceipt
} from '@/core/greenfield'

const identity: IdentityContext = {
  owner_id: 'owner-1',
  device_id: 'device-1',
  auth_session_id: 'session-1',
  authenticated_at: '2026-07-10T17:00:00.000Z',
  trust_level: 'trusted',
  permissions: ['system.status.read'],
  privacy_zones: ['private']
}

function action(status: ActionProposal['status'] = 'proposed'): ActionProposal {
  return {
    action_id: 'action-1',
    trace_id: 'trace-1',
    capability: 'system.status.read',
    risk: 'low',
    required_permissions: ['system.status.read'],
    confirmation_required: false,
    requested_by_owner_id: 'owner-1',
    requested_by_device_id: 'device-1',
    auth_session_id: 'session-1',
    arguments_ref: 'encrypted://action/arguments',
    expected_result: 'Current system status is returned.',
    verification: {
      method: 'runtime-readback',
      criteria: ['A current runtime observation exists.'],
      external_source_required: false
    },
    rollback: {
      supported: false,
      method: null,
      limitations: ['Read-only operation.']
    },
    status
  }
}

function approval(overrides: Partial<ActionApproval> = {}): ActionApproval {
  return {
    approval_id: 'approval-1',
    action_id: 'action-1',
    trace_id: 'trace-1',
    owner_id: 'owner-1',
    auth_session_id: 'session-1',
    decision: 'approved',
    decided_at: '2026-07-10T17:00:01.000Z',
    ...overrides
  }
}

function receipt(
  overrides: Partial<VerificationReceipt> = {}
): VerificationReceipt {
  return {
    receipt_id: 'receipt-1',
    action_id: 'action-1',
    trace_id: 'trace-1',
    requested_action: 'Read current system status.',
    actor_ref: 'identity://owner-1',
    executor_ref: 'runtime://mira',
    input_ref: 'encrypted://action/arguments',
    approval_ref: null,
    execution_status: 'succeeded',
    output_ref: 'runtime://status/1',
    verification_method: 'runtime-readback',
    verification_status: 'succeeded',
    verification_evidence_refs: ['evidence-1'],
    executed_at: '2026-07-10T17:00:02.000Z',
    verified_at: '2026-07-10T17:00:02.100Z',
    failure_ref: null,
    rollback_status: 'not_required',
    ...overrides
  }
}

describe('greenfield review regressions', () => {
  it('validates an attached approval even when approval is optional', () => {
    const result = evaluateActionProposal(
      action(),
      identity,
      approval({ owner_id: 'different-owner' })
    )

    expect(result.allowed).toBe(false)
    expect(result.code).toBe('action.approval_mismatch')
  })

  it('rejects a successful receipt for a non-succeeded action', () => {
    const result = evaluateVerificationReceipt(action('executing'), receipt())

    expect(result.allowed).toBe(false)
    expect(result.code).toBe('receipt.status_mismatch')
  })
})
