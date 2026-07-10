import { Type, type Static } from '@sinclair/typebox'

export const TRACE_EXPORT_CAPABILITY = 'trace.export'
export const TRACE_PURGE_CAPABILITY = 'trace.purge'

export const TraceOperationSchema = Type.Union([
  Type.Literal('export'),
  Type.Literal('purge')
])

export type TraceOperation = Static<typeof TraceOperationSchema>

export const TraceOperationPlanSchema = Type.Object(
  {
    plan_id: Type.String({ minLength: 1 }),
    action_id: Type.String({ minLength: 1 }),
    trace_id: Type.String({ minLength: 1 }),
    operation: TraceOperationSchema,
    capability: Type.Union([
      Type.Literal(TRACE_EXPORT_CAPABILITY),
      Type.Literal(TRACE_PURGE_CAPABILITY)
    ]),
    risk: Type.Union([Type.Literal('high'), Type.Literal('critical')]),
    scope_hash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    trace_count: Type.Integer({ minimum: 1, maximum: 100 }),
    reason_code: Type.String({ minLength: 1, maxLength: 128 }),
    requested_by_owner_ref: Type.String({ minLength: 1 }),
    requested_by_device_ref: Type.String({ minLength: 1 }),
    auth_session_ref: Type.String({ minLength: 1 }),
    confirmation_required: Type.Literal(true),
    verification_criteria: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1
    }),
    rollback_supported: Type.Boolean(),
    created_at: Type.String({ format: 'date-time' }),
    expires_at: Type.String({ format: 'date-time' })
  },
  { additionalProperties: false }
)

export type TraceOperationPlan = Static<typeof TraceOperationPlanSchema>

export const TraceOperationApprovalSchema = Type.Object(
  {
    approval_id: Type.String({ minLength: 1 }),
    plan_id: Type.String({ minLength: 1 }),
    action_id: Type.String({ minLength: 1 }),
    trace_id: Type.String({ minLength: 1 }),
    owner_ref: Type.String({ minLength: 1 }),
    device_ref: Type.String({ minLength: 1 }),
    auth_session_ref: Type.String({ minLength: 1 }),
    scope_hash: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    decision: Type.Union([
      Type.Literal('approved'),
      Type.Literal('rejected')
    ]),
    decided_at: Type.String({ format: 'date-time' })
  },
  { additionalProperties: false }
)

export type TraceOperationApproval = Static<
  typeof TraceOperationApprovalSchema
>

export const TraceOperationReceiptSchema = Type.Object(
  {
    receipt_id: Type.String({ minLength: 1 }),
    plan_id: Type.String({ minLength: 1 }),
    action_id: Type.String({ minLength: 1 }),
    trace_id: Type.String({ minLength: 1 }),
    operation: TraceOperationSchema,
    requested_action: Type.String({ minLength: 1 }),
    actor_ref: Type.String({ minLength: 1 }),
    executor_ref: Type.String({ minLength: 1 }),
    approval_id: Type.String({ minLength: 1 }),
    execution_status: Type.Union([
      Type.Literal('succeeded'),
      Type.Literal('failed'),
      Type.Literal('cancelled')
    ]),
    verification_status: Type.Union([
      Type.Literal('succeeded'),
      Type.Literal('failed')
    ]),
    verification_evidence_refs: Type.Array(Type.String({ minLength: 1 })),
    output_hash: Type.Union([
      Type.String({ pattern: '^[a-f0-9]{64}$' }),
      Type.Null()
    ]),
    purge_receipt_id: Type.Union([
      Type.String({ minLength: 1 }),
      Type.Null()
    ]),
    record_count: Type.Integer({ minimum: 0, maximum: 100 }),
    executed_at: Type.String({ format: 'date-time' }),
    verified_at: Type.String({ format: 'date-time' }),
    failure_code: Type.Union([
      Type.String({ minLength: 1 }),
      Type.Null()
    ]),
    receipt_hash: Type.String({ pattern: '^[a-f0-9]{64}$' })
  },
  { additionalProperties: false }
)

export type TraceOperationReceipt = Static<typeof TraceOperationReceiptSchema>

export interface TraceOperationExportRecord {
  trace_id: string
  record_hash: string
  retention_until: string
  envelope: unknown
}

export interface TraceOperationExportBundle {
  version: 1
  plan_id: string
  action_id: string
  trace_id: string
  owner_id: string
  scope_hash: string
  exported_at: string
  records: TraceOperationExportRecord[]
  bundle_hash: string
}

export interface TraceOperationExecutionResult {
  receipt: TraceOperationReceipt
  export_bundle: TraceOperationExportBundle | null
}

export interface TraceOperationAuditEvent {
  event_id: string
  trace_id: string
  parent_event_id: string | null
  plan_id: string
  stage: 'plan' | 'approval' | 'execution' | 'verification' | 'receipt'
  status: 'succeeded' | 'failed' | 'approved' | 'rejected'
  occurred_at: string
  payload_hash: string
  event_hash: string
}
