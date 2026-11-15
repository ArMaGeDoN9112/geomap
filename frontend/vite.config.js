import { defineConfig, loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('..', import.meta.url)), '')

  return {
    esbuild: { jsx: 'automatic' },
    server: {
      proxy: { '/api': `http://127.0.0.1:${env.API_PORT || 8000}` },
    },
  }
})
