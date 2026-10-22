import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Kept separate from vite.config.js so vite-plugin-electron does not run under vitest.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
  },
})
