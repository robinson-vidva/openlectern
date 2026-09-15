import { createClient } from '@supabase/supabase-js'
import { useCloudflare } from './backendConfig.js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && anonKey)

// True when *some* backend is configured -- Cloudflare (VITE_API_BASE) or
// Supabase. The UI uses this to show a friendly "not configured" message.
export const backendConfigured = useCloudflare || supabaseConfigured

// A single shared Supabase client (only when Cloudflare isn't in use). If neither
// backend is configured the app still loads and shows a clear message.
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
