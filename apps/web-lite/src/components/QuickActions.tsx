/** @jsxImportSource preact */
import { useState, useEffect } from 'preact/hooks'
import { store } from '../store.js'
import { sendUtterance } from '../leon-client.js'
import './QuickActions.css'

interface QuickAction {
  id: string
  label: string
  utterance: string
  icon: string
}

const DEFAULT_ACTIONS: QuickAction[] = [
  { id: 'time', label: 'Time', utterance: 'What time is it?', icon: '🕐' },
  { id: 'weather', label: 'Weather', utterance: 'What is the weather?', icon: '🌤' },
  { id: 'timer', label: 'Timer', utterance: 'Set a timer for 5 minutes', icon: '⏱' },
  { id: 'joke', label: 'Joke', utterance: 'Tell me a joke', icon: '😄' }
]

export function QuickActions() {
  const [isReady, setIsReady] = useState(
    store.getState().connection === 'ready'
  )
  const [sttEnabled, setSttEnabled] = useState(
    store.getState().capabilities?.stt.enabled ?? false
  )

  useEffect(() => {
    const unsub = store.subscribe((s) => {
      setIsReady(s.connection === 'ready')
      setSttEnabled(s.capabilities?.stt.enabled ?? false)
    })
    return unsub
  }, [])

  function handleAction(action: QuickAction) {
    if (!isReady) return
    store.addMessage({ role: 'user', content: action.utterance })
    sendUtterance(action.utterance)
  }

  return (
    <div class="quick-actions">
      <p class="quick-actions__label">Quick actions</p>
      <div class="quick-actions__grid">
        {DEFAULT_ACTIONS.map((action) => (
          <button
            key={action.id}
            class="quick-actions__btn"
            onClick={() => handleAction(action)}
            disabled={!isReady}
            title={action.utterance}
          >
            <span class="quick-actions__icon">{action.icon}</span>
            <span class="quick-actions__text">{action.label}</span>
          </button>
        ))}

        {sttEnabled && (
          <button
            class="quick-actions__btn quick-actions__btn--mic"
            disabled={!isReady}
            title="Push to talk"
            onClick={() => store.setState({ inputMode: 'voice' })}
          >
            <span class="quick-actions__icon">🎤</span>
            <span class="quick-actions__text">Voice</span>
          </button>
        )}
      </div>
    </div>
  )
}
