import { createHash } from 'node:crypto'

import type {
  TraceOperationExportBundle,
  TraceOperationExportRecord
} from './trace-operation-contracts'
import {
  canonicalHash,
  type StoredTraceOperationPlan
} from './trace-operation-store'
import type {
  EncryptedSqliteTraceStore,
  TracePurgeReceipt,
  TraceReadResult
} from './trace-store'

export interface TraceOperationVerification {
  valid: boolean
  evidenceRefs: string[]
  issue: string | null
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

export class TraceOwnerOperationVerifier {
  public async verifyExport(input: {
    ownerId: string
    plan: StoredTraceOperationPlan
    reads: TraceReadResult[]
    bundle: TraceOperationExportBundle
    traceStore: EncryptedSqliteTraceStore
  }): Promise<TraceOperationVerification> {
    const chain = await input.traceStore.verifyOwnerChain(input.ownerId)
    if (!chain.valid) {
      return {
        valid: false,
        evidenceRefs: [],
        issue: chain.issue || 'The owner trace chain is invalid.'
      }
    }

    const traceIds = input.reads.map((read) => read.persistence.traceId)
    const recordHashes = input.reads.map((read) => read.persistence.recordHash)
    if (
      !sameStringSet(traceIds, input.plan.traceIds) ||
      !sameStringSet(recordHashes, input.plan.recordHashes)
    ) {
      return {
        valid: false,
        evidenceRefs: recordHashes,
        issue: 'The exported trace scope does not match the immutable plan.'
      }
    }

    const expectedRecords: TraceOperationExportRecord[] = input.reads.map(
      (read) => ({
        trace_id: read.persistence.traceId,
        record_hash: read.persistence.recordHash,
        retention_until: read.persistence.retentionUntil,
        envelope: read.envelope
      })
    )
    const unsignedBundle = {
      version: input.bundle.version,
      plan_id: input.bundle.plan_id,
      action_id: input.bundle.action_id,
      trace_id: input.bundle.trace_id,
      owner_id: input.bundle.owner_id,
      scope_hash: input.bundle.scope_hash,
      exported_at: input.bundle.exported_at,
      records: input.bundle.records
    }
    if (
      input.bundle.plan_id !== input.plan.plan.plan_id ||
      input.bundle.action_id !== input.plan.plan.action_id ||
      input.bundle.trace_id !== input.plan.plan.trace_id ||
      input.bundle.owner_id !== input.ownerId ||
      input.bundle.scope_hash !== input.plan.plan.scope_hash ||
      canonicalHash(input.bundle.records) !== canonicalHash(expectedRecords) ||
      input.bundle.bundle_hash !== canonicalHash(unsignedBundle)
    ) {
      return {
        valid: false,
        evidenceRefs: recordHashes,
        issue: 'The export bundle failed deterministic verification.'
      }
    }

    return {
      valid: true,
      evidenceRefs: [
        ...recordHashes,
        `chain:records:${chain.recordCount}`,
        `bundle:${input.bundle.bundle_hash}`
      ],
      issue: null
    }
  }

  public async verifyPurge(input: {
    ownerId: string
    plan: StoredTraceOperationPlan
    purgeReceipt: TracePurgeReceipt
    traceStore: EncryptedSqliteTraceStore
  }): Promise<TraceOperationVerification> {
    if (
      input.purgeReceipt.scopeHash !== purgeScopeHash(input.plan.traceIds) ||
      input.purgeReceipt.reasonCode !== input.plan.plan.reason_code ||
      input.purgeReceipt.recordCount !== input.plan.plan.trace_count ||
      !sameStringSet(
        input.purgeReceipt.purgedRecordHashes,
        input.plan.recordHashes
      )
    ) {
      return {
        valid: false,
        evidenceRefs: [input.purgeReceipt.receiptHash],
        issue: 'The physical purge receipt does not match the immutable plan.'
      }
    }

    for (const traceId of input.plan.traceIds) {
      if (await input.traceStore.read(input.ownerId, traceId)) {
        return {
          valid: false,
          evidenceRefs: [input.purgeReceipt.receiptHash],
          issue: `Trace ${traceId} remains present after purge execution.`
        }
      }
    }

    const chain = await input.traceStore.verifyOwnerChain(input.ownerId)
    if (!chain.valid) {
      return {
        valid: false,
        evidenceRefs: [input.purgeReceipt.receiptHash],
        issue: chain.issue || 'The remaining owner trace chain is invalid.'
      }
    }

    return {
      valid: true,
      evidenceRefs: [
        input.purgeReceipt.receiptHash,
        ...input.plan.recordHashes,
        `chain:records:${chain.recordCount}`
      ],
      issue: null
    }
  }
}
