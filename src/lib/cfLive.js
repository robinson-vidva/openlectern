// Cloudflare backend client: HTTP calls to the Worker, plus a WebSocket "channel"
// that mirrors the slice of the Supabase Realtime channel API the app uses
// (.on / .send / .track / .subscribe / .unsubscribe / .presenceState). Keeping
// the same shape means Control/Present/invite need only swap the constructor.
import { API_BASE, WS_BASE } from './backendConfig.js'

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return unwrap(res)
}
async function patch(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return unwrap(res)
}
async function get(path) {
  return unwrap(await fetch(`${API_BASE}${path}`))
}
async function unwrap(res) {
  let data = null
  try {
    data = await res.json()
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new Error((data && data.error) || `request failed (${res.status})`)
  return data
}

// `turnstile` is the Turnstile token when the server has bot protection on.
export const cfCreate = (pin, config, turnstile) => post('/api/session', { pin, config, turnstile: turnstile || undefined })
export const cfAppConfig = () => get('/api/config')
export const cfJoin = (code, pin, turnstile) =>
  post(`/api/session/${encodeURIComponent(code)}/join`, { pin, turnstile: turnstile || undefined })
export const cfView = (code) => get(`/api/session/${encodeURIComponent(code.trim().toUpperCase())}/view`)
export const cfUpdate = (code, pin, patch_) => patch(`/api/session/${encodeURIComponent(code)}`, { pin, patch: patch_ })
// PIN-verified peer event: the server relays it to every other client marked
// `authed: true`, which the plain WebSocket relay never sets. `from` is this
// client's presence key so its own socket is skipped.
export const cfBroadcast = (code, pin, event, payload, from) =>
  post(`/api/session/${encodeURIComponent(code)}/broadcast`, { pin, event, payload, from })

// A Supabase-channel-shaped wrapper over one session WebSocket. Auto-reconnects
// with backoff and reports status transitions (SUBSCRIBED / CLOSED /
// CHANNEL_ERROR) exactly like the Supabase channel the app was written against.
export function cfChannel(code) {
  const handlers = { postgres: [], presence: [], broadcast: {} }
  const key = crypto.randomUUID()
  let ws = null
  let statusCb = null
  let presence = {}
  let lastMeta = null
  let closed = false
  let retry = 0

  const emit = (s) => statusCb && statusCb(s)
  const wsSend = (obj) => {
    try {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj))
    } catch {
      /* socket not ready */
    }
  }

  function connect() {
    ws = new WebSocket(`${WS_BASE}/api/session/${encodeURIComponent(code)}/ws`)
    ws.onopen = () => {
      retry = 0
      wsSend({ t: 'hello', key })
      if (lastMeta) wsSend({ t: 'track', key, meta: lastMeta })
      emit('SUBSCRIBED')
    }
    ws.onmessage = (ev) => {
      let m
      try {
        m = JSON.parse(ev.data)
      } catch {
        return
      }
      if (m.t === 'state') handlers.postgres.forEach((cb) => cb({ new: m.row }))
      else if (m.t === 'presence') {
        presence = m.state || {}
        handlers.presence.forEach((cb) => cb())
      } else if (m.t === 'broadcast') {
        // `authed` is set only by the server for PIN-verified (HTTP) broadcasts.
        const authed = m.authed === true
        ;(handlers.broadcast[m.event] || []).forEach((cb) => cb({ payload: m.payload, authed }))
      }
    }
    ws.onclose = () => {
      if (closed) return
      emit('CLOSED')
      scheduleReconnect()
    }
    ws.onerror = () => emit('CHANNEL_ERROR')
  }
  function scheduleReconnect() {
    if (closed) return
    retry += 1
    const delay = Math.min(1000 * 2 ** Math.min(retry, 4), 15000)
    setTimeout(() => {
      if (!closed) connect()
    }, delay)
  }

  return {
    // This client's presence key (pass as `from` to cfBroadcast to skip self).
    presenceKey: key,
    on(kind, filter, cb) {
      const fn = cb || filter
      if (kind === 'postgres_changes') handlers.postgres.push(fn)
      else if (kind === 'presence') handlers.presence.push(fn)
      else if (kind === 'broadcast') {
        const e = filter && filter.event
        ;(handlers.broadcast[e] = handlers.broadcast[e] || []).push(fn)
      }
      return this
    },
    subscribe(cb) {
      statusCb = cb || null
      connect()
      return this
    },
    send({ event, payload }) {
      wsSend({ t: 'broadcast', event, payload })
      return Promise.resolve('ok')
    },
    track(meta) {
      lastMeta = meta
      wsSend({ t: 'track', key, meta })
      return Promise.resolve('ok')
    },
    presenceState() {
      return presence
    },
    unsubscribe() {
      closed = true
      try {
        if (ws) ws.close()
      } catch {
        /* already closed */
      }
      return Promise.resolve('ok')
    }
  }
}
