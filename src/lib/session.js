import { cfCreate, cfJoin, cfView, cfUpdate, cfBroadcast, cfChannel, cfAppConfig } from './cfLive.js'

// Session API + realtime, backed by the Cloudflare Worker + Durable Objects
// (see cloudflare/). Each session is one Durable Object addressed by its code.

// A session realtime channel: a WebSocket to the session's Durable Object,
// exposing .on / .send / .track / .subscribe / .unsubscribe / .presenceState.
export function sessionChannel(code) {
  return cfChannel(code)
}

// `turnstile`: the Cloudflare Turnstile token, required when the backend has
// bot protection enabled (see loadAppConfig).
export function createSession(pin, config, turnstile) {
  return cfCreate(pin, config, turnstile)
}

// Public runtime config from the backend: { turnstileSiteKey: string | null }.
// Cached for the page's life; a failure resolves to {} so the app still runs.
let appConfigPromise = null
export function loadAppConfig() {
  if (!appConfigPromise) appConfigPromise = cfAppConfig().catch(() => ({}))
  return appConfigPromise
}

export function joinSession(code, pin) {
  return cfJoin(code, pin)
}

// View-only (presenter) join: code only, no PIN, read-only.
export function joinView(code) {
  return cfView(code.trim().toUpperCase())
}

export function updateSession(code, pin, patch) {
  return cfUpdate(code, pin, patch)
}

// Send a PIN-verified peer event (e.g. a shared voice detection) to the other
// clients. Receivers see it with `authed: true`; anything relayed over the raw
// WebSocket by a viewer arrives with `authed: false`.
export function broadcastSession(code, pin, event, payload, from) {
  return cfBroadcast(code, pin, event, payload, from)
}

// Subscribe to state changes for one session code. onRow receives the new row.
// Returns the channel so callers can unsubscribe.
export function subscribeSession(code, onRow) {
  const channel = sessionChannel(code)
  channel.on('postgres_changes', {}, (payload) => {
    if (payload.new && payload.new.code) onRow(payload.new)
  })
  return channel
}
