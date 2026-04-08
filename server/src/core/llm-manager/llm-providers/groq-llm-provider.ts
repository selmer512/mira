import AISDKRemoteLLMProvider, {
  type AISDKProviderRole
} from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'

/**
 * @see https://console.groq.com/docs/text-chat
 */
export default class GroqLLMProvider extends AISDKRemoteLLMProvider {
  constructor(role: AISDKProviderRole = 'agent') {
    super({
      name: 'Groq LLM Provider',
      providerName: 'groq',
      apiKeyEnv: 'MIRA_GROQ_API_KEY',
      workflowModelEnv: 'MIRA_GROQ_MODEL',
      agentModelEnv: 'MIRA_GROQ_AGENT_LLM',
      defaultModel: 'llama-3.1-8b-instant',
      baseURL: 'https://api.groq.com/openai/v1',
      flavor: 'groq'
    }, role)
  }
}
