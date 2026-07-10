import {
  CapabilityLocalCognitionProvider,
  EnvironmentIdentityResolver,
  GreenfieldRequestOrchestrator,
  SystemStatusEvidenceProvider,
  SystemStatusResponseComposer,
  type RuntimeStatusReader,
  type RuntimeStatusSnapshot
} from './runtime'

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

export function createDefaultGreenfieldRuntime(): GreenfieldRequestOrchestrator {
  return new GreenfieldRequestOrchestrator({
    identityResolver: EnvironmentIdentityResolver.fromProcessEnv(),
    localCognitionProvider: new CapabilityLocalCognitionProvider(),
    evidenceProvider: new SystemStatusEvidenceProvider(
      new MiraRuntimeStatusReader()
    ),
    responseComposer: new SystemStatusResponseComposer()
  })
}
