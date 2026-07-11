import { randomUUID } from 'node:crypto'

import type { IdentityContext } from './contracts'
import {
  MEMORY_CANDIDATE_CREATE_CAPABILITY,
  MEMORY_CONFIRM_CAPABILITY,
  MEMORY_EXPORT_CAPABILITY,
  MEMORY_PURGE_CAPABILITY,
  MEMORY_READ_CAPABILITY,
  type CreateMemoryPurgePlanInput,
  type DecideMemoryCandidateInput,
  type DecideMemoryPurgePlanInput,
  type ExecuteMemoryPurgePlanInput,
  type MemoryCandidateChallenge,
  type MemoryCandidateDraft,
  type MemoryDecision,
  type MemoryDecisionReceipt,
  type MemoryExportBundle,
  type MemoryPurgeApproval,
  type MemoryPurgePlan,
  type MemoryPurgeReceipt,
  type MemorySearchResult,
  type MemoryTimeScope,
  type StoredMemoryCandidate
} from './memory-contracts'
import {
  EncryptedSqliteMemoryStore,
  MemoryStoreError
} from './memory-store'
import { evaluateIdentity } from './policy'

const MAX_TITLE_LENGTH = 256
const MAX_CONTENT_LENGTH = 16_384
const MAX_SOURCE_REFS = 32
const MAX_LINEAGE_LINKS = 100
const RETENTION_POLICY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export class MemoryServiceError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'MemoryServiceError'
  }
}

export interface CreateMemoryCandidateServiceInput {
  identity: IdentityContext
  traceId: string
  candidateId?: string
  draft: MemoryCandidateDraft
  createdAt: Date
}

export class MemoryLifecycleService {
  public constructor(private readonly store: EncryptedSqliteMemoryStore) {}

  public createCandidate(
    input: CreateMemoryCandidateServiceInput
  ): MemoryCandidateChallenge {
    this.assertAuthority(
      input.identity,
      MEMORY_CANDIDATE_CREATE_CAPABILITY,
      input.draft.privacy_zone
    )
    this.validateDraft(input.draft)
    return this.translateStoreError(() =>
      this.store.createCandidate({
        identity: input.identity,
        traceId: input.traceId,
        candidateId: input.candidateId || randomUUID(),
        draft: input.draft,
        createdAt: input.createdAt
      })
    )
  }

  public readCandidate(
    identity: IdentityContext,
    candidateId: string
  ): StoredMemoryCandidate | null {
    this.assertAuthority(identity, MEMORY_CONFIRM_CAPABILITY, 'private')
    return this.translateStoreError(() =>
      this.store.readCandidate(identity.owner_id, candidateId)
    )
  }

  public decideCandidate(input: DecideMemoryCandidateInput): {
    receipt: MemoryDecisionReceipt
    memory: ReturnType<EncryptedSqliteMemoryStore['decideCandidate']>['memory']
  } {
    this.assertAuthority(input.identity, MEMORY_CONFIRM_CAPABILITY, 'private')
    if (input.decision !== 'owner_confirmed' && input.decision !== 'rejected') {
      throw new MemoryServiceError(
        'memory.decision_invalid',
        'Memory candidates may only be confirmed or rejected by the owner.',
        400
      )
    }
    return this.translateStoreError(() => this.store.decideCandidate(input))
  }

  public search(
    identity: IdentityContext,
    query: string,
    timeScope: MemoryTimeScope,
    limit: number,
    searchedAt = new Date()
  ): MemorySearchResult {
    this.assertAuthority(identity, MEMORY_READ_CAPABILITY, 'private')
    if (query.length > 4_096) {
      throw new MemoryServiceError(
        'memory.query_too_long',
        'Memory search queries are limited to 4096 characters.',
        400
      )
    }
    if (
      timeScope !== 'current' &&
      timeScope !== 'historical' &&
      timeScope !== 'prospective' &&
      timeScope !== 'atemporal'
    ) {
      throw new MemoryServiceError(
        'memory.time_scope_invalid',
        'Memory search time scope is invalid.',
        400
      )
    }
    return this.translateStoreError(() =>
      this.store.search(identity, query, timeScope, limit, searchedAt)
    )
  }

  public exportOwner(
    identity: IdentityContext,
    exportedAt = new Date()
  ): MemoryExportBundle {
    this.assertAuthority(identity, MEMORY_EXPORT_CAPABILITY, 'private')
    return this.translateStoreError(() =>
      this.store.exportOwner(identity, exportedAt)
    )
  }

  public createPurgePlan(input: CreateMemoryPurgePlanInput): {
    plan: MemoryPurgePlan
    approvalToken: string
  } {
    this.assertAuthority(input.identity, MEMORY_PURGE_CAPABILITY, 'private')
    return this.translateStoreError(() => this.store.createPurgePlan(input))
  }

  public readPurgePlan(
    identity: IdentityContext,
    planId: string
  ): MemoryPurgePlan | null {
    this.assertAuthority(identity, MEMORY_PURGE_CAPABILITY, 'private')
    return this.translateStoreError(() =>
      this.store.readPurgePlan(identity.owner_id, planId)
    )
  }

  public decidePurgePlan(
    input: DecideMemoryPurgePlanInput
  ): MemoryPurgeApproval {
    this.assertAuthority(input.identity, MEMORY_PURGE_CAPABILITY, 'private')
    return this.translateStoreError(() => this.store.decidePurgePlan(input))
  }

  public executePurgePlan(
    input: ExecuteMemoryPurgePlanInput
  ): MemoryPurgeReceipt {
    this.assertAuthority(input.identity, MEMORY_PURGE_CAPABILITY, 'private')
    return this.translateStoreError(() => this.store.executePurgePlan(input))
  }

  public readPurgeReceipt(
    identity: IdentityContext,
    planId: string
  ): MemoryPurgeReceipt | null {
    this.assertAuthority(identity, MEMORY_PURGE_CAPABILITY, 'private')
    const plan = this.translateStoreError(() =>
      this.store.readPurgePlan(identity.owner_id, planId)
    )
    if (!plan) return null
    return this.translateStoreError(() => this.store.readPurgeReceipt(planId))
  }

  public rollbackCandidate(
    ownerId: string,
    candidateId: string,
    traceId: string,
    rolledBackAt = new Date()
  ): void {
    this.translateStoreError(() =>
      this.store.rollbackCandidate(ownerId, candidateId, traceId, rolledBackAt)
    )
  }

  private assertAuthority(
    identity: IdentityContext,
    capability: string,
    privacyZone: string
  ): void {
    const identityDecision = evaluateIdentity(identity)
    if (!identityDecision.allowed) {
      throw new MemoryServiceError(
        identityDecision.code,
        identityDecision.reasons.join(' '),
        403
      )
    }
    if (!identity.permissions.includes(capability)) {
      throw new MemoryServiceError(
        'memory.permission_missing',
        `The authenticated owner session lacks ${capability}.`,
        403
      )
    }
    if (
      privacyZone !== 'public' &&
      !identity.privacy_zones.includes(privacyZone)
    ) {
      throw new MemoryServiceError(
        'memory.privacy_zone_denied',
        'The authenticated owner session cannot access this memory privacy zone.',
        403
      )
    }
  }

  private validateDraft(draft: MemoryCandidateDraft): void {
    const title = draft.title.trim()
    const content = draft.content.trim()
    if (!title || title.length > MAX_TITLE_LENGTH) {
      throw new MemoryServiceError(
        'memory.title_invalid',
        `Memory title must contain 1-${MAX_TITLE_LENGTH} characters.`,
        400
      )
    }
    if (!content || content.length > MAX_CONTENT_LENGTH) {
      throw new MemoryServiceError(
        'memory.content_invalid',
        `Memory content must contain 1-${MAX_CONTENT_LENGTH} characters.`,
        400
      )
    }
    if (
      draft.source_refs.length === 0 ||
      draft.source_refs.length > MAX_SOURCE_REFS ||
      new Set(draft.source_refs).size !== draft.source_refs.length
    ) {
      throw new MemoryServiceError(
        'memory.provenance_invalid',
        `Memory candidates require 1-${MAX_SOURCE_REFS} unique source references.`,
        400
      )
    }
    if (!RETENTION_POLICY_PATTERN.test(draft.retention_policy)) {
      throw new MemoryServiceError(
        'memory.retention_policy_invalid',
        'The memory retention policy must be a stable lowercase identifier.',
        400
      )
    }
    if (
      draft.confidence < 0 ||
      draft.confidence > 1 ||
      draft.salience < 0 ||
      draft.salience > 1
    ) {
      throw new MemoryServiceError(
        'memory.score_invalid',
        'Memory confidence and salience must be between 0 and 1.',
        400
      )
    }
    const observedAt = Date.parse(draft.observed_at)
    if (!Number.isFinite(observedAt)) {
      throw new MemoryServiceError(
        'memory.observed_at_invalid',
        'Memory observed_at must be a valid ISO 8601 date-time.',
        400
      )
    }
    for (const timestamp of [draft.valid_from, draft.valid_until]) {
      if (timestamp !== null && !Number.isFinite(Date.parse(timestamp))) {
        throw new MemoryServiceError(
          'memory.validity_invalid',
          'Memory validity boundaries must be valid ISO 8601 date-times.',
          400
        )
      }
    }
    if (
      draft.valid_from &&
      draft.valid_until &&
      Date.parse(draft.valid_from) > Date.parse(draft.valid_until)
    ) {
      throw new MemoryServiceError(
        'memory.validity_order_invalid',
        'Memory valid_from cannot be after valid_until.',
        400
      )
    }
    const lineage = [
      ...draft.derivation_links,
      ...draft.contradiction_links,
      ...draft.supersession_links
    ]
    if (
      lineage.length > MAX_LINEAGE_LINKS ||
      new Set(lineage).size !== lineage.length
    ) {
      throw new MemoryServiceError(
        'memory.lineage_invalid',
        `Memory lineage is limited to ${MAX_LINEAGE_LINKS} unique references.`,
        400
      )
    }
  }

  private translateStoreError<T>(operation: () => T): T {
    try {
      return operation()
    } catch (error) {
      if (error instanceof MemoryStoreError) {
        throw new MemoryServiceError(
          error.code,
          error.message,
          error.statusCode,
          error.details
        )
      }
      throw error
    }
  }
}

export function isMemoryDecision(value: string): value is MemoryDecision {
  return value === 'owner_confirmed' || value === 'rejected'
}
