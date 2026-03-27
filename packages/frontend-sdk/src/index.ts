/**
 * @leon-ai/frontend-sdk
 *
 * Typed HTTP and Socket.IO client SDK for the Leon personal assistant.
 * Designed for lightweight clients (Raspberry Pi, Smart Mirror, iOS, watchOS).
 */

// Types
export type {
  LeonBaseResponse,
  LeonLLMInfo,
  LeonSTTInfo,
  LeonTTSInfo,
  LeonTCPServerInfo,
  LeonMoodInfo,
  LeonInfoResponse,
  LeonUtteranceResponse,
  LeonRunActionParams,
  LeonRunActionResponse,
  LeonFetchWidgetParams,
  LeonFetchWidgetResponse,
  ConnectionState,
  InputMode,
  LeonCapabilities,
  ConversationMessage,
  LeonClientState
} from './types.js'

// Error
export { LeonAPIError } from './error.js'

// HTTP adapter
export { HttpAdapter } from './http-adapter.js'
export type { HttpAdapterOptions } from './http-adapter.js'

// HTTP API clients
export { getInfo } from './clients/info.js'
export { postUtterance } from './clients/utterance.js'
export { runAction } from './clients/run-action.js'
export { fetchWidget } from './clients/widget.js'

// Socket.IO event map types
export type {
  LeonServerEvents,
  LeonClientEvents,
  UtterancePayload,
  HotwordDetectedPayload,
  WidgetEventPayload,
  LLMInitStatus
} from './realtime.js'
