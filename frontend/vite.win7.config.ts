import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// Win7 must use the last Electron major that supports Windows 7 (Electron 22,
// Chromium 108). This config is deliberately separate from the Wails build.
const runtimeShim = fileURLToPath(new URL('./src/win7/wails-runtime.ts', import.meta.url))
const version = process.env.VITE_VERSION || 'win7-legacy-dev'

export default defineConfig({
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      '@wailsio/runtime': runtimeShim
    }
  },
  define: {
    'import.meta.env.VITE_VERSION': JSON.stringify(version)
  },
  build: {
    outDir: 'dist-win7',
    emptyOutDir: true,
    target: 'chrome108',
    cssTarget: 'chrome108'
  },
  esbuild: {
    target: 'chrome108'
  },
  server: {
    host: '127.0.0.1',
    port: 34116,
    strictPort: true
  }
})
