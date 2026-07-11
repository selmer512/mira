import {
  getDefaultGreenfieldIdentityResolver,
  getDefaultGreenfieldTraceStore
} from './default-runtime'
import { MemoryCandidateRequestOrchestrator } from './memory-runtime'
import { MemoryLifecycleService } from './memory-service'
import { EncryptedSqliteMemoryStore } from './memory-store'

let defaultMemoryStore: EncryptedSqliteMemoryStore | null = null
let defaultMemoryService: MemoryLifecycleService | null = null
let defaultMemoryRuntime: MemoryCandidateRequestOrchestrator | null = null

export function getDefaultMemoryStore(): EncryptedSqliteMemoryStore {
  if (!defaultMemoryStore) {
    defaultMemoryStore = EncryptedSqliteMemoryStore.fromProcessEnv()
  }
  return defaultMemoryStore
}

export function getDefaultMemoryService(): MemoryLifecycleService {
  if (!defaultMemoryService) {
    defaultMemoryService = new MemoryLifecycleService(getDefaultMemoryStore())
  }
  return defaultMemoryService
}

export function getDefaultMemoryCandidateRuntime(): MemoryCandidateRequestOrchestrator {
  if (!defaultMemoryRuntime) {
    defaultMemoryRuntime = new MemoryCandidateRequestOrchestrator({
      identityResolver: getDefaultGreenfieldIdentityResolver(),
      memoryService: getDefaultMemoryService(),
      traceStore: getDefaultGreenfieldTraceStore()
    })
  }
  return defaultMemoryRuntime
}
