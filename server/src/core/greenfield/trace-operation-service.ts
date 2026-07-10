import { createHash, randomUUID } from 'node:crypto'

import type { IdentityContext } from './contracts'
import { evaluateIdentity } from './policy'
import {
  TRACE_EXPORT_CAPABILITY,
  TRACE_PURGE_CAPABILITY,
  type TraceOperation,
  type TraceOperationApproval,
  type TraceOperationExecutionResult,
  type TraceOperationExportBundle,
  type TraceOperationPlan,
  type TraceOperationReceipt
} from './trace-operation-contracts'
import {
  canonicalHash,
  TraceOwnerOperationStore,
  type StoredTraceOperationPlan
} from './trace-operation-store'
import { TraceOwnerOperationVerifier } from './trace-operation-verifier'
import type {
  EncryptedSqliteTraceStore,
  TracePurgeReceipt,
  TraceReadResult
} from './trace-store'

function isTypedOperationError(error: unknown): error is {
  code: string
  message: string
  statusCode: number
  details: unknown
} {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    'details' in error
  )
}

export class TraceOperationExecutionError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'TraceOperationExecutionError'
  }
}

export interface TraceOperationPlanResult {
  plan: TraceOperationPlan
  approval_token: string
}

export interface TraceOperationService {
  createPlan(input: {
    identity: IdentityContext
    operation: TraceOperation
    traceIds: string[]
    reasonCode: string
  }): Promise<TraceOperationPlanResult>
  approve(input: {
    identity: IdentityContext
    planId: string
    approvalToken: string
    decision: 'approved' | 'rejected'
  }): Promise<TraceOperationApproval>
  execute(input: {
    identity: IdentityContext
    planId: string
  }): Promise<TraceOperationExecutionResult>
}

function requiredCapability(
  operation: TraceOperation
): typeof TRACE_EXPORT_CAPABILITY | typeof TRACE_PURGE_CAPABILITY {
  return operation === 'export'
    ? TRACE_EXPORT_CAPABILITY
    : TRACE_PURGE_CAPABILITY
}

function sameStringSet(left: string[], right: string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort()
  const normalizedRight = [...new Set(right)].sort()
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  )
}

function purgeScopeHash(traceIds: string[]): string {
  return createHash('sha256')
    .update([...traceIds].sort().join('\n'))
    .digest('hex')
}

function normalizeTraceIds(traceIds: string[]): string[] {
  const normalized = [...new Set(traceIds.map((value) => value.trim()))]
    .filter((value) => value.length > 0)
    .sort()
  if (normalized.length === 0 || normalized.length > 100) {
    throw new TraceOperationExecutionError(
      'trace_operation.scope_invalid',
      'A trace operation requires between 1 and 100 unique trace IDs.',
      400
    )
  }
  return normalized
}

export class TraceOwnerOperationService implements TraceOperationService {
  public constructor(
    private readonly traceStore: EncryptedSqliteTraceStore,
    private readonly operationStore: TraceOwnerOperationStore,
    private readonly verifier: TraceOwnerOperationVerifier,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID
  ) {}

  public async createPlan(input: {
    identity: IdentityContext
    operation: TraceOperation
    traceIds: string[]
    reasonCode: string
  }): Promise<TraceOperationPlanResult> {
    this.assertOwnerAuthorization(input.identity, input.operation)
    const traceIds = normalizeTraceIds(input.traceIds)
    const chain = await this.traceStore.verifyOwnerChain(input.identity.owner_id)
    if (!chain.valid) {
      throw new TraceOperationExecutionError(
        'trace_operation.chain_invalid',
        'A trace operation cannot be planned while owner trace integrity is invalid.',
        409,
        chain.issue
      )
    }

    const reads = await this.readExactScope(input.identity.owner_id, traceIds)
    const created = this.operationStore.createPlan({
      identity: input.identity,
      operation: input.operation,
      traceIds,
      recordHashes: reads.map((read) => read.persistence.recordHash),
      reasonCode: input.reasonCode,
      createdAt: this.now(),
      createId: this.createId
    })

    return {
      plan: created.plan.plan,
      approval_token: created.approvalToken
    }
  }

  public async approve(input: {
    identity: IdentityContext
    planId: string
    approvalToken: string
    decision: 'approved' | 'rejected'
  }): Promise<TraceOperationApproval> {
    const plan = this.requirePlan(input.identity.owner_id, input.planId)
    this.operationStore.assertIdentity(plan, input.identity)
    this.assertOwnerAuthorization(input.identity, plan.plan.operation)
    return this.operationStore.recordApproval({
      plan,
      identity: input.identity,
      approvalToken: input.approvalToken,
      decision: input.decision,
      decidedAt: this.now(),
      createId: this.createId
    })
  }

  public async execute(input: {
    identity: IdentityContext
    planId: string
  }): Promise<TraceOperationExecutionResult> {
    const plan = this.requirePlan(input.identity.owner_id, input.planId)
    this.operationStore.assertIdentity(plan, input.identity)
    this.assertOwnerAuthorization(input.identity, plan.plan.operation)
    const approval = this.requireApprovedApproval(plan)
    const existingReceipt = this.operationStore.readReceipt(plan.plan.plan_id)
    if (existingReceipt) {
      return this.replayExistingResult(
        input.identity.owner_id,
        plan,
        existingReceipt
      )
    }

    if (this.now().getTime() > Date.parse(plan.plan.expires_at)) {
      throw new TraceOperationExecutionError(
        'trace_operation.plan_expired',
        'The approved trace operation plan has expired.',
        409
      )
    }

    const executedAt = this.now()
    try {
      return plan.plan.operation === 'export'
        ? await this.executeExport(
            input.identity.owner_id,
            plan,
            approval,
            executedAt
          )
        : await this.executePurge(
            input.identity.owner_id,
            plan,
            approval,
            executedAt
          )
    } catch (error) {
      const normalized = this.normalizeError(error)
      const failedReceipt = this.operationStore.recordReceipt({
        plan,
        approval,
        executionStatus: 'failed',
        verificationStatus: 'failed',
        verificationEvidenceRefs: [],
        outputHash: null,
        purgeReceiptId: null,
        executedAt,
        verifiedAt: this.now(),
        failureCode: normalized.code,
        createId: this.createId
      })
      throw new TraceOperationExecutionError(
        normalized.code,
        normalized.message,
        normalized.statusCode,
        { receipt: failedReceipt, cause: normalized.details }
      )
    }
  }

  private async executeExport(
    ownerId: string,
    plan: StoredTraceOperationPlan,
    approval: TraceOperationApproval,
    executedAt: Date
  ): Promise<TraceOperationExecutionResult> {
    const reads = await this.readExactScope(
      ownerId,
      plan.traceIds,
      plan.recordHashes
    )
    const unsignedBundle = {
      version: 1 as const,
      plan_id: plan.plan.plan_id,
      action_id: plan.plan.action_id,
      trace_id: plan.plan.trace_id,
      owner_id: ownerId,
      scope_hash: plan.plan.scope_hash,
      exported_at: executedAt.toISOString(),
      records: reads.map((read) => ({
        trace_id: read.persistence.traceId,
        record_hash: read.persistence.recordHash,
        retention_until: read.persistence.retentionUntil,
        envelope: read.envelope
      }))
    }
    const bundle: TraceOperationExportBundle = {
      ...unsignedBundle,
      bundle_hash: canonicalHash(unsignedBundle)
    }
    const verification = await this.verifier.verifyExport({
      ownerId,
      plan,
      reads,
      bundle,
      traceStore: this.traceStore
    })
    if (!verification.valid) {
      throw new TraceOperationExecutionError(
        'trace_operation.export_verification_failed',
        verification.issue || 'Trace export verification failed.',
        500,
        verification
      )
    }

    const verifiedAt = this.now()
    const receipt = this.operationStore.recordReceipt({
      plan,
      approval,
      executionStatus: 'succeeded',
      verificationStatus: 'succeeded',
      verificationEvidenceRefs: verification.evidenceRefs,
      outputHash: bundle.bundle_hash,
      purgeReceiptId: null,
      executedAt,
      verifiedAt,
      failureCode: null,
      createId: this.createId
    })
    return { receipt, export_bundle: bundle }
  }

  private async executePurge(
    ownerId: string,
    plan: StoredTraceOperationPlan,
    approval: TraceOperationApproval,
    executedAt: Date
  ): Promise<TraceOperationExecutionResult> {
    const chain = await this.traceStore.verifyOwnerChain(ownerId)
    if (!chain.valid) {
      throw new TraceOperationExecutionError(
        'trace_operation.chain_invalid',
        'Physical purge was blocked because owner trace integrity is invalid.',
        409,
        chain.issue
      )
    }

    let purgeReceipt = await this.findMatchingPurgeReceipt(ownerId, plan)
    if (!purgeReceipt) {
      await this.readExactScope(ownerId, plan.traceIds, plan.recordHashes)
      purgeReceipt = await this.traceStore.purgeOwnerTraces(
        ownerId,
        plan.traceIds,
        plan.plan.reason_code,
        executedAt
      )
    }
    if (!purgeReceipt) {
      throw new TraceOperationExecutionError(
        'trace_operation.purge_no_records',
        'No records were physically purged for the approved scope.',
        409
      )
    }

    const verification = await this.verifier.verifyPurge({
      ownerId,
      plan,
      purgeReceipt,
      traceStore: this.traceStore
    })
    if (!verification.valid) {
      throw new TraceOperationExecutionError(
        'trace_operation.purge_verification_failed',
        verification.issue || 'Physical purge verification failed.',
        500,
        verification
      )
    }

    const verifiedAt = this.now()
    const receipt = this.operationStore.recordReceipt({
      plan,
      approval,
      executionStatus: 'succeeded',
      verificationStatus: 'succeeded',
      verificationEvidenceRefs: verification.evidenceRefs,
      outputHash: purgeReceipt.receiptHash,
      purgeReceiptId: purgeReceipt.receiptId,
      executedAt,
      verifiedAt,
      failureCode: null,
      createId: this.createId
    })
    return { receipt, export_bundle: null }
  }

  private async replayExistingResult(
    ownerId: string,
    plan: StoredTraceOperationPlan,
    receipt: TraceOperationReceipt
  ): Promise<TraceOperationExecutionResult> {
    if (
      receipt.execution_status !== 'succeeded' ||
      receipt.verification_status !== 'succeeded'
    ) {
      throw new TraceOperationExecutionError(
        receipt.failure_code || 'trace_operation.execution_failed',
        'The immutable trace operation receipt records a failed execution.',
        409,
        { receipt }
      )
    }

    if (plan.plan.operation !== 'export') {
      return { receipt, export_bundle: null }
    }

    const reads = await this.readExactScope(
      ownerId,
      plan.traceIds,
      plan.recordHashes
    )
    const unsignedBundle = {
      version: 1 as const,
      plan_id: plan.plan.plan_id,
      action_id: plan.plan.action_id,
      trace_id: plan.plan.trace_id,
      owner_id: ownerId,
      scope_hash: plan.plan.scope_hash,
      exported_at: receipt.executed_at,
      records: reads.map((read) => ({
        trace_id: read.persistence.traceId,
        record_hash: read.persistence.recordHash,
        retention_until: read.persistence.retentionUntil,
        envelope: read.envelope
      }))
    }
    const bundle: TraceOperationExportBundle = {
      ...unsignedBundle,
      bundle_hash: canonicalHash(unsignedBundle)
    }
    if (bundle.bundle_hash !== receipt.output_hash) {
      throw new TraceOperationExecutionError(
        'trace_operation.export_replay_unavailable',
        'The previously verified export bundle can no longer be reconstructed.',
        410,
        receipt
      )
    }
    return { receipt, export_bundle: bundle }
  }

  private requirePlan(ownerId: string, planId: string): StoredTraceOperationPlan {
    const plan = this.operationStore.readPlan(ownerId, planId)
    if (!plan) {
      throw new TraceOperationExecutionError(
        'trace_operation.plan_not_found',
        'The requested trace operation plan was not found for this owner.',
        404
      )
    }
    return plan
  }

  private requireApprovedApproval(
    plan: StoredTraceOperationPlan
  ): TraceOperationApproval {
    const approval = this.operationStore.readApproval(plan.plan.plan_id)
    if (!approval) {
      throw new TraceOperationExecutionError(
        'trace_operation.approval_missing',
        'An explicit owner approval is required before execution.',
        409
      )
    }
    if (
      approval.scope_hash !== plan.plan.scope_hash ||
      approval.decision !== 'approved'
    ) {
      throw new TraceOperationExecutionError(
        approval.decision === 'rejected'
          ? 'trace_operation.owner_rejected'
          : 'trace_operation.approval_scope_mismatch',
        approval.decision === 'rejected'
          ? 'The owner rejected this trace operation.'
          : 'The approval does not match the immutable operation scope.',
        409
      )
    }
    return approval
  }

  private assertOwnerAuthorization(
    identity: IdentityContext,
    operation: TraceOperation
  ): void {
    const identityDecision = evaluateIdentity(identity)
    if (!identityDecision.allowed) {
      throw new TraceOperationExecutionError(
        identityDecision.code,
        identityDecision.reasons.join(' '),
        403
      )
    }
    const capability = requiredCapability(operation)
    if (!identity.permissions.includes(capability)) {
      throw new TraceOperationExecutionError(
        'trace_operation.permission_missing',
        `The authenticated owner session lacks ${capability}.`,
        403
      )
    }
    if (!identity.privacy_zones.includes('private')) {
      throw new TraceOperationExecutionError(
        'trace_operation.private_zone_required',
        'Trace export and purge require access to the private privacy zone.',
        403
      )
    }
  }

  private async readExactScope(
    ownerId: string,
    traceIds: string[],
    expectedRecordHashes?: string[]
  ): Promise<TraceReadResult[]> {
    const reads: TraceReadResult[] = []
    for (const traceId of traceIds) {
      const read = await this.traceStore.read(ownerId, traceId)
      if (!read) {
        throw new TraceOperationExecutionError(
          'trace_operation.trace_not_found',
          `Trace ${traceId} was not found for the authenticated owner.`,
          404
        )
      }
      reads.push(read)
    }

    if (
      expectedRecordHashes &&
      !sameStringSet(
        reads.map((read) => read.persistence.recordHash),
        expectedRecordHashes
      )
    ) {
      throw new TraceOperationExecutionError(
        'trace_operation.scope_drifted',
        'The selected trace records changed after the operation was planned.',
        409
      )
    }
    return reads
  }

  private async findMatchingPurgeReceipt(
    ownerId: string,
    plan: StoredTraceOperationPlan
  ): Promise<TracePurgeReceipt | null> {
    const expectedScopeHash = purgeScopeHash(plan.traceIds)
    const receipts = await this.traceStore.listPurgeReceipts(ownerId)
    return (
      receipts.find(
        (receipt) =>
          receipt.scopeHash === expectedScopeHash &&
          receipt.reasonCode === plan.plan.reason_code &&
          receipt.recordCount === plan.plan.trace_count &&
          sameStringSet(receipt.purgedRecordHashes, plan.recordHashes)
      ) || null
    )
  }

  private normalizeError(error: unknown): {
    code: string
    message: string
    statusCode: number
    details: unknown
  } {
    if (isTypedOperationError(error)) {
      return {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
        details: error.details
      }
    }
    return {
      code: 'trace_operation.execution_failed',
      message: 'The approved trace operation failed.',
      statusCode: 500,
      details: error instanceof Error ? error.message : String(error)
    }
  }
}
