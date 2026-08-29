import { existsSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Vitest runs outside Next, which is what normally loads .env.local.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db-integration/**/*.test.ts'],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
    },
  },
})
