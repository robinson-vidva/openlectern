import { supabase } from './supabase.js'

// Thin wrappers over the three SECURITY DEFINER RPCs.

export async function createSession(pin, config) {
  const { data, error } = await supabase.rpc('create_session', { pin, config })
  if (error) throw error
  return data
}

export async function joinSession(code, pin) {
  const { data, error } = await supabase.rpc('join_session', { code, pin })
  if (error) throw error
  return data
}

// View-only (presenter) join: code only, no PIN, read-only. Prefers the
// join_session_view RPC; if it is not installed yet, falls back to a direct
// RLS-guarded read (the anon column grant already excludes pin_hash, and the
// SELECT policy hides expired rows).
export async function joinView(code) {
  const c = code.trim().toUpperCase()
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
  const { data, error } = await supabase.rpc('update_session', { code, pin, patch })
  if (error) throw error
  return data
}

// Subscribe to row changes for one session code. onRow receives the new row.
// Returns the channel so callers can unsubscribe.
export function subscribeSession(code, onRow) {
  const channel = supabase.channel(`session:${code}`, {
    config: { presence: { key: crypto.randomUUID() } }
  })
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'sessions', filter: `code=eq.${code}` },
    (payload) => {
      if (payload.new && payload.new.code) onRow(payload.new)
    }
  )
  return channel
}
