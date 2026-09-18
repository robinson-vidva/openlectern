import { describe, it, expect } from 'vitest'
import worker, { SessionDO } from '../cloudflare/src/index.js'

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
  return {
    sent: [],
    closed: null,
    send(d) {
      this.sent.push(JSON.parse(d))
    },
    close(code, reason) {
      if (!this.closed) this.closed = { code, reason } // the first close is the one that matters
    }
  }
}
function attach(dobj, key) {
  const s = fakeSocket()
  dobj.sockets.add(s)
  dobj.presence.set(s, { key, meta: null, bucket: { count: 0, resetAt: 0 } })
  return s
}
const post = (action, body) =>
  new Request(`https://do/${action}?code=ABCDEF`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function newSession(pin = '1234') {
  const dobj = new SessionDO(fakeState(), {})
  expect((await dobj.fetch(post('create', { pin, config: {}, code: 'ABCDEF' }))).status).toBe(200)
  return dobj
}
const say = (dobj, s, obj) => dobj.onMessage(s, { data: JSON.stringify(obj) })

describe('WebSocket abuse limits', () => {
  it('closes a socket that floods messages', async () => {
    const dobj = await newSession()
    const s = attach(dobj, 'a')
    for (let i = 0; i < 30; i++) say(dobj, s, { t: 'hello', key: 'a' })
    expect(s.closed).toBeNull()
    say(dobj, s, { t: 'hello', key: 'a' })
    expect(s.closed?.code).toBe(1008)
    expect(dobj.sockets.has(s)).toBe(false)
  })
  it('closes a socket that sends an oversized message', async () => {
    const dobj = await newSession()
    const s = attach(dobj, 'a')
    dobj.onMessage(s, { data: 'x'.repeat(16 * 1024 + 1) })
    expect(s.closed?.code).toBe(1009)
  })
  it('sanitizes presence: only known fields, bounded lengths', async () => {
    const dobj = await newSession()
    const s = attach(dobj, 'a')
    const other = attach(dobj, 'b')
    say(dobj, s, { t: 'track', key: 'a', meta: { name: 'N'.repeat(100), listening: 'yes', id: 'i'.repeat(100), at: 5, evil: '<script>' } })
    const presence = other.sent.at(-1)
    expect(presence.t).toBe('presence')
    const entry = presence.state.a[0]
    expect(entry.name).toHaveLength(40)
    expect(entry.listening).toBe(true)
    expect(entry.id).toHaveLength(64)
    expect(entry).not.toHaveProperty('evil')
  })
  it('refuses new sockets once the session is full', async () => {
    const dobj = await newSession()
    for (let i = 0; i < 40; i++) attach(dobj, `k${i}`)
    const res = await dobj.handleWs(new Request('https://do/ws', { headers: { Upgrade: 'websocket' } }))
    expect(res.status).toBe(429)
  })
})

describe('lockout bypass for IPs that know the PIN', () => {
  const join = (dobj, pin, ip) => dobj.fetch(post('join', { pin, ip }))
  const update = (dobj, pin, ip) => dobj.fetch(post('update', { pin, ip, patch: { state: { blank: true } } }))
  it('a locked session still serves operators whose IP already presented the right PIN', async () => {
    const dobj = await newSession()
    expect((await join(dobj, '1234', '10.0.0.1')).status).toBe(200) // operator, trusted now
    for (let i = 0; i < 5; i++) expect((await join(dobj, '0000', '10.0.0.9')).status).toBe(401) // attacker
    expect((await join(dobj, '1234', '10.0.0.9')).status).toBe(429) // attacker's IP is locked, even with the right PIN
    expect((await join(dobj, '1234', '10.0.0.2')).status).toBe(429) // a new, unknown IP waits too
    expect((await update(dobj, '1234', '10.0.0.1')).status).toBe(200) // the operator keeps working
    expect((await update(dobj, '0000', '10.0.0.1')).status).toBe(401) // but still needs the right PIN
  })
  it('never trusts an IP that only ever guessed wrong', async () => {
    const dobj = await newSession()
    for (let i = 0; i < 5; i++) await join(dobj, '0000', '10.0.0.9')
    expect((await dobj.meta()).goodIps).toBeUndefined()
  })
})

describe('server-owned rev', () => {
  const update = (dobj, patch) => dobj.fetch(post('update', { pin: '1234', patch: { state: patch } }))
  it('two writers claiming the same rev are ordered by the server', async () => {
    const dobj = await newSession()
    const a = await (await update(dobj, { blank: true, rev: 1 })).json()
    const b = await (await update(dobj, { blank: false, rev: 1 })).json()
    expect(a.state.rev).toBe(1)
    expect(b.state.rev).toBe(2)
    expect(b.state.blank).toBe(false)
  })
  it('never falls below a client that ran ahead', async () => {
    const dobj = await newSession()
    const r = await (await update(dobj, { blank: true, rev: 7 })).json()
    expect(r.state.rev).toBe(7)
    const r2 = await (await update(dobj, { blank: false, rev: 3 })).json()
    expect(r2.state.rev).toBe(8)
  })
})

describe('Worker body size caps and IP handling', () => {
  function env() {
    const objects = new Map()
    return {
      objects,
      SESSIONS: {
        idFromName: (n) => n,
        get: (id) => {
          if (!objects.has(id)) objects.set(id, new SessionDO(fakeState(), {}))
          return { fetch: (req) => objects.get(id).fetch(req) }
        }
      },
      RATELIMIT: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('{}', { status: 200 }) }) }
    }
  }
  it('rejects an oversized state patch with 413 before it reaches the DO', async () => {
    const e = env()
    const created = await (await worker.fetch(new Request('https://x/api/session', { method: 'POST', body: JSON.stringify({ pin: '1234', config: {} }) }), e)).json()
    const big = { pin: '1234', patch: { state: { history: 'h'.repeat(300 * 1024) } } }
    const res = await worker.fetch(new Request(`https://x/api/session/${created.code}`, { method: 'PATCH', body: JSON.stringify(big) }), e)
    expect(res.status).toBe(413)
  })
  it('ignores a client-supplied ip (the Worker sets it from the connection)', async () => {
    const e = env()
    const created = await (await worker.fetch(new Request('https://x/api/session', { method: 'POST', body: JSON.stringify({ pin: '1234', config: {} }) }), e)).json()
    const res = await worker.fetch(
      new Request(`https://x/api/session/${created.code}/join`, { method: 'POST', headers: { 'CF-Connecting-IP': '9.9.9.9' }, body: JSON.stringify({ pin: '1234', ip: '1.1.1.1' }) }),
      e
    )
    expect(res.status).toBe(200)
    const meta = await e.objects.get(created.code).meta()
    expect(Object.keys(meta.goodIps)).toEqual(['9.9.9.9'])
  })
})
