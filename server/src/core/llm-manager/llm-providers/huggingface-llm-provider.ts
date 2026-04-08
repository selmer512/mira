import AISDKRemoteLLMProvider, {
  type AISDKProviderRole
} from '@/core/llm-manager/llm-providers/ai-sdk-remote-llm-provider'

/**
 * @see https://router.huggingface.co/v1/chat/completions
 */
export default class HuggingFaceLLMProvider extends AISDKRemoteLLMProvider {
  constructor(role: AISDKProviderRole = 'agent') {
    super({
      name: 'HuggingFace LLM Provider',
      providerName: 'huggingface',
      apiKeyEnv: 'MIRA_HUGGINGFACE_API_KEY',
      workflowModelEnv: 'MIRA_HUGGINGFACE_MODEL',
      agentModelEnv: 'MIRA_HUGGINGFACE_AGENT_LLM',
      defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct',
      baseURL: 'https://router.huggingface.co/v1',
      flavor: 'huggingface'
    }, role)
  }
}
