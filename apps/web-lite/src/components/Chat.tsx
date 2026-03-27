/** @jsxImportSource preact */
import { useState, useEffect, useRef } from 'preact/hooks'
import { store, type Message } from '../store.js'
import { sendUtterance } from '../leon-client.js'
import './Chat.css'

export function Chat() {
  const [messages, setMessages] = useState<Message[]>(
    store.getState().conversation
  )
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(store.getState().isTyping)
  const [isReady, setIsReady] = useState(
    store.getState().connection === 'ready'
  )
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = store.subscribe((s) => {
      setMessages([...s.conversation])
      setIsTyping(s.isTyping)
      setIsReady(s.connection === 'ready')
    })
    return unsub
  }, [])

  // Scroll to newest message
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSubmit(e: Event) {
    e.preventDefault()
    const text = inputValue.trim()
    if (!text || !isReady) return

    store.addMessage({ role: 'user', content: text })
    sendUtterance(text)
    setInputValue('')
  }

  return (
    <section class="chat">
      <div class="chat__messages" role="log" aria-live="polite">
        {messages.map((msg) => (
          <div
            key={msg.id}
            class={`chat__bubble chat__bubble--${msg.role}`}
          >
            {msg.content}
          </div>
        ))}
        {isTyping && (
          <div class="chat__bubble chat__bubble--assistant chat__bubble--typing">
            <span class="chat__dots">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form class="chat__input-row" onSubmit={handleSubmit}>
        <input
          class="chat__input"
          type="text"
          placeholder={isReady ? 'Ask Leon…' : 'Connecting…'}
          value={inputValue}
          onInput={(e) => setInputValue((e.target as HTMLInputElement).value)}
          disabled={!isReady}
          aria-label="Message input"
        />
        <button
          class="chat__send"
          type="submit"
          disabled={!isReady || !inputValue.trim()}
          aria-label="Send"
        >
          ↑
        </button>
      </form>
    </section>
  )
}
