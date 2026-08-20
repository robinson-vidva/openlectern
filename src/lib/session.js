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
