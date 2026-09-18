import type {
  HarnessArtifact,
  HarnessMessagePart,
  HarnessTaskState
} from './contracts'

export const MCP_PROTOCOL_VERSION = '2026-07-28'
export const A2A_PROTOCOL_VERSION = '1.0.0'

export interface McpRequestContext {
  protocol_version: typeof MCP_PROTOCOL_VERSION
  client_info: {
    name: string
    version: string
  }
  capabilities: {
    tasks: boolean
  }
  extensions: string[]
  request_id: string
}

export interface McpCapabilitySet {
  tools: boolean
  resources: boolean
  prompts: boolean
  tasks: boolean
}

export interface McpServerDescriptor {
  server_id: string
  name: string
  version: string
  protocol_version: typeof MCP_PROTOCOL_VERSION
  capabilities: McpCapabilitySet
  extensions: string[]
}

export interface McpToolDescriptor {
  name: string
  description: string
  input_schema: Record<string, unknown>
  output_schema: Record<string, unknown> | null
  annotations: Record<string, unknown>
}

export interface McpListToolsResult {
  tools: McpToolDescriptor[]
  cache: {
    ttl_ms: number
    scope: 'request' | 'client' | 'server'
  }
}

export interface McpToolCallInput {
  context: McpRequestContext
  server_id: string
  tool_name: string
  arguments: Record<string, unknown>
  signal: AbortSignal
}

export interface McpToolCallResult {
  content: HarnessMessagePart[]
  structured_content: unknown
  is_error: boolean
  resource_refs: string[]
  metadata: Record<string, unknown>
}

export interface McpTaskExtensionDescriptor {
  extension_id: 'io.modelcontextprotocol/tasks'
  supported: boolean
}

export interface McpClientPort {
  discover(
    context: McpRequestContext,
    signal: AbortSignal
  ): Promise<McpServerDescriptor>
  listTools(
    context: McpRequestContext,
    signal: AbortSignal
  ): Promise<McpListToolsResult>
  callTool(input: McpToolCallInput): Promise<McpToolCallResult>
}

export interface A2ARemoteAgentCard {
  agent_id: string
  name: string
  description: string
  version: string
  protocol_version: typeof A2A_PROTOCOL_VERSION
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
