import { createHash, randomUUID } from 'node:crypto'

import type {
  EvidenceObservation,
  IdentityContext,
  LocalRoutingDecision,
  OperationalStateEvent,
  OwnerResponse,
  TraceSpan,
  VerticalSliceEnvelope
} from './contracts'
import { validateVerticalSliceEnvelope } from './validation'

export const SYSTEM_STATUS_CAPABILITY = 'system.status.read'

export interface GreenfieldRequest {
  device_id: string
  capability: typeof SYSTEM_STATUS_CAPABILITY
  input: string
}

export interface GreenfieldExecutionInput extends GreenfieldRequest {
  credential: string
}

export interface RuntimeStatusSnapshot {
  status: 'online' | 'degraded'
  observed_at: string
  uptime_seconds: number
  version: string
  routing_mode: string
  llm_provider_ready: boolean
  local_model: string
  limitations: string[]
}

export interface EvidencePayloads {
  [evidenceId: string]: RuntimeStatusSnapshot
}

export interface GreenfieldExecutionResult {
  answer: string
  envelope: VerticalSliceEnvelope
  evidence_payloads: EvidencePayloads
}

export class GreenfieldExecutionError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'GreenfieldExecutionError'
  }
}

export interface IdentityResolveInput {
  deviceId: string
  credential: string
  authenticatedAt: Date
}

export interface IdentityResolver {
  resolve(input: IdentityResolveInput): Promise<IdentityContext>
}

export interface LocalCognitionInput {
  request: GreenfieldRequest
  identity: IdentityContext
  traceId: string
}

export interface LocalCognitionProvider {
  classify(input: LocalCognitionInput): Promise<LocalRoutingDecision>
}

export interface EvidenceCollectionInput {
  identity: IdentityContext
  routing: LocalRoutingDecision
  traceId: string
  observedAt: Date
}

export interface EvidenceCollection {
  observations: EvidenceObservation[]
  payloads: EvidencePayloads
  limitations: string[]
}

export interface EvidenceProvider {
  collect(input: EvidenceCollectionInput): Promise<EvidenceCollection>
}

export interface ResponseCompositionInput {
  request: GreenfieldRequest
  routing: LocalRoutingDecision
  evidence: EvidenceCollection
  createdAt: Date
}

export interface ResponseDraft {
  answer: string
  evidenceRefs: string[]
  limitations: string[]
}

export interface ResponseComposer {
  compose(input: ResponseCompositionInput): Promise<ResponseDraft>
}

export interface RuntimeStatusReader {
  read(observedAt: Date): Promise<RuntimeStatusSnapshot>
}

export interface GreenfieldRuntimeDependencies {
  identityResolver: IdentityResolver
  localCognitionProvider: LocalCognitionProvider
  evidenceProvider: EvidenceProvider
  responseComposer: ResponseComposer
  now?: () => Date
  createId?: () => string
}

interface EnvironmentIdentityConfig {
  enabled: boolean
  ownerId: string
  pairedDeviceId: string
  permissions: string[]
  privacyZones: string[]
}

function parseList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export class EnvironmentIdentityResolver implements IdentityResolver {
  public constructor(private readonly config: EnvironmentIdentityConfig) {}

  public static fromProcessEnv(
    env: NodeJS.ProcessEnv = process.env
  ): EnvironmentIdentityResolver {
    return new EnvironmentIdentityResolver({
      enabled: env['MIRA_GREENFIELD_ENABLED'] === 'true',
      ownerId: env['MIRA_GREENFIELD_OWNER_ID'] || '',
      pairedDeviceId: env['MIRA_GREENFIELD_PAIRED_DEVICE_ID'] || '',
      permissions: parseList(env['MIRA_GREENFIELD_PERMISSIONS']),
      privacyZones: parseList(env['MIRA_GREENFIELD_PRIVACY_ZONES'])
    })
  }

  public async resolve(input: IdentityResolveInput): Promise<IdentityContext> {
    if (!this.config.enabled) {
      throw new GreenfieldExecutionError(
        'greenfield.disabled',
        'The greenfield request path is disabled.',
        503
      )
    }

    if (
      !this.config.ownerId ||
      !this.config.pairedDeviceId ||
      this.config.permissions.length === 0 ||
      this.config.privacyZones.length === 0
    ) {
      throw new GreenfieldExecutionError(
        'identity.configuration_incomplete',
        'Greenfield identity, permissions, and privacy zones are not fully configured.',
        503
      )
    }

    if (!input.credential) {
      throw new GreenfieldExecutionError(
        'identity.credential_missing',
        'An authenticated HTTP credential is required.',
        401
      )
    }

    if (input.deviceId !== this.config.pairedDeviceId) {
      throw new GreenfieldExecutionError(
        'identity.device_not_paired',
        'The requesting device is not the configured paired device.',
        403
      )
    }

    const credentialFingerprint = createHash('sha256')
      .update(input.credential)
      .digest('hex')
      .slice(0, 24)

    return {
      owner_id: this.config.ownerId,
      device_id: this.config.pairedDeviceId,
      auth_session_id: `http-key:${credentialFingerprint}`,
      authenticated_at: input.authenticatedAt.toISOString(),
      trust_level: 'paired',
      permissions: [...this.config.permissions],
      privacy_zones: [...this.config.privacyZones]
    }
  }
}

export class CapabilityLocalCognitionProvider
  implements LocalCognitionProvider
{
  public async classify(
    input: LocalCognitionInput
  ): Promise<LocalRoutingDecision> {
    if (!input.identity.permissions.includes(input.request.capability)) {
      throw new GreenfieldExecutionError(
        'routing.capability_not_allowed',
        'The authenticated owner session cannot use the requested capability.',
        403
      )
    }

    return {
      request_id: randomUUID(),
      trace_id: input.traceId,
      intent: 'system.status.current',
      time_scope: 'current',
      evidence_requirement: 'required',
      selected_capabilities: [SYSTEM_STATUS_CAPABILITY],
      server_escalation_required: false,
      server_escalation_reason: null,
      local_model: {
        provider: 'deterministic',
        model: 'capability-router',
        version: '1',
        mode: 'no_think'
      },
      confidence: 1,
      limitations: [
        'Natural-language MiniCPM5 routing is not enabled in this vertical slice.'
      ]
    }
  }
}

export class SystemStatusEvidenceProvider implements EvidenceProvider {
  public constructor(private readonly statusReader: RuntimeStatusReader) {}

  public async collect(
    input: EvidenceCollectionInput
  ): Promise<EvidenceCollection> {
    if (!input.routing.selected_capabilities.includes(SYSTEM_STATUS_CAPABILITY)) {
      return {
        observations: [],
        payloads: {},
        limitations: ['No evidence provider supports the selected capability.']
      }
    }

    try {
      const snapshot = await this.statusReader.read(input.observedAt)
      const evidenceId = randomUUID()
      const serializedPayload = JSON.stringify(snapshot)
      const contentHash = createHash('sha256')
        .update(serializedPayload)
        .digest('hex')
      const validUntil = new Date(input.observedAt.getTime() + 30_000)

      return {
        observations: [
          {
            evidence_id: evidenceId,
            trace_id: input.traceId,
            source_id: 'mira-runtime',
            observed_at: input.observedAt.toISOString(),
            valid_from: input.observedAt.toISOString(),
            valid_until: validUntil.toISOString(),
            owner_id: input.identity.owner_id,
            device_id: input.identity.device_id,
            confidence: 1,
            permissions: [SYSTEM_STATUS_CAPABILITY],
            privacy_classification: 'private',
            payload_ref: `inline://greenfield/evidence/${evidenceId}`,
            limitations: [...snapshot.limitations],
            content_hash: `sha256:${contentHash}`,
            revision: contentHash
          }
        ],
        payloads: {
          [evidenceId]: snapshot
        },
        limitations: [...snapshot.limitations]
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        observations: [],
        payloads: {},
        limitations: [`Runtime evidence is unavailable: ${message}`]
      }
    }
  }
}

export class SystemStatusResponseComposer implements ResponseComposer {
  public async compose(
    input: ResponseCompositionInput
  ): Promise<ResponseDraft> {
    const [evidenceId] = Object.keys(input.evidence.payloads)
    const snapshot = evidenceId
      ? input.evidence.payloads[evidenceId]
      : undefined

    if (!evidenceId || !snapshot) {
      return {
        answer:
          'I cannot confirm Mira’s current system status because fresh runtime evidence is unavailable.',
        evidenceRefs: [],
        limitations:
          input.evidence.limitations.length > 0
            ? [...input.evidence.limitations]
            : ['Fresh runtime evidence is unavailable.']
      }
    }

    const readiness = snapshot.llm_provider_ready ? 'ready' : 'not ready'
    const answer = [
      `Mira is ${snapshot.status} as of ${snapshot.observed_at}.`,
      `Version: ${snapshot.version}.`,
      `Uptime: ${Math.floor(snapshot.uptime_seconds)} seconds.`,
      `Routing mode: ${snapshot.routing_mode}.`,
      `LLM provider: ${readiness}.`,
      `Local model: ${snapshot.local_model}.`
    ].join(' ')

    return {
      answer,
      evidenceRefs: [evidenceId],
      limitations: [...input.evidence.limitations]
    }
  }
}

function createSpan(input: {
  traceId: string
  spanId: string
  parentSpanId: string | null
  originEventId: string
  identity: IdentityContext
  component: string
  componentType: TraceSpan['component_type']
  operation: string
  startedAt: Date
  finishedAt: Date
  status?: TraceSpan['status']
  inputRefs?: string[]
  outputRefs?: string[]
  dataRefs?: string[]
  verificationStatus?: TraceSpan['verification_status']
  confidence?: number | null
}): TraceSpan {
  return {
    trace_id: input.traceId,
    span_id: input.spanId,
    parent_span_id: input.parentSpanId,
    linked_span_ids: [],
    origin_event_id: input.originEventId,
    owner_id: input.identity.owner_id,
    device_id: input.identity.device_id,
    component: input.component,
    component_type: input.componentType,
    operation: input.operation,
    started_at: input.startedAt.toISOString(),
    finished_at: input.finishedAt.toISOString(),
    status: input.status || 'succeeded',
    implementation_version: 'greenfield-runtime-v1',
    input_refs: input.inputRefs || [],
    output_refs: input.outputRefs || [],
    data_refs: input.dataRefs || [],
    decision_audits: [],
    confidence: input.confidence ?? null,
    error_ref: null,
    verification_status: input.verificationStatus || 'not_required',
    privacy_classification: 'private'
  }
}

function createOperationalState(input: {
  id: string
  traceId: string
  spanId: string
  deviceId: string
  state: OperationalStateEvent['state']
  occurredAt: Date
  sourceComponent: string
}): OperationalStateEvent {
  return {
    event_id: input.id,
    trace_id: input.traceId,
    span_id: input.spanId,
    device_id: input.deviceId,
    state: input.state,
    occurred_at: input.occurredAt.toISOString(),
    source_component: input.sourceComponent,
    detail_ref: null
  }
}

export class GreenfieldRequestOrchestrator {
  private readonly now: () => Date
  private readonly createId: () => string

  public constructor(private readonly dependencies: GreenfieldRuntimeDependencies) {
    this.now = dependencies.now || (() => new Date())
    this.createId = dependencies.createId || randomUUID
  }

  public async execute(
    request: GreenfieldExecutionInput
  ): Promise<GreenfieldExecutionResult> {
    const authenticatedAt = this.now()
    const identity = await this.dependencies.identityResolver.resolve({
      deviceId: request.device_id,
      credential: request.credential,
      authenticatedAt
    })

    const traceId = this.createId()
    const originEventId = this.createId()
    const rootSpanId = this.createId()
    const routingSpanId = this.createId()
    const evidenceSpanId = this.createId()
    const responseSpanId = this.createId()
    const requestRef = `inline://greenfield/request/${originEventId}`

    const routingStartedAt = this.now()
    const routing = await this.dependencies.localCognitionProvider.classify({
      request,
      identity,
      traceId
    })
    const routingFinishedAt = this.now()

    const evidenceStartedAt = this.now()
    const evidence = await this.dependencies.evidenceProvider.collect({
      identity,
      routing,
      traceId,
      observedAt: evidenceStartedAt
    })
    const evidenceFinishedAt = this.now()

    const responseStartedAt = this.now()
    const responseDraft = await this.dependencies.responseComposer.compose({
      request,
      routing,
      evidence,
      createdAt: responseStartedAt
    })
    const responseFinishedAt = this.now()
    const responseId = this.createId()

    const response: OwnerResponse = {
      response_id: responseId,
      trace_id: traceId,
      content_ref: `inline://greenfield/response/${responseId}`,
      evidence_refs: responseDraft.evidenceRefs,
      limitations: responseDraft.limitations,
      created_at: responseFinishedAt.toISOString()
    }

    const evidenceRefs = evidence.observations.map(
      (observation) => `evidence://${observation.evidence_id}`
    )

    const spans: TraceSpan[] = [
      createSpan({
        traceId,
        spanId: rootSpanId,
        parentSpanId: null,
        originEventId,
        identity,
        component: 'greenfield-http-entry',
        componentType: 'identity',
        operation: 'authenticate-owner-and-device',
        startedAt: authenticatedAt,
        finishedAt: routingStartedAt,
        inputRefs: [requestRef],
        outputRefs: [`trace://${traceId}`]
      }),
      createSpan({
        traceId,
        spanId: routingSpanId,
        parentSpanId: rootSpanId,
        originEventId,
        identity,
        component: 'greenfield-local-cognition',
        componentType: 'reflex',
        operation: 'classify-capability-and-evidence-requirement',
        startedAt: routingStartedAt,
        finishedAt: routingFinishedAt,
        inputRefs: [requestRef],
        outputRefs: [`routing://${routing.request_id}`],
        confidence: routing.confidence
      }),
      createSpan({
        traceId,
        spanId: evidenceSpanId,
        parentSpanId: routingSpanId,
        originEventId,
        identity,
        component: 'greenfield-evidence-provider',
        componentType: 'evidence',
        operation: 'read-current-runtime-status',
        startedAt: evidenceStartedAt,
        finishedAt: evidenceFinishedAt,
        inputRefs: [`routing://${routing.request_id}`],
        outputRefs: evidenceRefs,
        dataRefs: evidence.observations.map(
          (observation) => observation.payload_ref
        ),
        verificationStatus:
          evidence.observations.length > 0 ? 'succeeded' : 'failed'
      }),
      createSpan({
        traceId,
        spanId: responseSpanId,
        parentSpanId: evidenceSpanId,
        originEventId,
        identity,
        component: 'greenfield-response-composer',
        componentType: 'response',
        operation: 'compose-grounded-owner-response',
        startedAt: responseStartedAt,
        finishedAt: responseFinishedAt,
        inputRefs: evidenceRefs,
        outputRefs: [`response://${responseId}`]
      })
    ]

    const operationalStates: OperationalStateEvent[] = [
      createOperationalState({
        id: this.createId(),
        traceId,
        spanId: routingSpanId,
        deviceId: identity.device_id,
        state: 'thinking_locally',
        occurredAt: routingStartedAt,
        sourceComponent: 'greenfield-local-cognition'
      }),
      createOperationalState({
        id: this.createId(),
        traceId,
        spanId: evidenceSpanId,
        deviceId: identity.device_id,
        state: 'using_tool',
        occurredAt: evidenceStartedAt,
        sourceComponent: 'greenfield-evidence-provider'
      }),
      createOperationalState({
        id: this.createId(),
        traceId,
        spanId: responseSpanId,
        deviceId: identity.device_id,
        state: 'speaking',
        occurredAt: responseStartedAt,
        sourceComponent: 'greenfield-response-composer'
      })
    ]

    const envelope: VerticalSliceEnvelope = {
      identity,
      origin: {
        event_id: originEventId,
        trace_id: traceId,
        owner_id: identity.owner_id,
        device_id: identity.device_id,
        event_type: 'owner_request',
        occurred_at: authenticatedAt.toISOString(),
        content_ref: requestRef,
        privacy_classification: 'private'
      },
      routing,
      evidence: evidence.observations,
      spans,
      response,
      action: null,
      approval: null,
      receipt: null,
      memory_candidate: null,
      operational_states: operationalStates
    }

    const validation = validateVerticalSliceEnvelope(
      envelope,
      responseFinishedAt
    )
    if (!validation.valid) {
      throw new GreenfieldExecutionError(
        'envelope.validation_failed',
        'The greenfield request produced an invalid causal envelope.',
        500,
        validation.issues
      )
    }

    return {
      answer: responseDraft.answer,
      envelope: validation.envelope,
      evidence_payloads: evidence.payloads
    }
  }
}
