// Backend selection. When VITE_API_BASE is set, the app talks to the Cloudflare
// Worker + Durable Object backend; otherwise it falls back to Supabase. This lets
// you deploy the Worker, flip the env var, and roll back without a code change.
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
export const useCloudflare = Boolean(API_BASE)
// ws:// or wss:// twin of the API origin, for the realtime socket.
export const WS_BASE = API_BASE.replace(/^http/, 'ws')
