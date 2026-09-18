// OpenLectern Worker. Serves the built app AND the session API on one origin,
// routes each session to its Durable Object, adds security headers to every
// response, and rate-limits session creation. Replaces Supabase entirely.
//
//   GET    /api/config                                       -> public runtime config (Turnstile site key)
//   POST   /api/session              { pin, config, turnstile } -> create, returns row
//   POST   /api/session/:code/join   { pin }                -> join (PIN), returns row
//   GET    /api/session/:code/view                          -> view (no PIN), returns row
//   PATCH  /api/session/:code        { pin, patch }         -> update, returns merged row
//   POST   /api/session/:code/broadcast { pin, event, payload, from } -> PIN-verified peer event
//   GET    /api/session/:code/ws                            -> WebSocket (state/presence/broadcast)
//   everything else                                         -> the static app (SPA)

import { SessionDO, RateLimiterDO, CODE_ALPHABET } from './session-do.js'
import { securityHeaders, SOURCE_HEADER, TURNSTILE } from './headers.js'

export { SessionDO, RateLimiterDO }

// Session codes are exactly 6 characters from CODE_ALPHABET. Reject anything
// else before it reaches a Durable Object: idFromName() would otherwise spin up
// (and bill) a fresh DO for every garbage code a scanner throws at /api.
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{6}$`)

const TURNSTILE_VERIFY = `${TURNSTILE}/turnstile/v0/siteverify`

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
  h.set(SOURCE_HEADER, 'worker')
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

// Cloudflare Turnstile check for session creation. Enabled by setting the
// TURNSTILE_SECRET secret (plus the TURNSTILE_SITE_KEY and TURNSTILE_HOSTNAMES
// vars) on the Worker; with no secret configured it is skipped, so a fresh deploy
// works before the keys exist. Fails CLOSED: a bot gate that waves everyone
// through when it can't verify isn't one. Tokens are single-use, so the client
// fetches a fresh one per attempt.
//
// Beyond `success`, the token must have been minted for THIS action and on one of
// OUR hostnames: a token solved on another site (or another form) using the same
// widget is not accepted. TURNSTILE_HOSTNAMES is a comma-separated allowlist;
// production must not include localhost.
const TURNSTILE_ACTION = 'create-session'
function turnstileHostnames(env) {
  return new Set(
    String(env.TURNSTILE_HOSTNAMES || '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  )
}
async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return null
  if (typeof token !== 'string' || !token || token.length > 2048) {
    return { status: 403, error: 'verification required' }
  }
  const hosts = turnstileHostnames(env)
  if (!hosts.size) return { status: 503, error: 'verification misconfigured (no TURNSTILE_HOSTNAMES)' }
  try {
    const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token })
    if (ip && ip !== 'unknown') form.set('remoteip', ip)
    const res = await fetch(TURNSTILE_VERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(10_000)
    })
    const data = await res.json()
    const ok =
      data &&
      data.success === true &&
      data.action === TURNSTILE_ACTION &&
      hosts.has(String(data.hostname || '').toLowerCase())
    return ok ? null : { status: 403, error: 'verification failed' }
  } catch {
    return { status: 503, error: 'verification unavailable, try again' }
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
    const { turnstile, ...body } = await request.json().catch(() => ({}))
    const human = await verifyTurnstile(env, turnstile, ip)
    if (human) return json({ error: human.error }, human.status, env)
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
  if (!CODE_RE.test(code)) return json({ error: 'not found' }, 404, env)

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
  if (action === 'broadcast' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}))
    return decorate(await callDO(env, code, 'broadcast', body), env)
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

    // Lightweight health check for uptime monitors (e.g. UptimeRobot).
    if (parts[0] === 'api' && parts[1] === 'health') {
      return json({ ok: true, service: 'openlectern', time: new Date().toISOString() }, 200, env)
    }
    // Public runtime config, so the app needs no rebuild when keys change. Only
    // the Turnstile SITE key (public by design) -- never the secret.
    if (parts[0] === 'api' && parts[1] === 'config') {
      return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || null }, 200, env)
    }
    if (parts[0] === 'api' && parts[1] === 'session') {
      return handleApi(request, env, parts)
    }
    // Everything else is the static app. Serve it via the assets binding and add
    // the security headers (assets alone can't set them).
    return decorate(await env.ASSETS.fetch(request), env)
  }
}
