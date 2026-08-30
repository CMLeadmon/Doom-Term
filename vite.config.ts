import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
/**
 * @xterm/headless@6.0.0 ships a broken `module` field: its package.json points
 * at `lib/xterm.mjs`, which does not exist in the tarball — the ESM build is at
 * `lib-headless/xterm-headless.mjs`. Rollup prefers `module` and fails to
 * resolve the entry; vitest resolves `main`, which does exist, so the test suite
 * stays green while `npm run build` dies. Point both at the file that is really
 * there. Remove once upstream fixes the field.
 */
const XTERM_HEADLESS_ESM = '@xterm/headless/lib-headless/xterm-headless.mjs';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@xterm/headless': XTERM_HEADLESS_ESM },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: true,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG
  }
});
