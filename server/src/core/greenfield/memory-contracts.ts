import type { IdentityContext, MemoryCandidate } from './contracts'

export const MEMORY_CANDIDATE_CREATE_CAPABILITY = 'memory.candidate.create'
export const MEMORY_CONFIRM_CAPABILITY = 'memory.confirm'
export const MEMORY_READ_CAPABILITY = 'memory.read'
export const MEMORY_EXPORT_CAPABILITY = 'memory.export'
export const MEMORY_PURGE_CAPABILITY = 'memory.purge'

export type MemoryClass = MemoryCandidate['memory_class']
export type MemoryTemporalStatus = MemoryCandidate['temporal_status']
export type MemoryDecision = 'owner_confirmed' | 'rejected'
export type MemoryTimeScope =
  | 'current'
  | 'historical'
  | 'prospective'
  | 'atemporal'

export interface MemoryCandidateDraft {
  title: string
  content: string
  memory_class: MemoryClass
  source_refs: string[]
  observed_at: string
  valid_from: string | null
  valid_until: string | null
  temporal_status: MemoryTemporalStatus
  confidence: number
  privacy_zone: string
  salience: number
  retention_policy: string
  derivation_links: string[]
  contradiction_links: string[]
  supersession_links: string[]
}

export interface StoredMemoryCandidate {
  candidate: MemoryCandidate
  content: string
  content_hash: string
  record_hash: string
  created_at: string
  expires_at: string
}

export interface MemoryCandidatePersistenceReceipt {
  candidate_id: string
  trace_id: string
  record_hash: string
  content_hash: string
  created_at: string
  expires_at: string
  encryption_key_id: string
  confirmation_required: true
}

export interface MemoryCandidateChallenge {
  candidate: MemoryCandidate
  content: string
  approval_token: string
  persistence: MemoryCandidatePersistenceReceipt
}

export interface DurableMemoryRecord {
  memory_id: string
  owner_id: string
  memory_class: MemoryClass
  title: string
  content: string
  observed_at: string
  valid_from: string | null
  valid_until: string | null
  temporal_status: MemoryTemporalStatus
  source_refs: string[]
  confidence: number
  confirmation_status: 'owner_confirmed'
  privacy_zone: string
  salience: number
  retention_policy: string
  embedding_version: string | null
  derived_from: string[]
  contradicts: string[]
  supersedes: string[]
  created_by_trace_id: string
  created_at: string
  modified_at: string
  record_hash: string
  projection_status: 'ready' | 'degraded'
}

export interface MemoryDecisionReceipt {
  decision_receipt_id: string
  candidate_id: string
  trace_id: string
  decision: MemoryDecision
  decided_at: string
  memory_id: string | null
  durable_record_hash: string | null
  verification_status: 'succeeded' | 'failed'
  receipt_hash: string
}

export interface MemorySearchResult {
  query: string
  time_scope: MemoryTimeScope
  records: DurableMemoryRecord[]
  limitations: string[]
  searched_at: string
}

export interface MemoryExportBundle {
  exported_at: string
  owner_ref: string
  record_count: number
  records: DurableMemoryRecord[]
  bundle_hash: string
}

export interface MemoryPurgePlan {
  plan_id: string
  action_id: string
  trace_id: string
  capability: typeof MEMORY_PURGE_CAPABILITY
  risk: 'critical'
  memory_ids: string[]
  record_hashes: string[]
  scope_hash: string
  reason_code: string
  created_at: string
  expires_at: string
  verification_criteria: string[]
  rollback_supported: false
  rollback_limitations: string[]
  plan_hash: string
}

export interface MemoryPurgeApproval {
  approval_id: string
  plan_id: string
  trace_id: string
  decision: 'approved' | 'rejected'
  scope_hash: string
  decided_at: string
  approval_hash: string
}

export interface MemoryPurgeReceipt {
  receipt_id: string
  plan_id: string
  action_id: string
  trace_id: string
  scope_hash: string
  reason_code: string
  record_count: number
  execution_status: 'succeeded' | 'failed'
  verification_status: 'succeeded' | 'failed'
  verification_evidence_refs: string[]
  executed_at: string
  verified_at: string
  rollback_status: 'unavailable'
  failure_code: string | null
  receipt_hash: string
}

export interface CreateMemoryCandidateInput {
  identity: IdentityContext
  traceId: string
  candidateId: string
  draft: MemoryCandidateDraft
  createdAt: Date
}

export interface DecideMemoryCandidateInput {
  identity: IdentityContext
  candidateId: string
  approvalToken: string
  decision: MemoryDecision
  decidedAt: Date
  createId?: () => string
}

export interface CreateMemoryPurgePlanInput {
  identity: IdentityContext
  traceId: string
  memoryIds: string[]
  reasonCode: string
  createdAt: Date
  createId?: () => string
}

export interface DecideMemoryPurgePlanInput {
  identity: IdentityContext
  planId: string
  approvalToken: string
  decision: 'approved' | 'rejected'
  decidedAt: Date
  createId?: () => string
}

export interface ExecuteMemoryPurgePlanInput {
  identity: IdentityContext
  planId: string
  executedAt: Date
  createId?: () => string
}
