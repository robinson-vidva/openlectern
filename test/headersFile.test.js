import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { headersFileText, securityHeaders } from '../cloudflare/src/headers.js'

// public/_headers is what the static-asset layer applies to index.html and the
// other assets it serves directly (the Worker is not invoked for those). It must
// be the exact rendering of the Worker's own header set. Regenerate with
// `npm run build:headers` after changing headers.js.
describe('public/_headers', () => {
  it('matches the Worker security headers', () => {
    expect(readFileSync('public/_headers', 'utf-8')).toBe(headersFileText())
  })
  it('covers every path and allows Turnstile', () => {
    const text = headersFileText()
    expect(text).toContain('\n/*\n')
    expect(text).toContain('frame-src https://challenges.cloudflare.com')
    expect(Object.keys(securityHeaders())).toContain('Content-Security-Policy')
  })
})
