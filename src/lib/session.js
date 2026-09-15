import { supabase } from './supabase.js'
import { useCloudflare } from './backendConfig.js'
import { cfCreate, cfJoin, cfView, cfUpdate, cfChannel } from './cfLive.js'

// Session API + realtime, backed by either Cloudflare (Worker + Durable Object)
// or Supabase (SECURITY DEFINER RPCs + realtime channel), chosen by env. The
// exported surface is identical for both so nothing else in the app changes.

// A session realtime channel. Cloudflare uses a WebSocket to the session's
// Durable Object; Supabase uses a Realtime channel. Both expose the same
// .on / .send / .track / .subscribe / .unsubscribe / .presenceState API.
export function sessionChannel(code, opts) {
  return useCloudflare ? cfChannel(code) : supabase.channel(`session:${code}`, opts)
}

export async function createSession(pin, config) {
  if (useCloudflare) return cfCreate(pin, config)
  const { data, error } = await supabase.rpc('create_session', { pin, config })
  if (error) throw error
  return data
}

export async function joinSession(code, pin) {
  if (useCloudflare) return cfJoin(code, pin)
  const { data, error } = await supabase.rpc('join_session', { code, pin })
  if (error) throw error
  return data
}

// View-only (presenter) join: code only, no PIN, read-only.
export async function joinView(code) {
  const c = code.trim().toUpperCase()
  if (useCloudflare) return cfView(c)
  const { data, error } = await supabase.rpc('join_session_view', { code: c })
  if (!error && data) return data
  const missing = error && (error.code === 'PGRST202' || /function|does not exist|not find/i.test(error.message || ''))
  if (error && !missing) throw error
  const { data: row, error: e2 } = await supabase
    .from('sessions')
    .select('code,config,state,admins,created_at,expires_at')
    .eq('code', c)
    .maybeSingle()
  if (e2) throw e2
  if (!row) throw new Error('session not found')
  return row
}

export async function updateSession(code, pin, patch) {
  if (useCloudflare) return cfUpdate(code, pin, patch)
  const { data, error } = await supabase.rpc('update_session', { code, pin, patch })
  if (error) throw error
  return data
}

// Subscribe to state changes for one session code. onRow receives the new row.
// Returns the channel so callers can unsubscribe.
export function subscribeSession(code, onRow) {
  const channel = sessionChannel(code, { config: { presence: { key: crypto.randomUUID() } } })
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'sessions', filter: `code=eq.${code}` },
    (payload) => {
      if (payload.new && payload.new.code) onRow(payload.new)
    }
  )
  return channel
}
