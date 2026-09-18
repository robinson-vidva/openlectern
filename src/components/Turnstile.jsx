import { useEffect, useRef } from 'react'
import { loadTurnstile } from '../lib/turnstile.js'

// Cloudflare Turnstile widget (explicit render). Reports its token through
// onToken, and null when the token expires or the widget errors. Bumping
// `resetKey` resets the widget: tokens are single-use, so a failed or retried
// request needs a fresh one. `appearance: interaction-only` keeps the widget
// invisible unless Cloudflare actually needs the person to interact.
export default function Turnstile({ siteKey, onToken, onError, resetKey = 0 }) {
  const elRef = useRef(null)
  const idRef = useRef(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    let cancelled = false
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !elRef.current) return
        idRef.current = ts.render(elRef.current, {
          sitekey: siteKey,
          action: 'create-session', // the Worker only accepts tokens minted for this action
          size: 'flexible',
          appearance: 'interaction-only',
          callback: (token) => onTokenRef.current?.(token),
          'expired-callback': () => onTokenRef.current?.(null),
          'timeout-callback': () => onTokenRef.current?.(null),
          'error-callback': () => {
            onTokenRef.current?.(null)
            onErrorRef.current?.()
            return true // handled; don't also log to the console
          }
        })
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current?.()
      })
    return () => {
      cancelled = true
      try {
        if (idRef.current != null) window.turnstile?.remove(idRef.current)
      } catch {
        /* already gone */
      }
      idRef.current = null
    }
  }, [siteKey])

  useEffect(() => {
    if (!resetKey || idRef.current == null) return
    try {
      window.turnstile?.reset(idRef.current)
      onTokenRef.current?.(null)
    } catch {
      /* ignore */
    }
  }, [resetKey])

  return <div className="turnstile-slot" ref={elRef} />
}
