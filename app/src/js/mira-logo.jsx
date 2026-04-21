import { useState, useEffect } from 'react'
import { MiraPresence } from './mira-presence.jsx'

export default function MiraLogo() {
  const [mode, setMode] = useState('idle')

  useEffect(() => {
    const handler = (e) => setMode(e.detail.mode)
    window.addEventListener('mira-mode-change', handler)
    return () => window.removeEventListener('mira-mode-change', handler)
  }, [])

  return <MiraPresence mode={mode} size={44} animated showBackground={false} />
}
