import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { cpSync, existsSync } from 'node:fs'

const copyUiAssets = () => ({
  name: 'copy-ui-assets',
  buildStart() {
    const src = path.resolve(__dirname, '../node_modules/@hexnest/ui/assets')
    const dst = path.resolve(__dirname, 'public/assets')
    if (existsSync(src)) cpSync(src, dst, { recursive: true })
  }
})

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    copyUiAssets(),
  ],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    proxy: {
      '/api': 'http://127.0.0.1:3000'
    }
  }
})
