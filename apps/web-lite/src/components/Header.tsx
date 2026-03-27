/** @jsxImportSource preact */
import { useState, useEffect } from 'preact/hooks'
import { store } from '../store.js'
import './Header.css'

export function Header() {
  const s = store.getState()
  const [connection, setConnection] = useState(s.connection)
  const [caps, setCaps] = useState(s.capabilities)

  useEffect(() => {
    return store.subscribe((state) => {
      setConnection(state.connection)
      setCaps(state.capabilities)
    })
  }, [])

  const statusLabel =
    connection === 'ready'
      ? 'Ready'
      : connection === 'connecting'
        ? 'Connecting…'
        : 'Offline'

  return (
    <header class="header">
      <span class="header__title">Leon</span>

      {caps?.mood && (
        <span class="header__mood" title={caps.mood.type}>
          {caps.mood.emoji}
        </span>
      )}

      <span class={`header__status header__status--${connection}`}>
        {statusLabel}
      </span>
    </header>
  )
}
