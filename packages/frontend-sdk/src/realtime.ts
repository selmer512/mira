/**
 * Typed Socket.IO event map for real-time communication with the Leon server.
 *
 * Usage example (browser):
 *   import { io } from 'socket.io-client'
 *   import type { LeonServerEvents, LeonClientEvents } from '@leon-ai/frontend-sdk'
 *
 *   const socket = io<LeonServerEvents, LeonClientEvents>(serverUrl)
 *
 *   socket.on('ready', () => console.log('Leon is ready'))
 *   socket.emit('utterance', { client: 'web-lite', value: 'Hello Leon!' })
 */

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export interface UtterancePayload {
  /** Originating client identifier */
  client: string
  /** Natural-language text */
  value: string
}

export interface HotwordDetectedPayload {
  hotword: string
  buffer: Buffer | ArrayBuffer
}

export interface WidgetEventPayload {
  method: {
    methodName: string
    methodParams: Record<string, string | number | undefined | unknown[]>
  }
  data: Record<string, string | number | undefined | unknown[]>
}

export type LLMInitStatus = 'loading' | 'success' | 'error'

// ---------------------------------------------------------------------------
// Events the *server* sends to connected clients (subscribe with `.on()`)
// ---------------------------------------------------------------------------

export interface LeonServerEvents {
  /** Handshake confirmed – server acknowledged the 'init' message */
  'init-client-core-server-handshake': (status: 'success') => void
  /** TCP bridge to Python server is ready */
  'init-tcp-server-boot': (status: 'success') => void
  /** LLM loaded and ready */
  'init-llm': (status: LLMInitStatus) => void
  /** llama.cpp HTTP server is ready */
  'init-llama-server-boot': (status: LLMInitStatus) => void
  /** LLM duties have been warmed up */
  'warmup-llm-duties': (status: 'success') => void
  /** All systems ready — safe to start sending utterances */
  ready: () => void
  /** Leon started/stopped generating a response */
  'is-typing': (isTyping: boolean) => void
  /** Instruct client to enable audio recording */
  'enable-record': () => void
  /** Relay an utterance back through the widget event pipeline */
  'widget-send-utterance': (utterance: string) => void
}

// ---------------------------------------------------------------------------
// Events the *client* sends to the server (emit with `.emit()`)
// ---------------------------------------------------------------------------

export interface LeonClientEvents {
  /** Trigger initialization handshake; pass the client type string */
  init: (clientType: string) => void
  /** Submit a natural-language utterance over the socket */
  utterance: (data: UtterancePayload) => void
  /** Notify server of a detected hotword */
  'hotword-detected': (data: HotwordDetectedPayload) => void
  /** Start streaming ASR audio input */
  'asr-start-record': () => void
  /** Send an audio buffer chunk for ASR recognition */
  recognize: (buffer: ArrayBuffer) => void
  /** Dispatch a widget interaction event */
  'widget-event': (event: WidgetEventPayload) => void
}
