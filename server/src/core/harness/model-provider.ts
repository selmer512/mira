import { createHash } from 'node:crypto'

import { AGENT_LLM_PROVIDER } from '@/constants'
import {
  LLMDuties,
  type CompletionParams,
  type OpenAITool,
  type OpenAIToolCall
} from '@/core/llm-manager/types'

import type {
  ModelInvocationInput,
  ModelInvocationResult,
  ModelProviderPort
} from './protocols'

interface MiraCompletionResult {
  output?: unknown
  usedInputTokens?: unknown
  usedOutputTokens?: unknown
  generationDurationMs?: unknown
  providerDecodeDurationMs?: unknown
  providerTokensPerSecond?: unknown
  toolCalls?: unknown
}

interface MiraLLMProviderLike {
  readonly isLLMProviderReady: boolean
  readonly agentLLMName: string
  prompt(prompt: string, params: CompletionParams): Promise<unknown>
}

type ProviderLoader = () => Promise<MiraLLMProviderLike>

export class HarnessModelProviderError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly details: unknown = null
  ) {
    super(message)
    this.name = 'HarnessModelProviderError'
  }
}

function textFromPart(part: {
  type: 'text' | 'json' | 'reference'
  text?: string
  data?: unknown
  ref?: string
}): string {
  if (part.type === 'text') {
    return part.text || ''
  }
  if (part.type === 'reference') {
    return part.ref || ''
  }
  try {
    return JSON.stringify(part.data)
  } catch {
    return '[unserializable-json]'
  }
}

function messageText(input: ModelInvocationInput): {
  systemPrompt: string
  prompt: string
} {
  const system: string[] = []
  const conversation: string[] = []
  for (const message of input.messages) {
    const text = message.parts.map(textFromPart).filter(Boolean).join('\n')
    if (message.role === 'system') {
      system.push(text)
      continue
    }
    conversation.push(`[${message.role.toUpperCase()}]\n${text}`)
  }
  return {
    systemPrompt: system.join('\n\n'),
    prompt: conversation.join('\n\n')
  }
}

function functionNameForCapability(capabilityId: string): string {
  const normalized = capabilityId.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (normalized.length <= 56) {
    return normalized
  }
  const suffix = createHash('sha256').update(capabilityId).digest('hex').slice(0, 7)
  return `${normalized.slice(0, 48)}_${suffix}`
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asCompletionResult(value: unknown): MiraCompletionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value as MiraCompletionResult
}

function parseToolCalls(
  raw: unknown,
  functionToCapability: Map<string, string>
): ModelInvocationResult['tool_requests'] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.map((value, index) => {
    if (!value || typeof value !== 'object') {
      throw new HarnessModelProviderError(
        'harness.model_tool_call_invalid',
        'The model returned an invalid tool call.',
        { index }
      )
    }
    const toolCall = value as OpenAIToolCall
    const functionName = toolCall.function?.name || ''
    const capabilityId = functionToCapability.get(functionName)
    if (!capabilityId) {
      throw new HarnessModelProviderError(
        'harness.model_tool_not_allowlisted',
        'The model proposed a tool that was not supplied by the harness.',
        { function_name: functionName }
      )
    }
    let args: unknown
    try {
      args = JSON.parse(toolCall.function.arguments || '{}')
    } catch {
      throw new HarnessModelProviderError(
        'harness.model_tool_arguments_invalid',
        'The model returned malformed JSON tool arguments.',
        { function_name: functionName }
      )
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw new HarnessModelProviderError(
        'harness.model_tool_arguments_invalid',
        'Model tool arguments must be a JSON object.',
        { function_name: functionName }
      )
    }
    return {
      request_id: toolCall.id || `tool-request-${index}`,
      capability_id: capabilityId,
      arguments: args as Record<string, unknown>
    }
  })
}

async function loadDefaultProvider(): Promise<MiraLLMProviderLike> {
  const { LLM_PROVIDER } = await import('@/core')
  return LLM_PROVIDER
}

export class MiraConfiguredModelProvider implements ModelProviderPort {
  public constructor(
    private readonly configuredProvider = AGENT_LLM_PROVIDER,
    private readonly loadProvider: ProviderLoader = loadDefaultProvider
  ) {}

  public async invoke(
    input: ModelInvocationInput
  ): Promise<ModelInvocationResult> {
    input.signal.throwIfAborted()
    if (input.provider !== this.configuredProvider) {
      throw new HarnessModelProviderError(
        'harness.model_provider_not_configured',
        'The harness cannot select a model provider outside Mira configuration.',
        {
          requested_provider: input.provider,
          configured_provider: this.configuredProvider
        }
      )
    }
    if (input.response_schema !== null) {
      throw new HarnessModelProviderError(
        'harness.model_response_schema_unsupported',
        'This Mira model bridge does not yet expose arbitrary response schemas.'
      )
    }

    const provider = await this.loadProvider()
    if (!provider.isLLMProviderReady) {
      throw new HarnessModelProviderError(
        'harness.model_provider_unavailable',
        'Mira\'s configured agent model provider is not ready.'
      )
    }
    const configuredModel = provider.agentLLMName
    if (input.model !== configuredModel) {
      throw new HarnessModelProviderError(
        'harness.model_not_configured',
        'The harness cannot select a model outside Mira configuration.',
        {
          requested_model: input.model,
          configured_model: configuredModel
        }
      )
    }

    const capabilityToFunction = new Map<string, string>()
    const functionToCapability = new Map<string, string>()
    const tools: OpenAITool[] = input.tools.map((tool) => {
      const functionName = functionNameForCapability(tool.capability_id)
      const existing = functionToCapability.get(functionName)
      if (existing && existing !== tool.capability_id) {
        throw new HarnessModelProviderError(
          'harness.model_tool_name_collision',
          'Two harness capabilities map to the same model tool name.'
        )
      }
      capabilityToFunction.set(tool.capability_id, functionName)
      functionToCapability.set(functionName, tool.capability_id)
      return {
        type: 'function',
        function: {
          name: functionName,
          description: tool.description,
          parameters: structuredClone(tool.input_schema)
        }
      }
    })

    const prompts = messageText(input)
    const completion = asCompletionResult(
      await provider.prompt(prompts.prompt, {
        dutyType: LLMDuties.ReAct,
        systemPrompt: prompts.systemPrompt,
        maxTokens: input.max_output_tokens ?? 1_024,
        temperature: input.temperature ?? 0,
        signal: input.signal,
        shouldStream: false,
        trackProviderErrors: false,
        maxRetries: 0,
        remoteProviderErrorRetries: 0,
        ...(tools.length > 0 ? { tools, toolChoice: 'auto' as const } : {})
      })
    )

    if (!completion.output && !completion.toolCalls) {
      throw new HarnessModelProviderError(
        'harness.model_completion_unavailable',
        'Mira\'s configured model did not return a usable completion.'
      )
    }

    const output = typeof completion.output === 'string' ? completion.output.trim() : ''
    const toolRequests = parseToolCalls(
      completion.toolCalls,
      functionToCapability
    )
    const inputTokens = numberOrNull(completion.usedInputTokens)
    const outputTokens = numberOrNull(completion.usedOutputTokens)

    return {
      parts: output ? [{ type: 'text', text: output }] : [],
      tool_requests: toolRequests,
      finish_reason: toolRequests.length > 0 ? 'tool_requests' : 'stop',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens:
          inputTokens !== null && outputTokens !== null
            ? inputTokens + outputTokens
            : null
      },
      provider_metadata: {
        provider: this.configuredProvider,
        model: configuredModel,
        generation_duration_ms: numberOrNull(completion.generationDurationMs),
        provider_decode_duration_ms: numberOrNull(
          completion.providerDecodeDurationMs
        ),
        provider_tokens_per_second: numberOrNull(
          completion.providerTokensPerSecond
        )
      }
    }
  }
}
