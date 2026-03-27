/**
 * Shared type definitions for the Leon Frontend SDK.
 * These mirror the JSON shapes returned by the Leon HTTP API.
 */

// ---------------------------------------------------------------------------
// Base API response
// ---------------------------------------------------------------------------

export interface LeonBaseResponse {
  success: boolean
  status: number
  code: string
  message: string
}

// ---------------------------------------------------------------------------
// GET /api/v1/info
// ---------------------------------------------------------------------------

export interface LeonLLMInfo {
  enabled: boolean
  provider: string
  workflowProvider: string
  agentProvider: string
  workflowModel: string
  agentModel: string
  localModel: string
}

export interface LeonSTTInfo {
  enabled: boolean
  provider: string
}

export interface LeonTTSInfo {
  enabled: boolean
  provider: string
}

export interface LeonTCPServerInfo {
  enabled: boolean
}

export interface LeonMoodInfo {
  type: string
  emoji: string
}

export interface LeonInfoResponse extends LeonBaseResponse {
  after_speech: boolean
  telemetry: boolean
  shouldWarmUpLLMDuties: boolean
  isLLMActionRecognitionEnabled: boolean
  isLLMNLGEnabled: boolean
  timeZone: string
  gpu: string
  graphicsComputeAPI: string
  totalVRAM: number
  freeVRAM: number
  usedVRAM: number
  llm: LeonLLMInfo
  stt: LeonSTTInfo
  tts: LeonTTSInfo
  routingMode: string
  tcpServer: LeonTCPServerInfo
  mood: LeonMoodInfo
  version: string
}

// ---------------------------------------------------------------------------
// POST /api/v1/utterance
// ---------------------------------------------------------------------------

export interface LeonUtteranceResponse extends LeonBaseResponse {
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// POST /api/v1/run-action
// ---------------------------------------------------------------------------

export interface LeonRunActionParams {
  skill_action: string
  action_params: Record<string, unknown>
}

export interface LeonRunActionResponse extends LeonBaseResponse {
  result: unknown
}

// ---------------------------------------------------------------------------
// GET /api/v1/fetch-widget
// ---------------------------------------------------------------------------

export interface LeonFetchWidgetParams {
  skill_action: string
  widget_id: string
}

export interface LeonFetchWidgetResponse extends LeonBaseResponse {
  widget: unknown
}

// ---------------------------------------------------------------------------
// Thin-client state store shape
// ---------------------------------------------------------------------------

export type ConnectionState = 'disconnected' | 'connecting' | 'ready'
export type InputMode = 'text' | 'voice'

export interface LeonCapabilities {
  llm: LeonLLMInfo
  stt: LeonSTTInfo
  tts: LeonTTSInfo
  routingMode: string
  shouldWarmUpLLMDuties: boolean
}

export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface LeonClientState {
  connection: ConnectionState
  capabilities: LeonCapabilities | null
  conversation: ConversationMessage[]
  widgets: Record<string, unknown>
  inputMode: InputMode
}
