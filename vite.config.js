import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served at the domain root by the Cloudflare Worker, so base defaults to '/'.
// Set BASE_PATH to a subpath (e.g. '/openlectern/') only if hosting under one.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  server: {
    // `npm run dev` with VITE_API_BASE=same-origin: forward /api (including the
    // session WebSocket) to `wrangler dev` running in cloudflare/ (port 8787), so
    // local development has a working backend. Override with API_PROXY.
    proxy: {
      '/api': { target: process.env.API_PROXY || 'http://localhost:8787', ws: true, changeOrigin: true }
    }
  }
})
