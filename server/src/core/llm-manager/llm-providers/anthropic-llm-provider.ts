import AISDKRemoteLLMProvider, {
  type AISDKProviderRole
} from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'

export default class AnthropicLLMProvider extends AISDKRemoteLLMProvider {
  constructor(role: AISDKProviderRole = 'agent') {
    super({
      name: 'Anthropic LLM Provider',
      providerName: 'anthropic',
      apiKeyEnv: 'MIRA_ANTHROPIC_API_KEY',
      workflowModelEnv: 'MIRA_ANTHROPIC_MODEL',
      agentModelEnv: 'MIRA_ANTHROPIC_AGENT_LLM',
      defaultModel: 'claude-3-5-sonnet-latest',
      baseURL: 'https://api.anthropic.com/v1',
      flavor: 'anthropic'
    }, role)
  }
}
