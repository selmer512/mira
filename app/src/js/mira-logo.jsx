import { useState, useEffect } from 'react'
import { MiraPresence } from './mira-presence.jsx'

function useMiraMode(initial = 'idle') {
  const [mode, setMode] = useState(initial)
  useEffect(() => {
    const handler = (e) => setMode(e.detail.mode)
    window.addEventListener('mira-mode-change', handler)
    return () => window.removeEventListener('mira-mode-change', handler)
  }, [])
  return mode
}

export default function MiraLogo() {
  const mode = useMiraMode()
  return <MiraPresence mode={mode} size={44} animated showBackground={false} />
}

export function MiraVoicePresence() {
  const mode = useMiraMode()
  const audioReactive = mode === 'listening' || mode === 'talking'
  return (
    <MiraPresence
      mode={mode}
      size={220}
      animated
      showBackground={false}
      responsiveToAudio={audioReactive}
    />
  )
}
