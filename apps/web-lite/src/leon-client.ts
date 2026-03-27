/**
 * Leon backend connection layer for web-lite.
 *
 * Bootstraps capabilities from GET /info, then connects via Socket.IO
 * and maintains the app's connection state.
 */

import { io, type Socket } from 'socket.io-client'
import { store } from './store.js'

declare const __LEON_BASE_URL__: string
declare const __API_VERSION__: string

const BASE_URL: string = __LEON_BASE_URL__
const API_VERSION: string = __API_VERSION__

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function fetchInfo(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/${API_VERSION}/info`, {
    headers: { Accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`/info returned ${res.status}`)
  const data = (await res.json()) as {
    llm: { enabled: boolean; provider: string }
    stt: { enabled: boolean; provider: string }
    tts: { enabled: boolean; provider: string }
    routingMode: string
    shouldWarmUpLLMDuties: boolean
    mood: { type: string; emoji: string }
    version: string
  }
  store.setState({
    capabilities: {
      llm: data.llm,
      stt: data.stt,
      tts: data.tts,
      routingMode: data.routingMode,
      shouldWarmUpLLMDuties: data.shouldWarmUpLLMDuties,
      mood: data.mood,
      version: data.version
    }
  })
}

// ---------------------------------------------------------------------------
// Socket.IO connection
// ---------------------------------------------------------------------------

let socket: Socket | null = null

function connectSocket(): void {
  socket = io(BASE_URL)

  socket.on('connect', () => {
    store.setState({ connection: 'connecting' })
    socket!.emit('init', 'web-lite')
  })

  socket.on('ready', () => {
    store.setState({ connection: 'ready' })
  })

  socket.on('is-typing', (isTyping: boolean) => {
    store.setState({ isTyping })
  })

  socket.on('disconnect', () => {
    store.setState({ connection: 'disconnected', isTyping: false })
  })

  socket.on('connect_error', () => {
    store.setState({ connection: 'disconnected' })
  })
}

/** Send an utterance over the socket. */
export function sendUtterance(value: string): void {
  if (!socket?.connected) return
  socket.emit('utterance', { client: 'web-lite', value })
}

/** Trigger a widget interaction event. */
export function sendWidgetEvent(
  methodName: string,
  methodParams: Record<string, unknown>,
  data: Record<string, unknown>
): void {
  if (!socket?.connected) return
  socket.emit('widget-event', { method: { methodName, methodParams }, data })
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/** Call once on app startup. */
export async function bootstrap(): Promise<void> {
  store.setState({ connection: 'connecting' })
  try {
    await fetchInfo()
  } catch (err) {
    console.warn('[web-lite] Could not fetch /info:', err)
  }
  connectSocket()
}
