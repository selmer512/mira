import AISDKRemoteLLMProvider, {
  type AISDKProviderRole
} from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'

export default class OpenRouterLLMProvider extends AISDKRemoteLLMProvider {
  constructor(role: AISDKProviderRole = 'agent') {
    super({
      name: 'OpenRouter LLM Provider',
      providerName: 'openrouter',
      apiKeyEnv: 'MIRA_OPENROUTER_API_KEY',
      workflowModelEnv: 'MIRA_OPENROUTER_MODEL',
      agentModelEnv: 'MIRA_OPENROUTER_AGENT_LLM',
      defaultModel: 'openrouter/auto',
      baseURL: 'https://openrouter.ai/api/v1',
      flavor: 'openrouter'
    }, role)
  }
}
