import type {
  HarnessArtifact,
  HarnessMessagePart,
  HarnessTaskState
} from './contracts'

export interface McpCapabilitySet {
  tools: boolean
  resources: boolean
  prompts: boolean
  sampling: boolean
  elicitation: boolean
  roots: boolean
  logging: boolean
}

export interface McpServerDescriptor {
  server_id: string
  name: string
  version: string
  protocol_version: string
  capabilities: McpCapabilitySet
}

export interface McpToolDescriptor {
  name: string
  description: string
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown> | null
  annotations: Record<string, unknown>
}

export interface McpToolCallInput {
  server_id: string
  tool_name: string
  arguments: Record<string, unknown>
  progress_token: string
  signal: AbortSignal
}

export interface McpToolCallResult {
  content: HarnessMessagePart[]
  structured_content: unknown
  is_error: boolean
  resource_refs: string[]
  metadata: Record<string, unknown>
}

export interface McpClientPort {
  initialize(signal: AbortSignal): Promise<McpServerDescriptor>
  listTools(signal: AbortSignal): Promise<McpToolDescriptor[]>
  callTool(input: McpToolCallInput): Promise<McpToolCallResult>
  cancel(progressToken: string): Promise<void>
}

export interface A2ARemoteAgentCard {
  agent_id: string
  name: string
  description: string
  version: string
  protocol_version: string
  endpoint_ref: string
  supports_streaming: boolean
  supports_push_notifications: boolean
  supports_authenticated_extended_card: boolean
  skills: Array<{
    skill_id: string
    name: string
    description: string
    tags: string[]
    input_modes: string[]
    output_modes: string[]
  }>
}

export interface A2ASendMessageInput {
  agent_id: string
  skill_id: string
  context_id: string
  idempotency_key: string
  parts: HarnessMessagePart[]
  signal: AbortSignal
}

export interface A2ARemoteTaskView {
  remote_task_id: string
  context_id: string
  state: HarnessTaskState
  messages: HarnessMessagePart[]
  artifacts: Omit<
    HarnessArtifact,
    'artifact_id' | 'created_at' | 'capability_id'
  >[]
  error: { code: string, message: string } | null
}

export interface A2AClientPort {
  getAgentCard(agentId: string, signal: AbortSignal): Promise<A2ARemoteAgentCard>
  sendMessage(input: A2ASendMessageInput): Promise<A2ARemoteTaskView>
  getTask(
    agentId: string,
    remoteTaskId: string,
    signal: AbortSignal
  ): Promise<A2ARemoteTaskView>
  cancelTask(agentId: string, remoteTaskId: string): Promise<A2ARemoteTaskView>
}

export interface ModelMessage {
  role: 'system' | 'owner' | 'assistant' | 'tool'
  parts: HarnessMessagePart[]
}

export interface ModelToolDefinition {
  capability_id: string
  description: string
  input_schema: Record<string, unknown>
}

export interface ModelInvocationInput {
  provider: string
  model: string
  messages: ModelMessage[]
  tools: ModelToolDefinition[]
  response_schema: Record<string, unknown> | null
  temperature: number | null
  max_output_tokens: number | null
  signal: AbortSignal
}

export interface ModelInvocationResult {
  parts: HarnessMessagePart[]
  tool_requests: Array<{
    request_id: string
    capability_id: string
    arguments: Record<string, unknown>
  }>
  finish_reason: string
  usage: {
    input_tokens: number | null
    output_tokens: number | null
    total_tokens: number | null
  }
  provider_metadata: Record<string, unknown>
}

export interface ModelProviderPort {
  invoke(input: ModelInvocationInput): Promise<ModelInvocationResult>
}
