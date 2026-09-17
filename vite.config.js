import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served at the domain root by the Cloudflare Worker, so base defaults to '/'.
// Set BASE_PATH to a subpath (e.g. '/openlectern/') only if hosting under one.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()]
})
