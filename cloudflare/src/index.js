// OpenLectern Worker. Serves the built app AND the session API on one origin,
// routes each session to its Durable Object, adds security headers to every
// response, and rate-limits session creation. Replaces Supabase entirely.
//
//   POST   /api/session              { pin, config }        -> create, returns row
//   POST   /api/session/:code/join   { pin }                -> join (PIN), returns row
//   GET    /api/session/:code/view                          -> view (no PIN), returns row
//   PATCH  /api/session/:code        { pin, patch }         -> update, returns merged row
//   GET    /api/session/:code/ws                            -> WebSocket (state/presence/broadcast)
//   everything else                                         -> the static app (SPA)

import { SessionDO, RateLimiterDO, CODE_ALPHABET } from './session-do.js'

export { SessionDO, RateLimiterDO }

// Allow Cloudflare Web Analytics' beacon (enabled in the dashboard) without
// loosening anything else.
const ANALYTICS = 'https://static.cloudflareinsights.com'

function securityHeaders() {
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${ANALYTICS}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    // 'self' covers same-origin API + WebSocket; HelloAO is the online-translation
    // fallback; ANALYTICS is the Cloudflare beacon.
    `connect-src 'self' ${ANALYTICS} https://bible.helloao.org`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests'
  ].join('; ')
  return {
    'Content-Security-Policy': csp,
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'microphone=(self), fullscreen=(self), camera=(), geolocation=()'
  }
}

// CORS is opt-in: the app is same-origin, so no header is needed. Set an
// ALLOWED_ORIGIN var only if you serve the app from a different origin.
function corsHeaders(env) {
  if (!env.ALLOWED_ORIGIN) return {}
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type'
  }
}

function decorate(res, env) {
  const h = new Headers(res.headers)
  for (const [k, v] of Object.entries(securityHeaders())) h.set(k, v)
  for (const [k, v] of Object.entries(corsHeaders(env))) h.set(k, v)
  return new Response(res.body, { status: res.status, headers: h })
}
function json(body, status, env) {
  return decorate(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }), env)
}

function randomCode() {
  let s = ''
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return s
}
function sessionStub(env, code) {
  return env.SESSIONS.get(env.SESSIONS.idFromName(code))
}
function callDO(env, code, action, body) {
  const req = new Request(`https://do/${action}?code=${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {})
  })
  return sessionStub(env, code).fetch(req)
}

// Fixed-window rate limit for one IP via a per-IP RateLimiterDO. Fails open if
// the limiter itself errors -- never block a real service over a limiter hiccup.
async function allowCreate(env, ip) {
  try {
    const stub = env.RATELIMIT.get(env.RATELIMIT.idFromName(`create:${ip}`))
    const res = await stub.fetch(
      new Request('https://do/limit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ limit: 20, windowMs: 60000 })
      })
    )
    return res.status !== 429
  } catch {
    return true
  }
}

async function handleApi(request, env, parts) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...securityHeaders(), ...corsHeaders(env) } })
  }

  // POST /api/session -> create (rate-limited per IP; retry code collisions)
  if (parts.length === 2 && request.method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
    if (!(await allowCreate(env, ip))) {
      return json({ error: 'too many sessions created, try again shortly' }, 429, env)
    }
    const body = await request.json().catch(() => ({}))
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = randomCode()
      const res = await callDO(env, code, 'create', { ...body, code })
      if (res.status === 409) continue
      return decorate(res, env)
    }
    return json({ error: 'could not allocate a session code' }, 503, env)
  }

  const code = (parts[2] || '').toUpperCase()
  const action = parts[3] || ''

  // GET /api/session/:code/ws -> WebSocket upgrade (forward original request).
  if (action === 'ws' && request.method === 'GET') {
    return sessionStub(env, code).fetch(request) // 101 response: never decorate
  }
  if (action === 'join' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}))
    return decorate(await callDO(env, code, 'join', body), env)
  }
  if (action === 'view' && request.method === 'GET') {
    return decorate(await callDO(env, code, 'view', null), env)
  }
  if (!action && request.method === 'PATCH') {
    const body = await request.json().catch(() => ({}))
    return decorate(await callDO(env, code, 'update', body), env)
  }
  return json({ error: 'not found' }, 404, env)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    if (parts[0] === 'api' && parts[1] === 'session') {
      return handleApi(request, env, parts)
    }
    // Everything else is the static app. Serve it via the assets binding and add
    // the security headers (assets alone can't set them).
    return decorate(await env.ASSETS.fetch(request), env)
  }
}
