import AISDKRemoteLLMProvider, {
  type AISDKProviderRole
} from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'

export default class OpenAILLMProvider extends AISDKRemoteLLMProvider {
  constructor(role: AISDKProviderRole = 'agent') {
    super({
      name: 'OpenAI LLM Provider',
      providerName: 'openai',
      apiKeyEnv: 'MIRA_OPENAI_API_KEY',
      workflowModelEnv: 'MIRA_OPENAI_MODEL',
      agentModelEnv: 'MIRA_OPENAI_AGENT_LLM',
      defaultModel: 'gpt-4o-mini',
      baseURL: 'https://api.openai.com/v1',
      flavor: 'openai-responses'
    }, role)
  }
}
