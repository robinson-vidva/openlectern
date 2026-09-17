import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Cloudflare Worker serves the app at the domain root, so build with
// BASE_PATH=/ there. GitHub Pages serves under the repo subpath, so it defaults
// to /openlectern/ when BASE_PATH is unset.
export default defineConfig({
  base: process.env.BASE_PATH || '/openlectern/',
  plugins: [react()]
})
