/**
 * Keep the provider matrix in one place so the Vitest spec and subprocess
 * runner stay in sync.
 */
export const PROVIDER_MATRIX = [
  {
    provider: 'llamacpp',
    requiredEnv: 'MIRA_LLAMACPP_MODEL_PATH'
  },
  {
    provider: 'openrouter',
    requiredEnv: 'MIRA_OPENROUTER_API_KEY'
  },
  {
    provider: 'openai',
    requiredEnv: 'MIRA_OPENAI_API_KEY'
  },
  {
    provider: 'anthropic',
    requiredEnv: 'MIRA_ANTHROPIC_API_KEY'
  },
  {
    provider: 'moonshotai',
    requiredEnv: 'MIRA_MOONSHOTAI_API_KEY'
  },
  {
    provider: 'zai',
    requiredEnv: 'MIRA_ZAI_API_KEY'
  }
] as const

export type AgenticProvider = (typeof PROVIDER_MATRIX)[number]['provider']

export const PROVIDER_REQUIRED_ENV = Object.fromEntries(
  PROVIDER_MATRIX.map(({ provider, requiredEnv }) => [provider, requiredEnv])
) as Record<AgenticProvider, string>
