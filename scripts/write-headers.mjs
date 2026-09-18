// Render the shared security headers into public/_headers (see cloudflare/src/headers.js).
import { writeFileSync } from 'node:fs'
import { headersFileText } from '../cloudflare/src/headers.js'
writeFileSync(new URL('../public/_headers', import.meta.url), headersFileText())
console.log('wrote public/_headers')
