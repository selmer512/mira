/**
 * Minimal reactive state store for Leon web-lite.
 *
 * Thin clients keep a bounded conversation window and a widget cache keyed by
 * (skill_action, widget_id) to avoid unbounded memory growth on low-power hardware.
 */

export type ConnectionState = 'disconnected' | 'connecting' | 'ready'
export type InputMode = 'text' | 'voice'

export interface LLMCapability {
  enabled: boolean
  provider: string
}

export interface FeatureCapability {
  enabled: boolean
  provider: string
}

export interface Capabilities {
  llm: LLMCapability
  stt: FeatureCapability
  tts: FeatureCapability
  routingMode: string
  shouldWarmUpLLMDuties: boolean
  mood: { type: string; emoji: string }
  version: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

/** Maximum messages kept in the rolling conversation window. */
export const MAX_MESSAGES = 50

export interface AppState {
  connection: ConnectionState
  capabilities: Capabilities | null
  /** Rolling conversation window, newest last. Capped at MAX_MESSAGES. */
  conversation: Message[]
  /** Widget cache: key = `${skill_action}::${widget_id}` */
  widgets: Record<string, unknown>
  inputMode: InputMode
  /** True while Leon is generating an answer. */
  isTyping: boolean
}

type Listener = (state: AppState) => void

function createInitialState(): AppState {
  return {
    connection: 'disconnected',
    capabilities: null,
    conversation: [],
    widgets: {},
    inputMode: 'text',
    isTyping: false
  }
}

/** Simple synchronous pub/sub store — no external dependency needed. */
class Store {
  private state: AppState = createInitialState()
  private listeners = new Set<Listener>()

  getState(): AppState {
    return this.state
  }

  setState(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l(this.state)
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  addMessage(msg: Omit<Message, 'id' | 'timestamp'>): void {
    const newMsg: Message = {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    }
    const next = [...this.state.conversation, newMsg]
    this.setState({
      conversation: next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next
    })
  }

  cacheWidget(skillAction: string, widgetId: string, widget: unknown): void {
    const key = `${skillAction}::${widgetId}`
    this.setState({ widgets: { ...this.state.widgets, [key]: widget } })
  }

  getWidget(skillAction: string, widgetId: string): unknown | undefined {
    return this.state.widgets[`${skillAction}::${widgetId}`]
  }
}

export const store = new Store()
