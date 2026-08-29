import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/db-integration/**'],
    // next-auth imports 'next/server', and the next package ships no exports map, so Node's
    // ESM resolver cannot resolve the extensionless subpath. Letting Vite transform next-auth
    // instead of externalising it puts the import through a resolver that can.
    server: { deps: { inline: ['next-auth'] } },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
      // The server-only package resolves to a module that throws unless the react-server
      // export condition is active, which it is not under vitest.
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
    },
  },
})
