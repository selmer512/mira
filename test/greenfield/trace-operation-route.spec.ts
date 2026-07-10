import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

import {
  GreenfieldExecutionError,
  TRACE_EXPORT_CAPABILITY,
  TRACE_PURGE_CAPABILITY,
  TraceOperationExecutionError,
  type IdentityResolver,
  type TraceOperationApproval,
  type TraceOperationPlan,
  type TraceOperationReceipt,
  type TraceOperationService
} from '@/core/greenfield'
import { createTraceOperationsRoute } from '@/core/http-server/api/greenfield/trace-operations'

const PLAN: TraceOperationPlan = {
  plan_id: 'plan-1',
  action_id: 'action-1',
  trace_id: 'operation-trace-1',
  operation: 'export',
  capability: TRACE_EXPORT_CAPABILITY,
  risk: 'high',
  scope_hash: 'a'.repeat(64),
  trace_count: 1,
  reason_code: 'owner_requested_export',
  requested_by_owner_ref: 'owner:abc',
  requested_by_device_ref: 'device:def',
  auth_session_ref: 'session:ghi',
  confirmation_required: true,
  verification_criteria: ['Verify the exact scope.'],
  rollback_supported: false,
  created_at: '2026-07-10T21:00:00.000Z',
  expires_at: '2026-07-10T21:05:00.000Z'
}

const APPROVAL: TraceOperationApproval = {
  approval_id: 'approval-1',
  plan_id: PLAN.plan_id,
  action_id: PLAN.action_id,
  trace_id: PLAN.trace_id,
  owner_ref: PLAN.requested_by_owner_ref,
  device_ref: PLAN.requested_by_device_ref,
  auth_session_ref: PLAN.auth_session_ref,
  scope_hash: PLAN.scope_hash,
  decision: 'approved',
  decided_at: '2026-07-10T21:01:00.000Z'
}

const RECEIPT: TraceOperationReceipt = {
  receipt_id: 'receipt-1',
  plan_id: PLAN.plan_id,
  action_id: PLAN.action_id,
  trace_id: PLAN.trace_id,
  operation: 'export',
  requested_action: TRACE_EXPORT_CAPABILITY,
  actor_ref: PLAN.requested_by_owner_ref,
  executor_ref: 'mira:trace-owner-operation-service:v1',
  approval_id: APPROVAL.approval_id,
  execution_status: 'succeeded',
  verification_status: 'succeeded',
  verification_evidence_refs: ['record-hash-1'],
  output_hash: 'b'.repeat(64),
  purge_receipt_id: null,
  record_count: 1,
  executed_at: '2026-07-10T21:02:00.000Z',
  verified_at: '2026-07-10T21:02:01.000Z',
  failure_code: null,
  receipt_hash: 'c'.repeat(64)
}

function identityResolver(): IdentityResolver {
  return {
    resolve: async (input) => {
      if (input.deviceId !== 'device-1') {
        throw new GreenfieldExecutionError(
          'identity.device_not_paired',
          'Device is not paired.',
          403
        )
      }
      return {
        owner_id: 'owner-1',
        device_id: 'device-1',
        auth_session_id: 'session-1',
        authenticated_at: input.authenticatedAt.toISOString(),
        trust_level: 'paired',
        permissions: [TRACE_EXPORT_CAPABILITY, TRACE_PURGE_CAPABILITY],
        privacy_zones: ['private']
      }
    }
  }
}

function service(): TraceOperationService {
  return {
    createPlan: vi.fn(async () => ({
      plan: PLAN,
      approval_token: 'x'.repeat(43)
    })),
    approve: vi.fn(async () => APPROVAL),
    execute: vi.fn(async () => ({
      receipt: RECEIPT,
      export_bundle: {
        version: 1,
        plan_id: PLAN.plan_id,
        action_id: PLAN.action_id,
        trace_id: PLAN.trace_id,
        owner_id: 'owner-1',
        scope_hash: PLAN.scope_hash,
        exported_at: RECEIPT.executed_at,
        records: [],
        bundle_hash: RECEIPT.output_hash!
      }
    }))
  }
}

describe('owner-authorized trace operation routes', () => {
  it('creates a scoped plan through an authenticated paired device', async () => {
    const fastify = Fastify()
    const operationService = service()
    await fastify.register(
      createTraceOperationsRoute(identityResolver(), operationService),
      { apiVersion: 'v1' }
    )

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/trace-operations/plan',
      headers: { 'x-api-key': 'test-key' },
      payload: {
        device_id: 'device-1',
        operation: 'export',
        trace_ids: ['trace-1'],
        reason_code: 'owner_requested_export'
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({
      success: true,
      plan: PLAN,
      approval_token: 'x'.repeat(43)
    })
    expect(operationService.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'export',
        traceIds: ['trace-1'],
        reasonCode: 'owner_requested_export'
      })
    )
    await fastify.close()
  })

  it('strips or rejects undeclared trust fields before planning', async () => {
    const fastify = Fastify()
    const operationService = service()
    await fastify.register(
      createTraceOperationsRoute(identityResolver(), operationService),
      { apiVersion: 'v1' }
    )

    const response = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/trace-operations/plan',
      headers: { 'x-api-key': 'test-key' },
      payload: {
        device_id: 'device-1',
        operation: 'purge',
        trace_ids: ['trace-1'],
        owner_id: 'attacker-owner',
        approved: true
      }
    })

    expect([200, 400]).toContain(response.statusCode)
    if (response.statusCode === 200) {
      expect(operationService.createPlan).toHaveBeenCalledWith(
        expect.not.objectContaining({ owner_id: 'attacker-owner' })
      )
    } else {
      expect(operationService.createPlan).not.toHaveBeenCalled()
    }
    await fastify.close()
  })

  it('records approval and returns a verified execution receipt', async () => {
    const fastify = Fastify()
    const operationService = service()
    await fastify.register(
      createTraceOperationsRoute(identityResolver(), operationService),
      { apiVersion: 'v1' }
    )

    const approvalResponse = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/trace-operations/approve',
      headers: { 'x-api-key': 'test-key' },
      payload: {
        device_id: 'device-1',
        plan_id: PLAN.plan_id,
        approval_token: 'x'.repeat(43),
        decision: 'approved'
      }
    })
    expect(approvalResponse.statusCode).toBe(200)
    expect(approvalResponse.json()).toEqual({
      success: true,
      approval: APPROVAL
    })

    const executeResponse = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/trace-operations/execute',
      headers: { 'x-api-key': 'test-key' },
      payload: {
        device_id: 'device-1',
        plan_id: PLAN.plan_id
      }
    })
    expect(executeResponse.statusCode).toBe(200)
    expect(executeResponse.json()).toMatchObject({
      success: true,
      receipt: RECEIPT,
      export_bundle: { bundle_hash: RECEIPT.output_hash }
    })
    await fastify.close()
  })

  it('rejects an unpaired device and preserves typed execution failures', async () => {
    const fastify = Fastify()
    const operationService = service()
    operationService.execute = vi.fn(async () => {
      throw new TraceOperationExecutionError(
        'trace_operation.owner_rejected',
        'The owner rejected this operation.',
        409
      )
    })
    await fastify.register(
      createTraceOperationsRoute(identityResolver(), operationService),
      { apiVersion: 'v1' }
    )

    const unpaired = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/trace-operations/execute',
      headers: { 'x-api-key': 'test-key' },
      payload: { device_id: 'attacker', plan_id: PLAN.plan_id }
    })
    expect(unpaired.statusCode).toBe(403)
    expect(operationService.execute).not.toHaveBeenCalled()

    const rejected = await fastify.inject({
      method: 'POST',
      url: '/api/v1/greenfield/trace-operations/execute',
      headers: { 'x-api-key': 'test-key' },
      payload: { device_id: 'device-1', plan_id: PLAN.plan_id }
    })
    expect(rejected.statusCode).toBe(409)
    expect(rejected.json()).toMatchObject({
      success: false,
      code: 'trace_operation.owner_rejected'
    })
    await fastify.close()
  })
})
