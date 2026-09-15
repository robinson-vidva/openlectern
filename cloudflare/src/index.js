// OpenLectern API Worker. Routes session requests to a per-code Durable Object
// and serves the session realtime WebSocket. Replaces Supabase entirely.
//
//   POST   /api/session              { pin, config }        -> create, returns row
//   POST   /api/session/:code/join   { pin }                -> join (PIN), returns row
//   GET    /api/session/:code/view                          -> view (no PIN), returns row
//   PATCH  /api/session/:code        { pin, patch }         -> update, returns merged row
//   GET    /api/session/:code/ws                            -> WebSocket (state/presence/broadcast)

import { SessionDO, CODE_ALPHABET } from './session-do.js'

export { SessionDO }

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400'
  }
}
function withCors(res, env) {
  const h = new Headers(res.headers)
  for (const [k, v] of Object.entries(corsHeaders(env))) h.set(k, v)
  return new Response(res.body, { status: res.status, headers: h })
}
function json(body, status, env) {
  return withCors(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }), env)
}

function randomCode() {
  let s = ''
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return s
}

function stub(env, code) {
  return env.SESSIONS.get(env.SESSIONS.idFromName(code))
}
// Call a Durable Object action with a JSON body. The action is the final path
// segment; the DO reads it and ignores the method. Bodies are serialized here
// (not streamed) so no request headers or duplex handling are needed.
function callDO(env, code, action, body) {
  const req = new Request(`https://do/${action}?code=${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {})
  })
  return stub(env, code).fetch(req)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean) // ['api','session','ABC123','join']

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) })

    if (parts[0] !== 'api' || parts[1] !== 'session') {
      return json({ error: 'not found' }, 404, env)
    }

    // POST /api/session -> create (generate a unique code, retry on collision)
    if (parts.length === 2 && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = randomCode()
        const res = await callDO(env, code, 'create', { ...body, code })
        if (res.status === 409) continue // code already taken; try another
        return withCors(res, env)
      }
      return json({ error: 'could not allocate a session code' }, 503, env)
    }

    const code = (parts[2] || '').toUpperCase()
    const action = parts[3] || ''

    // GET /api/session/:code/ws -> WebSocket upgrade. Forward the ORIGINAL request
    // so the Upgrade header (and WebSocket semantics) are preserved.
    if (action === 'ws' && request.method === 'GET') {
      return stub(env, code).fetch(request)
    }
    // POST /api/session/:code/join
    if (action === 'join' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      return withCors(await callDO(env, code, 'join', body), env)
    }
    // GET /api/session/:code/view
    if (action === 'view' && request.method === 'GET') {
      return withCors(await callDO(env, code, 'view', null), env)
    }
    // PATCH /api/session/:code
    if (!action && request.method === 'PATCH') {
      const body = await request.json().catch(() => ({}))
      return withCors(await callDO(env, code, 'update', body), env)
    }

    return json({ error: 'not found' }, 404, env)
  }
}
