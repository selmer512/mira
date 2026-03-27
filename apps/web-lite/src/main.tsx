/** @jsxImportSource preact */
import { render } from 'preact'
import { App } from './App.js'
import { bootstrap } from './leon-client.js'
import './css/global.css'

declare const __KIOSK__: boolean

// Apply kiosk class on <body> when built with VITE_KIOSK=true
if (__KIOSK__) {
  document.body.classList.add('kiosk')
  // Lazy-load kiosk CSS so it doesn't affect non-kiosk builds
  import('./css/kiosk.css')
}

// Mount UI
const container = document.getElementById('app')
if (container) {
  render(<App />, container)
}

// Bootstrap backend connection + capabilities
bootstrap().catch((err) => {
  console.error('[web-lite] Bootstrap failed:', err)
})
