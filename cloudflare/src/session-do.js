// One Durable Object per session code. Holds the session's state + config in
// storage, verifies the PIN server-side (PBKDF2 via Web Crypto -- bcrypt isn't
// available in Workers), and fans state / presence / peer broadcasts out to every
// connected WebSocket. A 24h alarm self-deletes the session. This replaces the
// Supabase `sessions` table, its SECURITY DEFINER RPCs, and its realtime channel.

const TTL_MS = 24 * 60 * 60 * 1000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MAX_FAILS = 5 // wrong-PIN attempts before a short lockout
const LOCK_MS = 30 * 1000

const enc = new TextEncoder()
const b64 = (bytes) => btoa(String.fromCharCode(...bytes))
const ub64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function pbkdf2(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256)
  return new Uint8Array(bits)
}
async function hashPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iterations = 100000
  const hash = await pbkdf2(pin, salt, iterations)
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(hash)}`
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
async function verifyPin(pin, stored) {
  const parts = String(stored || '').split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  const salt = ub64(parts[2])
  const expected = ub64(parts[3])
  const actual = await pbkdf2(pin, salt, iterations)
  return timingSafeEqual(actual, expected)
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

export class SessionDO {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.code = null
    // Live sockets and their presence metadata (in memory; a session keeps at
    // least one socket open while in use, so the DO stays resident).
    this.sockets = new Set()
    this.presence = new Map() // socket -> { key, meta }
  }

  // ---- storage helpers -------------------------------------------------------
  async meta() {
    return (await this.state.storage.get('meta')) || null
  }
  async currentState() {
    return (await this.state.storage.get('state')) || { current: null, queue: [], blank: false }
  }
  async publicRow() {
    const m = await this.meta()
    if (!m) return null
    return {
      code: m.code,
      config: m.config || {},
      state: await this.currentState(),
      admins: m.admins || [],
      created_at: m.createdAt,
      expires_at: m.expiresAt
    }
  }
  async expired() {
    const m = await this.meta()
    return !m || Date.parse(m.expiresAt) <= Date.now()
  }

  // ---- routing ---------------------------------------------------------------
  async fetch(request) {
    const url = new URL(request.url)
    const action = url.pathname.split('/').filter(Boolean).pop()
    this.code = url.searchParams.get('code') || this.code

    if (action === 'ws') return this.handleWs(request)

    try {
      if (action === 'create') return await this.create(request)
      if (action === 'join') return await this.join(request)
      if (action === 'view') return await this.view()
      if (action === 'update') return await this.update(request)
    } catch (e) {
      return json({ error: e.message || 'error' }, 400)
    }
    return json({ error: 'not found' }, 404)
  }

  async create(request) {
    if (await this.meta()) return json({ error: 'exists' }, 409)
    const { pin, config, code } = await request.json()
    if (!/^[0-9]{4}$/.test(pin || '')) return json({ error: 'pin must be exactly 4 digits' }, 400)
    const now = Date.now()
    const m = {
      code,
      pinHash: await hashPin(pin),
      config: config || {},
      admins: [],
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + TTL_MS).toISOString(),
      fails: 0,
      lockUntil: 0
    }
    await this.state.storage.put('meta', m)
    await this.state.storage.put('state', { current: null, queue: [], blank: false })
    await this.state.storage.setAlarm(now + TTL_MS)
    return json(await this.publicRow())
  }

  async join(request) {
    const m = await this.meta()
    if (!m) return json({ error: 'session not found' }, 404)
    if (await this.expired()) {
      await this.destroy()
      return json({ error: 'session expired' }, 410)
    }
    if (m.lockUntil && Date.now() < m.lockUntil) {
      return json({ error: 'too many attempts, try again shortly' }, 429)
    }
    const { pin } = await request.json()
    if (!(await verifyPin(pin || '', m.pinHash))) {
      m.fails = (m.fails || 0) + 1
      if (m.fails >= MAX_FAILS) {
        m.lockUntil = Date.now() + LOCK_MS
        m.fails = 0
      }
      await this.state.storage.put('meta', m)
      return json({ error: 'incorrect pin' }, 401)
    }
    if (m.fails || m.lockUntil) {
      m.fails = 0
      m.lockUntil = 0
      await this.state.storage.put('meta', m)
    }
    return json(await this.publicRow())
  }

  async view() {
    const m = await this.meta()
    if (!m) return json({ error: 'session not found' }, 404)
    if (await this.expired()) {
      await this.destroy()
      return json({ error: 'session expired' }, 410)
    }
    return json(await this.publicRow())
  }

  async update(request) {
    const m = await this.meta()
    if (!m) return json({ error: 'session not found' }, 404)
    if (await this.expired()) {
      await this.destroy()
      return json({ error: 'session expired' }, 410)
    }
    const { pin, patch } = await request.json()
    if (!(await verifyPin(pin || '', m.pinHash))) return json({ error: 'incorrect pin' }, 401)

    // Sliding expiry: an active session must not die mid-service. When less than
    // half the TTL remains, push the expiry (and the cleanup alarm) out. Cheap
    // only because Durable Objects never pause on inactivity.
    const now = Date.now()
    if (Date.parse(m.expiresAt) - now < TTL_MS / 2) {
      m.expiresAt = new Date(now + TTL_MS).toISOString()
      await this.state.storage.put('meta', m)
      await this.state.storage.setAlarm(now + TTL_MS)
    }

    // Shallow-merge state (matching the old `state || patch.state`); replace
    // config / admins outright.
    if (patch && 'state' in patch) {
      const next = { ...(await this.currentState()), ...patch.state }
      await this.state.storage.put('state', next)
    }
    if (patch && 'config' in patch) {
      m.config = patch.config
      await this.state.storage.put('meta', m)
    }
    if (patch && 'admins' in patch) {
      m.admins = patch.admins
      await this.state.storage.put('meta', m)
    }
    const row = await this.publicRow()
    this.broadcast({ t: 'state', row }) // push to every connected client
    return json(row)
  }

  // ---- websockets ------------------------------------------------------------
  async handleWs(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return json({ error: 'expected websocket' }, 426)
    }
    if (await this.expired()) return json({ error: 'session expired' }, 410)

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()
    this.sockets.add(server)
    this.presence.set(server, { key: null, meta: null })

    server.addEventListener('message', (ev) => this.onMessage(server, ev))
    const close = () => this.onClose(server)
    server.addEventListener('close', close)
    server.addEventListener('error', close)

    // Send the current state immediately so a fresh client is in sync even if it
    // connected between HTTP join and the first update.
    this.publicRow().then((row) => {
      if (row) this.sendTo(server, { t: 'state', row })
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  onMessage(socket, ev) {
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    if (msg.t === 'hello') {
      const entry = this.presence.get(socket)
      if (entry) entry.key = msg.key || crypto.randomUUID()
      this.pushPresence()
    } else if (msg.t === 'track') {
      const entry = this.presence.get(socket)
      if (entry) {
        entry.key = entry.key || msg.key || crypto.randomUUID()
        entry.meta = msg.meta || {}
      }
      this.pushPresence()
    } else if (msg.t === 'broadcast') {
      // Relay a peer broadcast (invite-req / invite-res / detect) to everyone
      // else. These payloads are self-secured (ECDH or HMAC-signed).
      this.broadcast({ t: 'broadcast', event: msg.event, payload: msg.payload }, socket)
    }
  }

  onClose(socket) {
    this.sockets.delete(socket)
    this.presence.delete(socket)
    try {
      socket.close()
    } catch {
      /* already closed */
    }
    this.pushPresence()
  }

  presenceState() {
    // Supabase-compatible shape: { presenceKey: [meta, ...] }.
    const out = {}
    for (const { key, meta } of this.presence.values()) {
      if (key && meta) (out[key] = out[key] || []).push(meta)
    }
    return out
  }
  pushPresence() {
    this.broadcast({ t: 'presence', state: this.presenceState() })
  }

  sendTo(socket, obj) {
    try {
      socket.send(JSON.stringify(obj))
    } catch {
      /* socket gone */
    }
  }
  broadcast(obj, except) {
    const data = JSON.stringify(obj)
    for (const s of this.sockets) {
      if (s === except) continue
      try {
        s.send(data)
      } catch {
        /* skip broken socket */
      }
    }
  }

  // ---- expiry ----------------------------------------------------------------
  async alarm() {
    await this.destroy()
  }
  async destroy() {
    for (const s of this.sockets) {
      try {
        s.close(1000, 'session expired')
      } catch {
        /* ignore */
      }
    }
    this.sockets.clear()
    this.presence.clear()
    await this.state.storage.deleteAll()
    await this.state.storage.deleteAlarm()
  }
}

// A tiny fixed-window rate limiter, one instance per key (e.g. per client IP).
// Used to cap how fast one IP can create sessions. Self-cleans via an alarm so
// idle limiter objects don't linger.
export class RateLimiterDO {
  constructor(state) {
    this.state = state
  }
  async fetch(request) {
    const { limit = 20, windowMs = 60000 } = await request.json().catch(() => ({}))
    const now = Date.now()
    let w = await this.state.storage.get('w')
    if (!w || now >= w.resetAt) w = { resetAt: now + windowMs, count: 0 }
    w.count += 1
    await this.state.storage.put('w', w)
    await this.state.storage.setAlarm(w.resetAt + windowMs) // tidy up after the window
    const allowed = w.count <= limit
    return new Response(JSON.stringify({ allowed, resetAt: w.resetAt }), {
      status: allowed ? 200 : 429,
      headers: { 'content-type': 'application/json' }
    })
  }
  async alarm() {
    await this.state.storage.deleteAll()
  }
}

export { CODE_ALPHABET, hashPin, verifyPin }
