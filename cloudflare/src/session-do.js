// One Durable Object per session code. Holds the session's state + config in
// storage, verifies the PIN server-side (PBKDF2 via Web Crypto -- bcrypt isn't
// available in Workers), and fans state / presence / peer broadcasts out to every
// connected WebSocket. A 24h alarm self-deletes the session. This replaces the
// Supabase `sessions` table, its SECURITY DEFINER RPCs, and its realtime channel.

const TTL_MS = 24 * 60 * 60 * 1000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const MAX_FAILS = 5 // wrong-PIN attempts before a lockout
const LOCK_MS = 30 * 1000 // first lockout; doubles each time (capped) so a 4-digit PIN can't be walked
const MAX_LOCK_DOUBLINGS = 6 // 30s -> 32min
const MAX_GOOD_IPS = 50 // IPs that have presented the right PIN (bypass a lockout)
// WebSocket abuse limits: anyone with the code can connect, so cap what one
// session and one socket can do. Over the limit -> the socket is closed.
const MAX_SOCKETS = 40
const MSG_MAX_CHARS = 16 * 1024
const MSG_RATE = { max: 30, perMs: 10_000 }
const NAME_MAX = 40
const KEY_MAX = 64

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

  // Verify a PIN against the session, counting failures toward the lockout for
  // EVERY PIN-bearing action (join, update, broadcast) -- not just join -- so the
  // PIN can't be brute-forced through another endpoint instead. Lockouts escalate
  // (30s, 60s, ... 32min) and never reset, so 10,000 guesses can't fit in a TTL.
  //
  // A lockout must not hand a viewer who knows the code a way to freeze the real
  // operators: IPs that have already presented the correct PIN keep working
  // through a lockout. An attacker can't join that list without the PIN.
  // Returns null when the PIN is good, else the error Response to send.
  async checkPin(m, pin, ip) {
    const trusted = !!(ip && m.goodIps && m.goodIps[ip])
    if (m.lockUntil && Date.now() < m.lockUntil && !trusted) {
      return json({ error: 'too many attempts, try again shortly' }, 429)
    }
    if (!(await verifyPin(pin || '', m.pinHash))) {
      m.fails = (m.fails || 0) + 1
      if (m.fails >= MAX_FAILS) {
        const lockouts = m.lockouts || 0
        m.lockUntil = Date.now() + LOCK_MS * 2 ** Math.min(lockouts, MAX_LOCK_DOUBLINGS)
        m.lockouts = lockouts + 1
        m.fails = 0
      }
      await this.state.storage.put('meta', m)
      return json({ error: 'incorrect pin' }, 401)
    }
    let dirty = false
    if (m.fails || m.lockUntil) {
      m.fails = 0
      m.lockUntil = 0
      dirty = true
    }
    if (ip && !trusted) {
      const good = { ...(m.goodIps || {}), [ip]: Date.now() }
      const keys = Object.keys(good)
      if (keys.length > MAX_GOOD_IPS) {
        keys.sort((a, b) => good[a] - good[b])
        for (const k of keys.slice(0, keys.length - MAX_GOOD_IPS)) delete good[k]
      }
      m.goodIps = good
      dirty = true
    }
    if (dirty) await this.state.storage.put('meta', m)
    return null
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
      if (action === 'broadcast') return await this.broadcastAuthed(request)
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
    const { pin, ip } = await request.json()
    const bad = await this.checkPin(m, pin, ip)
    if (bad) return bad
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
    const { pin, patch, ip } = await request.json()
    const bad = await this.checkPin(m, pin, ip)
    if (bad) return bad

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
    // config / admins outright. The server owns `rev`: it always moves forward,
    // so when two controllers write at once every client converges on the same
    // order instead of two writes both claiming the same client-guessed rev.
    // (It never drops below a client's guess, so a client that ran ahead after
    // a failed request still accepts the echo.)
    if (patch && patch.state && typeof patch.state === 'object') {
      const stored = await this.currentState()
      const next = { ...stored, ...patch.state }
      next.rev = Math.max((stored.rev || 0) + 1, Number(patch.state.rev) || 0)
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

  // Authenticated peer broadcast. A PIN holder posts { pin, event, payload, from }
  // over HTTP; the DO verifies the PIN and relays the event marked `authed: true`
  // -- a flag the WebSocket relay path (open to view-only clients) never sets, so
  // receivers can trust it. This replaces client-side HMAC signatures keyed by the
  // PIN: any viewer on the channel could brute-force a 4-digit PIN from such a
  // signature offline in milliseconds. `from` is the sender's presence key, so
  // its own socket is skipped (like a `self: false` channel).
  async broadcastAuthed(request) {
    const m = await this.meta()
    if (!m) return json({ error: 'session not found' }, 404)
    if (await this.expired()) {
      await this.destroy()
      return json({ error: 'session expired' }, 410)
    }
    const { pin, event, payload, from, ip } = await request.json()
    const bad = await this.checkPin(m, pin, ip)
    if (bad) return bad
    if (typeof event !== 'string' || !event) return json({ error: 'event required' }, 400)
    let except = null
    if (from) {
      for (const [socket, entry] of this.presence) {
        if (entry.key === from) {
          except = socket
          break
        }
      }
    }
    this.broadcast({ t: 'broadcast', event, payload, authed: true }, except)
    return json({ ok: true })
  }

  // ---- websockets ------------------------------------------------------------
  async handleWs(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return json({ error: 'expected websocket' }, 426)
    }
    if (await this.expired()) return json({ error: 'session expired' }, 410)
    if (this.sockets.size >= MAX_SOCKETS) return json({ error: 'session is full' }, 429)

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    server.accept()
    this.sockets.add(server)
    this.presence.set(server, { key: null, meta: null, bucket: { count: 0, resetAt: 0 } })

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

  // Per-socket message budget (fixed window). True when this message is allowed.
  allow(socket) {
    const entry = this.presence.get(socket)
    if (!entry) return false
    const now = Date.now()
    const b = entry.bucket || (entry.bucket = { count: 0, resetAt: 0 })
    if (now >= b.resetAt) {
      b.resetAt = now + MSG_RATE.perMs
      b.count = 0
    }
    b.count += 1
    return b.count <= MSG_RATE.max
  }
  drop(socket, code, reason) {
    try {
      socket.close(code, reason)
    } catch {
      /* already closed */
    }
    this.onClose(socket)
  }

  onMessage(socket, ev) {
    if (typeof ev.data !== 'string' || ev.data.length > MSG_MAX_CHARS) return this.drop(socket, 1009, 'message too large')
    if (!this.allow(socket)) return this.drop(socket, 1008, 'too many messages')
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    const key = (v) => (typeof v === 'string' && v ? v.slice(0, KEY_MAX) : null)
    if (msg.t === 'hello') {
      const entry = this.presence.get(socket)
      if (entry) entry.key = key(msg.key) || crypto.randomUUID()
      this.pushPresence()
    } else if (msg.t === 'track') {
      const entry = this.presence.get(socket)
      if (entry) {
        entry.key = entry.key || key(msg.key) || crypto.randomUUID()
        // Presence is shown to other operators, so only known fields, bounded.
        const meta = msg.meta && typeof msg.meta === 'object' ? msg.meta : {}
        entry.meta = {
          name: String(meta.name || '').slice(0, NAME_MAX),
          listening: !!meta.listening,
          id: key(meta.id),
          at: Number(meta.at) || 0
        }
      }
      this.pushPresence()
    } else if (msg.t === 'broadcast') {
      // Relay a peer broadcast (invite-req / invite-res) to everyone else. Anyone
      // with the code can send these, so they are explicitly NOT authed; the
      // invite exchange secures itself (ECDH). PIN-holder events go through
      // broadcastAuthed instead.
      this.broadcast({ t: 'broadcast', event: msg.event, payload: msg.payload, authed: false }, socket)
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
