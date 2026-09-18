import { describe, it, expect, vi, afterEach } from 'vitest'
import worker, { SessionDO } from '../cloudflare/src/index.js'

// Exercise the Durable Object + Worker routing in Node with in-memory stand-ins
// for DO storage, the DO namespace bindings, and the client WebSockets.

function fakeState() {
  const map = new Map()
  return {
    storage: {
      get: async (k) => map.get(k),
      put: async (k, v) => void map.set(k, v),
      deleteAll: async () => map.clear(),
      setAlarm: async () => {},
      deleteAlarm: async () => {}
    }
  }
}
function fakeSocket() {
  return { sent: [], send(d) { this.sent.push(JSON.parse(d)) }, close() {} }
}
function attach(dobj, key) {
  const s = fakeSocket()
  dobj.sockets.add(s)
  dobj.presence.set(s, { key, meta: null })
  return s
}
function post(action, body, code = 'ABCDEF') {
  return new Request(`https://do/${action}?code=${code}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
}
async function newSession(pin = '1234') {
  const dobj = new SessionDO(fakeState(), {})
  const res = await dobj.fetch(post('create', { pin, config: {}, code: 'ABCDEF' }))
  expect(res.status).toBe(200)
  return dobj
}

describe('SessionDO PIN lockout', () => {
  it('locks out after repeated wrong PINs on update, not only on join', async () => {
    const dobj = await newSession()
    for (let i = 0; i < 5; i++) {
      const res = await dobj.fetch(post('update', { pin: '0000', patch: { state: { blank: true } } }))
      expect(res.status).toBe(401)
    }
    // Now locked: even the RIGHT pin is refused for the lockout window.
    const locked = await dobj.fetch(post('update', { pin: '1234', patch: { state: { blank: true } } }))
    expect(locked.status).toBe(429)
    const lockedJoin = await dobj.fetch(post('join', { pin: '1234' }))
    expect(lockedJoin.status).toBe(429)
  })
  it('escalates the lockout each time', async () => {
    const dobj = await newSession()
    vi.useFakeTimers()
    try {
      const guess = async () => (await dobj.fetch(post('join', { pin: '0000' }))).status
      for (let i = 0; i < 5; i++) await guess()
      const m1 = await dobj.meta()
      const first = m1.lockUntil - Date.now()
      vi.setSystemTime(Date.now() + first + 1)
      for (let i = 0; i < 5; i++) await guess()
      const m2 = await dobj.meta()
      const second = m2.lockUntil - Date.now()
      expect(second).toBeGreaterThan(first)
      expect(m2.lockouts).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
  it('a correct PIN after a few misses clears the miss count', async () => {
    const dobj = await newSession()
    await dobj.fetch(post('join', { pin: '0000' }))
    await dobj.fetch(post('join', { pin: '0000' }))
    expect((await dobj.fetch(post('join', { pin: '1234' }))).status).toBe(200)
    expect((await dobj.meta()).fails).toBe(0)
  })
})

describe('SessionDO broadcasts', () => {
  it('a PIN-verified broadcast is relayed as authed to everyone but the sender', async () => {
    const dobj = await newSession()
    const me = attach(dobj, 'me')
    const other = attach(dobj, 'other')
    const res = await dobj.fetch(post('broadcast', { pin: '1234', event: 'detect', payload: { x: 1 }, from: 'me' }))
    expect(res.status).toBe(200)
    expect(me.sent).toHaveLength(0)
    expect(other.sent).toEqual([{ t: 'broadcast', event: 'detect', payload: { x: 1 }, authed: true }])
  })
  it('a broadcast with the wrong PIN is refused and relayed to nobody', async () => {
    const dobj = await newSession()
    const other = attach(dobj, 'other')
    const res = await dobj.fetch(post('broadcast', { pin: '9999', event: 'detect', payload: { x: 1 } }))
    expect(res.status).toBe(401)
    expect(other.sent).toHaveLength(0)
  })
  it('a WebSocket relay from any client is never marked authed', async () => {
    const dobj = await newSession()
    const viewer = attach(dobj, 'viewer')
    const other = attach(dobj, 'other')
    dobj.onMessage(viewer, { data: JSON.stringify({ t: 'broadcast', event: 'detect', payload: { authed: true } }) })
    expect(other.sent).toHaveLength(1)
    expect(other.sent[0].authed).toBe(false)
    expect(viewer.sent).toHaveLength(0)
  })
})

describe('Worker routing', () => {
  function fakeEnv() {
    const objects = new Map()
    const ns = {
      idFromName: (n) => n,
      get: (id) => {
        if (!objects.has(id)) objects.set(id, new SessionDO(fakeState(), {}))
        return { fetch: (req) => objects.get(id).fetch(req) }
      }
    }
    return {
      env: { SESSIONS: ns, RATELIMIT: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('{}', { status: 200 }) }) } },
      objects
    }
  }
  it('rejects malformed session codes without touching a Durable Object', async () => {
    const { env, objects } = fakeEnv()
    for (const bad of ['abc', 'ABCDEFG', 'ABC0EF', '../x', 'ABCDE1']) {
      const res = await worker.fetch(new Request(`https://x/api/session/${encodeURIComponent(bad)}/view`), env)
      expect(res.status, bad).toBe(404)
    }
    expect(objects.size).toBe(0)
  })
  it('creates a session and serves it back through view and broadcast', async () => {
    const { env } = fakeEnv()
    const created = await worker.fetch(
      new Request('https://x/api/session', { method: 'POST', body: JSON.stringify({ pin: '4321', config: {} }) }),
      env
    )
    expect(created.status).toBe(200)
    const row = await created.json()
    expect(row.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
    const view = await worker.fetch(new Request(`https://x/api/session/${row.code.toLowerCase()}/view`), env)
    expect(view.status).toBe(200)
    const bc = await worker.fetch(
      new Request(`https://x/api/session/${row.code}/broadcast`, {
        method: 'POST',
        body: JSON.stringify({ pin: '4321', event: 'detect', payload: {} })
      }),
      env
    )
    expect(bc.status).toBe(200)
    expect(bc.headers.get('content-security-policy')).toContain("default-src 'self'")
  })
})

describe('Turnstile gate on session creation', () => {
  function fakeEnv(extra = {}) {
    const objects = new Map()
    return {
      SESSIONS: {
        idFromName: (n) => n,
        get: (id) => {
          if (!objects.has(id)) objects.set(id, new SessionDO(fakeState(), {}))
          return { fetch: (req) => objects.get(id).fetch(req) }
        }
      },
      RATELIMIT: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('{}', { status: 200 }) }) },
      ...extra
    }
  }
  const create = (env, body) =>
    worker.fetch(new Request('https://x/api/session', { method: 'POST', body: JSON.stringify(body) }), env)
  const ON = { TURNSTILE_SECRET: 'sekrit', TURNSTILE_HOSTNAMES: 'openlectern.askdevotions.com, Example.org' }
  const stubVerify = (success, extra = { action: 'create-session', hostname: 'openlectern.askdevotions.com' }) => {
    const spy = vi.fn(async (url) => {
      expect(String(url)).toContain('challenges.cloudflare.com/turnstile/v0/siteverify')
      return new Response(JSON.stringify({ success, ...extra }), { status: 200 })
    })
    vi.stubGlobal('fetch', spy)
    return spy
  }
  afterEach(() => vi.unstubAllGlobals())

  it('publishes only the site key through /api/config', async () => {
    const env = fakeEnv({ TURNSTILE_SITE_KEY: 'site-123', TURNSTILE_SECRET: 'sekrit' })
    const res = await worker.fetch(new Request('https://x/api/config'), env)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ turnstileSiteKey: 'site-123' })
    expect(text).not.toContain('sekrit')
    const off = await worker.fetch(new Request('https://x/api/config'), fakeEnv())
    expect(await off.json()).toEqual({ turnstileSiteKey: null })
  })
  it('is skipped entirely when no secret is configured', async () => {
    const fetchSpy = stubVerify(true)
    const res = await create(fakeEnv(), { pin: '1234', config: {} })
    expect(res.status).toBe(200)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('requires a token when the secret is set', async () => {
    const env = fakeEnv(ON)
    const res = await create(env, { pin: '1234', config: {} })
    expect(res.status).toBe(403)
  })
  it('rejects a token Cloudflare does not accept', async () => {
    stubVerify(false)
    const res = await create(fakeEnv(ON), { pin: '1234', config: {}, turnstile: 'tok' })
    expect(res.status).toBe(403)
  })
  it('creates the session with a valid token and does not forward it to the DO', async () => {
    const fetchSpy = stubVerify(true)
    const res = await create(fakeEnv(ON), { pin: '1234', config: {}, turnstile: 'tok' })
    expect(res.status).toBe(200)
    const body = fetchSpy.mock.calls[0][1].body
    expect(body.get('secret')).toBe('sekrit')
    expect(body.get('response')).toBe('tok')
    expect((await res.json()).code).toHaveLength(6)
  })
  it('rejects a token minted for another action or another hostname', async () => {
    stubVerify(true, { action: 'login', hostname: 'openlectern.askdevotions.com' })
    let res = await create(fakeEnv(ON), { pin: '1234', config: {}, turnstile: 'tok' })
    expect(res.status).toBe(403)
    stubVerify(true, { action: 'create-session', hostname: 'evil.example.com' })
    res = await create(fakeEnv(ON), { pin: '1234', config: {}, turnstile: 'tok' })
    expect(res.status).toBe(403)
    stubVerify(true, { action: 'create-session', hostname: 'EXAMPLE.org' }) // allowlist is case-insensitive
    res = await create(fakeEnv(ON), { pin: '1234', config: {}, turnstile: 'tok' })
    expect(res.status).toBe(200)
  })
  it('refuses to run with a secret but no hostname allowlist', async () => {
    const spy = stubVerify(true)
    const res = await create(fakeEnv({ TURNSTILE_SECRET: 'sekrit' }), { pin: '1234', config: {}, turnstile: 'tok' })
    expect(res.status).toBe(503)
    expect(spy).not.toHaveBeenCalled()
  })
  it('rejects an oversized token without calling Cloudflare', async () => {
    const spy = stubVerify(true)
    const res = await create(fakeEnv(ON), { pin: '1234', config: {}, turnstile: 'x'.repeat(2049) })
    expect(res.status).toBe(403)
    expect(spy).not.toHaveBeenCalled()
  })
  it('fails closed when the verify service is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    const res = await create(fakeEnv(ON), { pin: '1234', config: {}, turnstile: 'tok' })
    expect(res.status).toBe(503)
  })
})
