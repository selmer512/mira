import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// Kiosk mode: set VITE_KIOSK=true to enable Smart Mirror / Raspberry Pi kiosk styles
const isKiosk = process.env['VITE_KIOSK'] === 'true'

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: 3001
  },
  plugins: [preact()],
  define: {
    __KIOSK__: JSON.stringify(isKiosk),
    __LEON_BASE_URL__: JSON.stringify(
      process.env['VITE_LEON_BASE_URL'] ?? 'http://localhost:1337'
    ),
    __API_VERSION__: JSON.stringify(
      process.env['VITE_LEON_API_VERSION'] ?? 'v1'
    )
  }
})
