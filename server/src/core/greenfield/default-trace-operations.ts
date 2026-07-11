import { getDefaultGreenfieldTraceStore } from './default-runtime'
import { TraceOwnerOperationService } from './trace-operation-service'
import { TraceOwnerOperationStore } from './trace-operation-store'
import { TraceOwnerOperationVerifier } from './trace-operation-verifier'

let defaultOperationStore: TraceOwnerOperationStore | null = null
let defaultOperationService: TraceOwnerOperationService | null = null

export function getDefaultTraceOperationStore(): TraceOwnerOperationStore {
  if (!defaultOperationStore) {
    defaultOperationStore = TraceOwnerOperationStore.fromProcessEnv()
  }
  return defaultOperationStore
}

export function getDefaultTraceOperationService(): TraceOwnerOperationService {
  if (!defaultOperationService) {
    defaultOperationService = new TraceOwnerOperationService(
      getDefaultGreenfieldTraceStore(),
      getDefaultTraceOperationStore(),
      new TraceOwnerOperationVerifier()
    )
  }
  return defaultOperationService
}
