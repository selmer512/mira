import AISDKRemoteLLMProvider, {
  type AISDKProviderRole
} from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'

/**
 * @see https://docs.z.ai/api-reference/llm/chat-completion
 */
export default class ZAILLMProvider extends AISDKRemoteLLMProvider {
  constructor(role: AISDKProviderRole = 'agent') {
    super({
      name: 'Z-AI LLM Provider',
      providerName: 'zai',
      apiKeyEnv: 'MIRA_ZAI_API_KEY',
      workflowModelEnv: 'MIRA_ZAI_MODEL',
      agentModelEnv: 'MIRA_ZAI_AGENT_LLM',
      defaultModel: 'glm-5',
      baseURL: 'https://api.z.ai/api/paas/v4',
      flavor: 'openai-compatible'
    }, role)
  }
}
