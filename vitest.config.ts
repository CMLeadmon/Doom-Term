import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Same alias as vite.config.ts, and for the same reason: @xterm/headless@6.0.0
  // has a `module` field pointing at a file it does not ship. Resolving to the
  // same entry here is what keeps a green suite from hiding a broken build.
  resolve: {
    alias: { '@xterm/headless': '@xterm/headless/lib-headless/xterm-headless.mjs' },
  },
  test: { environment: 'jsdom', globals: true, include: ['src/**/*.test.{ts,tsx}'] },
});
