import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && anonKey)

// A single shared client. If env vars are missing the app still loads and
// shows a clear message instead of crashing.
export const supabase = supabaseConfigured ? createClient(url, anonKey) : null

// Map raised Postgres errors to friendly messages for the UI.
export function friendlyError(error) {
  if (!error) return 'Something went wrong.'
  const msg = (error.message || '').toLowerCase()
  if (msg.includes('not found')) return 'No session with that code.'
  if (msg.includes('expired')) return 'That session has expired.'
  if (msg.includes('pin')) return 'Incorrect PIN.'
  return error.message || 'Something went wrong.'
}
