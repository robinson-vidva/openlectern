import { cfCreate, cfJoin, cfView, cfUpdate, cfChannel } from './cfLive.js'

// Session API + realtime, backed by the Cloudflare Worker + Durable Objects
// (see cloudflare/). Each session is one Durable Object addressed by its code.

// A session realtime channel: a WebSocket to the session's Durable Object,
// exposing .on / .send / .track / .subscribe / .unsubscribe / .presenceState.
export function sessionChannel(code) {
  return cfChannel(code)
}

export function createSession(pin, config) {
  return cfCreate(pin, config)
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

// Subscribe to state changes for one session code. onRow receives the new row.
// Returns the channel so callers can unsubscribe.
export function subscribeSession(code, onRow) {
  const channel = sessionChannel(code)
  channel.on('postgres_changes', {}, (payload) => {
    if (payload.new && payload.new.code) onRow(payload.new)
  })
  return channel
}
