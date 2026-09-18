import { describe, it, expect } from 'vitest'
import worker from '../cloudflare/src/index.js'

// The asset layer answers for files it has; everything else falls to the Worker,
// which must serve the HTML shell (with security headers) for page navigations
// and a real 404 for missing files.
function env(assets) {
  return {
    ASSETS: {
      fetch: async (req) => {
        const path = new URL(req.url).pathname
        if (path in assets) return new Response(assets[path], { status: 200, headers: { 'content-type': 'application/json' } })
        return new Response('not found', { status: 404 })
      }
    }
  }
}
const get = (e, path, headers = {}) => worker.fetch(new Request(`https://x${path}`, { headers }), e)

describe('app shell + assets', () => {
  const e = env({ '/bibles/manifest.json': '{"versions":[]}' })
  it('serves the shell for / with the security headers', async () => {
    const res = await get(e, '/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('x-openlectern-source')).toBe('worker')
    expect(await res.text()).toContain('<!doctype html>')
  })
  it('serves the shell for any non-file path (hash-routed SPA) and for /index.html', async () => {
    for (const p of ['/foo/bar', '/index.html', '/control']) {
      const res = await get(e, p, { Accept: 'text/html' })
      expect(res.status, p).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')
    }
  })
  it('passes existing files through with the headers added', async () => {
    const res = await get(e, '/bibles/manifest.json')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"versions":[]}')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
  it('returns a real 404 for a missing file fetched by script, not a soft-404 page', async () => {
    const res = await get(e, '/bibles/xyz/MAT.json', { Accept: '*/*' })
    expect(res.status).toBe(404)
  })
  it('rejects non-GET methods on app paths', async () => {
    const res = await worker.fetch(new Request('https://x/', { method: 'POST' }), e)
    expect(res.status).toBe(405)
  })
})
