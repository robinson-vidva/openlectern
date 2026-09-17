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
