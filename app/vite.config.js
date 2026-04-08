import dns from 'node:dns'

import dotenv from 'dotenv'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

dotenv.config()

dns.setDefaultResultOrder('verbatim')

// Map necessary Mira's env vars as Vite only expose VITE_*
process.env.VITE_MIRA_NODE_ENV = process.env.MIRA_NODE_ENV
process.env.VITE_MIRA_HOST = process.env.MIRA_HOST
process.env.VITE_MIRA_PORT = process.env.MIRA_PORT

export default defineConfig({
  root: 'app/src',
  build: {
    outDir: '../dist',
    emptyOutDir: true
  },
  server: {
    port: 3000
  },
  plugins: [react()]
})
