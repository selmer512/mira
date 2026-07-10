import { CredentialVerifyingIdentityResolver } from './credential-identity'
import {
  CapabilityLocalCognitionProvider,
  EnvironmentIdentityResolver,
  SystemStatusEvidenceProvider,
  SystemStatusResponseComposer,
  type GreenfieldRuntimeDependencies,
  type IdentityResolver,
  type RuntimeStatusReader,
  type RuntimeStatusSnapshot
} from './runtime'
import { PersistingGreenfieldRequestOrchestrator } from './trace-persistence'
import { EncryptedSqliteTraceStore } from './trace-store'

let defaultTraceStore: EncryptedSqliteTraceStore | null = null
let defaultIdentityResolver: IdentityResolver | null = null

class MiraRuntimeStatusReader implements RuntimeStatusReader {
  public async read(observedAt: Date): Promise<RuntimeStatusSnapshot> {
    const { LLM_PROVIDER } = await import('@/core')
    const configuredForLLM = process.env['MIRA_LLM'] === 'true'
    const providerReady = LLM_PROVIDER.isLLMProviderReady
    const limitations: string[] = []

    if (configuredForLLM && !providerReady) {
      limitations.push(
        'An LLM is configured, but the provider is not currently ready.'
      )
    }

    return {
      status: configuredForLLM && !providerReady ? 'degraded' : 'online',
      observed_at: observedAt.toISOString(),
      uptime_seconds: process.uptime(),
      version: process.env['npm_package_version'] || 'unknown',
      routing_mode: process.env['MIRA_ROUTING_MODE'] || 'smart',
      llm_provider_ready: providerReady,
      local_model: LLM_PROVIDER.localLLMName,
      limitations
    }
  }
}

export function getDefaultGreenfieldIdentityResolver(): IdentityResolver {
  if (!defaultIdentityResolver) {
    defaultIdentityResolver = new CredentialVerifyingIdentityResolver(
      process.env['MIRA_HTTP_API_KEY'] || '',
      EnvironmentIdentityResolver.fromProcessEnv()
    )
  }

  return defaultIdentityResolver
}

export function getDefaultGreenfieldTraceStore(): EncryptedSqliteTraceStore {
  if (!defaultTraceStore) {
    defaultTraceStore = EncryptedSqliteTraceStore.fromProcessEnv()
  }

  return defaultTraceStore
}

export function createDefaultGreenfieldRuntime(): PersistingGreenfieldRequestOrchestrator {
  const dependencies: GreenfieldRuntimeDependencies = {
    identityResolver: getDefaultGreenfieldIdentityResolver(),
    localCognitionProvider: new CapabilityLocalCognitionProvider(),
    evidenceProvider: new SystemStatusEvidenceProvider(
      new MiraRuntimeStatusReader()
    ),
    responseComposer: new SystemStatusResponseComposer()
  }

  return new PersistingGreenfieldRequestOrchestrator(
    dependencies,
    getDefaultGreenfieldTraceStore()
  )
}
