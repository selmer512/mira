import { Type, type Static } from '@sinclair/typebox'

const IdentifierSchema = Type.String({ minLength: 1 })
const TimestampSchema = Type.String({ format: 'date-time' })
const NullableTimestampSchema = Type.Union([TimestampSchema, Type.Null()])
const ConfidenceSchema = Type.Number({ minimum: 0, maximum: 1 })
const StringReferenceSchema = Type.String({ minLength: 1 })

export const PrivacyClassificationSchema = Type.Union([
  Type.Literal('public'),
  Type.Literal('private'),
  Type.Literal('sensitive'),
  Type.Literal('restricted')
])

export type PrivacyClassification = Static<
  typeof PrivacyClassificationSchema
>

export const TrustLevelSchema = Type.Union([
  Type.Literal('untrusted'),
  Type.Literal('paired'),
  Type.Literal('trusted'),
  Type.Literal('owner_admin')
])

export type TrustLevel = Static<typeof TrustLevelSchema>

export const IdentityContextSchema = Type.Object(
  {
    owner_id: IdentifierSchema,
    device_id: IdentifierSchema,
    auth_session_id: IdentifierSchema,
    authenticated_at: TimestampSchema,
    trust_level: TrustLevelSchema,
    permissions: Type.Array(IdentifierSchema, { uniqueItems: true }),
    privacy_zones: Type.Array(IdentifierSchema, { uniqueItems: true })
  },
  { additionalProperties: false }
)

export type IdentityContext = Static<typeof IdentityContextSchema>

export const OriginEventSchema = Type.Object(
  {
    event_id: IdentifierSchema,
    trace_id: IdentifierSchema,
    owner_id: IdentifierSchema,
    device_id: IdentifierSchema,
    event_type: Type.Union([
      Type.Literal('owner_request'),
      Type.Literal('sensed_event'),
      Type.Literal('scheduled_event'),
      Type.Literal('system_event')
    ]),
    occurred_at: TimestampSchema,
    content_ref: StringReferenceSchema,
    privacy_classification: PrivacyClassificationSchema
  },
  { additionalProperties: false }
)

export type OriginEvent = Static<typeof OriginEventSchema>

export const DecisionAuditSchema = Type.Object(
  {
    decision: Type.String({ minLength: 1 }),
    evidence_refs: Type.Array(StringReferenceSchema),
    alternatives: Type.Array(Type.String({ minLength: 1 })),
    policy_constraints: Type.Array(Type.String({ minLength: 1 })),
    confidence: ConfidenceSchema,
    uncertainty: Type.Array(Type.String({ minLength: 1 })),
    selection_reason: Type.String({ minLength: 1 }),
    fallback_reason: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    verification_criteria: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export type DecisionAudit = Static<typeof DecisionAuditSchema>

export const TraceSpanSchema = Type.Object(
  {
    trace_id: IdentifierSchema,
    span_id: IdentifierSchema,
    parent_span_id: Type.Union([IdentifierSchema, Type.Null()]),
    linked_span_ids: Type.Array(IdentifierSchema, { uniqueItems: true }),
    origin_event_id: IdentifierSchema,
    owner_id: IdentifierSchema,
    device_id: IdentifierSchema,
    component: Type.String({ minLength: 1 }),
    component_type: Type.Union([
      Type.Literal('identity'),
      Type.Literal('policy'),
      Type.Literal('reflex'),
      Type.Literal('edge_model'),
      Type.Literal('evidence'),
      Type.Literal('server_model'),
      Type.Literal('tool'),
      Type.Literal('agent'),
      Type.Literal('script'),
      Type.Literal('workflow'),
      Type.Literal('action'),
      Type.Literal('verification'),
      Type.Literal('response'),
      Type.Literal('memory'),
      Type.Literal('ui')
    ]),
    operation: Type.String({ minLength: 1 }),
    started_at: TimestampSchema,
    finished_at: NullableTimestampSchema,
    status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('running'),
      Type.Literal('succeeded'),
      Type.Literal('failed'),
      Type.Literal('cancelled'),
      Type.Literal('blocked')
    ]),
    implementation_version: Type.String({ minLength: 1 }),
    input_refs: Type.Array(StringReferenceSchema),
    output_refs: Type.Array(StringReferenceSchema),
    data_refs: Type.Array(StringReferenceSchema),
    decision_audits: Type.Array(DecisionAuditSchema),
    confidence: Type.Union([ConfidenceSchema, Type.Null()]),
    error_ref: Type.Union([StringReferenceSchema, Type.Null()]),
    verification_status: Type.Union([
      Type.Literal('not_required'),
      Type.Literal('pending'),
      Type.Literal('succeeded'),
      Type.Literal('failed')
    ]),
    privacy_classification: PrivacyClassificationSchema
  },
  { additionalProperties: false }
)

export type TraceSpan = Static<typeof TraceSpanSchema>

export const EvidenceObservationSchema = Type.Object(
  {
    evidence_id: IdentifierSchema,
    trace_id: IdentifierSchema,
    source_id: IdentifierSchema,
    observed_at: TimestampSchema,
    valid_from: TimestampSchema,
    valid_until: NullableTimestampSchema,
    owner_id: IdentifierSchema,
    device_id: Type.Union([IdentifierSchema, Type.Null()]),
    confidence: ConfidenceSchema,
    permissions: Type.Array(IdentifierSchema, { uniqueItems: true }),
    privacy_classification: PrivacyClassificationSchema,
    payload_ref: StringReferenceSchema,
    limitations: Type.Array(Type.String({ minLength: 1 })),
    content_hash: Type.String({ minLength: 1 }),
    revision: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
)

export type EvidenceObservation = Static<typeof EvidenceObservationSchema>

export const LocalModelReferenceSchema = Type.Object(
  {
    provider: Type.String({ minLength: 1 }),
    model: Type.String({ minLength: 1 }),
    version: Type.String({ minLength: 1 }),
    mode: Type.Union([Type.Literal('think'), Type.Literal('no_think')])
  },
  { additionalProperties: false }
)

export const LocalRoutingDecisionSchema = Type.Object(
  {
    request_id: IdentifierSchema,
    trace_id: IdentifierSchema,
    intent: Type.String({ minLength: 1 }),
    time_scope: Type.Union([
      Type.Literal('current'),
      Type.Literal('historical'),
      Type.Literal('prospective'),
      Type.Literal('atemporal'),
      Type.Literal('unknown')
    ]),
    evidence_requirement: Type.Union([
      Type.Literal('required'),
      Type.Literal('optional'),
      Type.Literal('forbidden')
    ]),
    selected_capabilities: Type.Array(IdentifierSchema, {
      uniqueItems: true
    }),
    server_escalation_required: Type.Boolean(),
    server_escalation_reason: Type.Union([
      Type.String({ minLength: 1 }),
      Type.Null()
    ]),
    local_model: LocalModelReferenceSchema,
    confidence: ConfidenceSchema,
    limitations: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export type LocalRoutingDecision = Static<
  typeof LocalRoutingDecisionSchema
>

export const VerificationPlanSchema = Type.Object(
  {
    method: Type.String({ minLength: 1 }),
    criteria: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    external_source_required: Type.Boolean()
  },
  { additionalProperties: false }
)

export const RollbackPlanSchema = Type.Object(
  {
    supported: Type.Boolean(),
    method: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    limitations: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const ActionProposalSchema = Type.Object(
  {
    action_id: IdentifierSchema,
    trace_id: IdentifierSchema,
    capability: IdentifierSchema,
    risk: Type.Union([
      Type.Literal('low'),
      Type.Literal('medium'),
      Type.Literal('high'),
      Type.Literal('critical')
    ]),
    required_permissions: Type.Array(IdentifierSchema, {
      minItems: 1,
      uniqueItems: true
    }),
    confirmation_required: Type.Boolean(),
    requested_by_owner_id: IdentifierSchema,
    requested_by_device_id: IdentifierSchema,
    auth_session_id: IdentifierSchema,
    arguments_ref: StringReferenceSchema,
    expected_result: Type.String({ minLength: 1 }),
    verification: VerificationPlanSchema,
    rollback: RollbackPlanSchema,
    status: Type.Union([
      Type.Literal('proposed'),
      Type.Literal('approved'),
      Type.Literal('rejected'),
      Type.Literal('executing'),
      Type.Literal('succeeded'),
      Type.Literal('failed'),
      Type.Literal('rolled_back')
    ])
  },
  { additionalProperties: false }
)

export type ActionProposal = Static<typeof ActionProposalSchema>

export const ActionApprovalSchema = Type.Object(
  {
    approval_id: IdentifierSchema,
    action_id: IdentifierSchema,
    trace_id: IdentifierSchema,
    owner_id: IdentifierSchema,
    auth_session_id: IdentifierSchema,
    decision: Type.Union([
      Type.Literal('approved'),
      Type.Literal('rejected')
    ]),
    decided_at: TimestampSchema
  },
  { additionalProperties: false }
)

export type ActionApproval = Static<typeof ActionApprovalSchema>

export const VerificationReceiptSchema = Type.Object(
  {
    receipt_id: IdentifierSchema,
    action_id: IdentifierSchema,
    trace_id: IdentifierSchema,
    requested_action: Type.String({ minLength: 1 }),
    actor_ref: StringReferenceSchema,
    executor_ref: StringReferenceSchema,
    input_ref: StringReferenceSchema,
    approval_ref: Type.Union([StringReferenceSchema, Type.Null()]),
    execution_status: Type.Union([
      Type.Literal('succeeded'),
      Type.Literal('failed'),
      Type.Literal('cancelled')
    ]),
    output_ref: Type.Union([StringReferenceSchema, Type.Null()]),
    verification_method: Type.String({ minLength: 1 }),
    verification_status: Type.Union([
      Type.Literal('succeeded'),
      Type.Literal('failed')
    ]),
    verification_evidence_refs: Type.Array(StringReferenceSchema),
    executed_at: TimestampSchema,
    verified_at: TimestampSchema,
    failure_ref: Type.Union([StringReferenceSchema, Type.Null()]),
    rollback_status: Type.Union([
      Type.Literal('not_required'),
      Type.Literal('available'),
      Type.Literal('succeeded'),
      Type.Literal('failed'),
      Type.Literal('unavailable')
    ])
  },
  { additionalProperties: false }
)

export type VerificationReceipt = Static<typeof VerificationReceiptSchema>

export const MemoryClassSchema = Type.Union([
  Type.Literal('working'),
  Type.Literal('recent_episodic'),
  Type.Literal('long_term_episodic'),
  Type.Literal('semantic'),
  Type.Literal('relationship'),
  Type.Literal('procedural'),
  Type.Literal('identity'),
  Type.Literal('prospective'),
  Type.Literal('reflective'),
  Type.Literal('artifact'),
  Type.Literal('model_hypothesis')
])

export const TemporalStatusSchema = Type.Union([
  Type.Literal('current'),
  Type.Literal('historical'),
  Type.Literal('prospective'),
  Type.Literal('unknown'),
  Type.Literal('superseded')
])

export const MemoryCandidateSchema = Type.Object(
  {
    candidate_id: IdentifierSchema,
    owner_id: IdentifierSchema,
    trace_id: IdentifierSchema,
    memory_class: MemoryClassSchema,
    title: Type.String({ minLength: 1 }),
    content_ref: StringReferenceSchema,
    source_refs: Type.Array(StringReferenceSchema, { minItems: 1 }),
    observed_at: TimestampSchema,
    valid_from: NullableTimestampSchema,
    valid_until: NullableTimestampSchema,
    temporal_status: TemporalStatusSchema,
    confidence: ConfidenceSchema,
    confirmation_status: Type.Union([
      Type.Literal('pending'),
      Type.Literal('owner_confirmed'),
      Type.Literal('rejected'),
      Type.Literal('not_required')
    ]),
    privacy_zone: IdentifierSchema,
    salience: ConfidenceSchema,
    retention_policy: IdentifierSchema,
    embedding_version: Type.Union([
      Type.String({ minLength: 1 }),
      Type.Null()
    ]),
    derivation_links: Type.Array(IdentifierSchema),
    contradiction_links: Type.Array(IdentifierSchema),
    supersession_links: Type.Array(IdentifierSchema)
  },
  { additionalProperties: false }
)

export type MemoryCandidate = Static<typeof MemoryCandidateSchema>

export const OperationalStateSchema = Type.Union([
  Type.Literal('idle'),
  Type.Literal('listening'),
  Type.Literal('hearing_speech'),
  Type.Literal('thinking_locally'),
  Type.Literal('calling_server_model'),
  Type.Literal('using_tool'),
  Type.Literal('waiting_for_approval'),
  Type.Literal('acting'),
  Type.Literal('verifying'),
  Type.Literal('speaking'),
  Type.Literal('online'),
  Type.Literal('offline'),
  Type.Literal('degraded'),
  Type.Literal('error'),
  Type.Literal('syncing_memory'),
  Type.Literal('privacy_sensitive_operation')
])

export const OperationalStateEventSchema = Type.Object(
  {
    event_id: IdentifierSchema,
    trace_id: IdentifierSchema,
    span_id: IdentifierSchema,
    device_id: IdentifierSchema,
    state: OperationalStateSchema,
    occurred_at: TimestampSchema,
    source_component: Type.String({ minLength: 1 }),
    detail_ref: Type.Union([StringReferenceSchema, Type.Null()])
  },
  { additionalProperties: false }
)

export type OperationalStateEvent = Static<
  typeof OperationalStateEventSchema
>

export const OwnerResponseSchema = Type.Object(
  {
    response_id: IdentifierSchema,
    trace_id: IdentifierSchema,
    content_ref: StringReferenceSchema,
    evidence_refs: Type.Array(StringReferenceSchema),
    limitations: Type.Array(Type.String({ minLength: 1 })),
    created_at: TimestampSchema
  },
  { additionalProperties: false }
)

export type OwnerResponse = Static<typeof OwnerResponseSchema>

export const VerticalSliceEnvelopeSchema = Type.Object(
  {
    identity: IdentityContextSchema,
    origin: OriginEventSchema,
    routing: LocalRoutingDecisionSchema,
    evidence: Type.Array(EvidenceObservationSchema),
    spans: Type.Array(TraceSpanSchema, { minItems: 1 }),
    response: OwnerResponseSchema,
    action: Type.Union([ActionProposalSchema, Type.Null()]),
    approval: Type.Union([ActionApprovalSchema, Type.Null()]),
    receipt: Type.Union([VerificationReceiptSchema, Type.Null()]),
    memory_candidate: Type.Union([MemoryCandidateSchema, Type.Null()]),
    operational_states: Type.Array(OperationalStateEventSchema)
  },
  { additionalProperties: false }
)

export type VerticalSliceEnvelope = Static<
  typeof VerticalSliceEnvelopeSchema
>