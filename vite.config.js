import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base must match the GitHub Pages subpath (repo name) so assets resolve.
export default defineConfig({
  base: '/openlectern/',
  plugins: [react()]
})
