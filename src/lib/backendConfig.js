// Backend selection.
// - VITE_API_BASE = "same-origin" (or "/"): Cloudflare backend served from this
//   same host (the Worker serves the app + /api together). Works on any hostname
//   with no rebuild.
// - VITE_API_BASE = "https://...": Cloudflare backend at that absolute origin.
// - unset: fall back to Supabase.
const raw = (import.meta.env.VITE_API_BASE || '').trim()
export const sameOrigin = raw === 'same-origin' || raw === '/'
export const API_BASE = sameOrigin ? '' : raw.replace(/\/$/, '')
export const useCloudflare = sameOrigin || Boolean(API_BASE)
// ws:// or wss:// twin of the API origin. In same-origin mode it's derived from
// the current page at runtime.
export const WS_BASE = sameOrigin
  ? (typeof location !== 'undefined' ? location.origin.replace(/^http/, 'ws') : '')
  : API_BASE.replace(/^http/, 'ws')

// True when a backend is configured. The app is served by its own Cloudflare
// Worker (same-origin), so this is effectively always true in production; the
// check keeps a clear message if someone runs the frontend with no VITE_API_BASE.
export const backendConfigured = useCloudflare

// Map a backend error to a friendly message for the UI.
export function friendlyError(error) {
  if (!error) return 'Something went wrong.'
  const msg = (error.message || '').toLowerCase()
  if (msg.includes('not found')) return 'No session with that code.'
  if (msg.includes('expired')) return 'That session has expired.'
  if (msg.includes('pin')) return 'Incorrect PIN.'
  if (msg.includes('too many')) return 'Too many attempts. Please wait a moment.'
  if (msg.includes('verification')) return 'Human verification did not pass. Please try again.'
  return error.message || 'Something went wrong.'
}
