import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@@': ROOT_DIR,
      '@': path.join(ROOT_DIR, 'server', 'src'),
      '@bridge': path.join(ROOT_DIR, 'bridges', 'nodejs', 'src'),
      '@sdk': path.join(ROOT_DIR, 'bridges', 'nodejs', 'src', 'sdk')
    }
  },
  test: {
    environment: 'node',
    include: ['test/e2e/over-http.spec.ts'],
    fileParallelism: false,
    restoreMocks: true,
    clearMocks: true,
    unstubEnvs: true,
    testTimeout: 30_000
  }
})
