// Loads the Cloudflare Turnstile script once (explicit rendering) and resolves
// with the `turnstile` API. Only called when the backend reports a site key, so
// installs without bot protection never load third-party script.
const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading = null

export function loadTurnstile() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'))
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SRC
    s.async = true
    s.defer = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')))
    s.onerror = () => {
      loading = null // allow a retry after a transient failure
      reject(new Error('turnstile failed to load'))
    }
    document.head.appendChild(s)
  })
  return loading
}
