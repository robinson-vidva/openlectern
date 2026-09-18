import { useEffect, useRef, useState } from 'react'
import { loadTurnstile } from '../lib/turnstile.js'

// Cloudflare Turnstile widget (explicit render) for one protected action.
// Reports its token through onToken, and null when the token expires or the
// widget errors. Bumping `resetKey` resets the widget: tokens are single-use, so
// a failed or retried request needs a fresh one. `appearance: interaction-only`
// keeps the widget invisible unless Cloudflare actually needs the person to
// interact. Shows its own one-line status while no token is held.
export default function Turnstile({ siteKey, action, onToken, resetKey = 0 }) {
  const elRef = useRef(null)
  const idRef = useRef(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken
  const [hasToken, setHasToken] = useState(false)
  const [failed, setFailed] = useState(false)

  const report = (token) => {
    setHasToken(!!token)
    if (token) setFailed(false)
    onTokenRef.current?.(token)
  }

  useEffect(() => {
    let cancelled = false
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !elRef.current) return
        idRef.current = ts.render(elRef.current, {
          sitekey: siteKey,
          action, // the Worker only accepts tokens minted for the matching action
          size: 'flexible',
          appearance: 'interaction-only',
          callback: (token) => report(token),
          'expired-callback': () => report(null),
          'timeout-callback': () => report(null),
          'error-callback': () => {
            report(null)
            setFailed(true)
            return true // handled; don't also log to the console
          }
        })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, action])

  useEffect(() => {
    if (!resetKey || idRef.current == null) return
    try {
      window.turnstile?.reset(idRef.current)
      report(null)
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  return (
    <>
      <div className="turnstile-slot" ref={elRef} />
      {!hasToken && (
        <p className="muted turnstile-note" role="status">
          {failed
            ? 'The human check could not load. Turn off content blockers for this site and reload.'
            : 'Checking that you are human…'}
        </p>
      )}
    </>
  )
}
