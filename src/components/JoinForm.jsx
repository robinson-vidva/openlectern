import { useEffect, useState } from 'react'
import { joinSession, joinView, loadAppConfig } from '../lib/session.js'
import { requestPinViaInvite } from '../lib/invite.js'
import { friendlyError, backendConfigured } from '../lib/backendConfig.js'
import Turnstile from './Turnstile.jsx'

// Controllers join with code + PIN (and an optional name) and can write.
// Presenters/viewers join with the code only (read-only, no PIN).
// Controllers can also join via a one-time invite code from another controller.
export default function JoinForm({ role, initialCode = '', initialInvite = false, onJoined }) {
  const [code, setCode] = useState(initialCode.toUpperCase())
  const [pin, setPin] = useState('')
  const [invite, setInvite] = useState('')
  const [name, setName] = useState('')
  const [mode, setMode] = useState(initialInvite && role === 'control' ? 'invite' : 'pin') // pin | invite
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isControl = role === 'control'
  const inviteMode = isControl && mode === 'invite'

  // Bot protection on the PIN join (Cloudflare Turnstile), when the backend has
  // it on. Viewing needs no token. Tokens are single-use: a failed join resets
  // the widget so the retry carries a fresh one.
  const [siteKey, setSiteKey] = useState(null)
  const [token, setToken] = useState(null)
  const [tsReset, setTsReset] = useState(0)
  useEffect(() => {
    if (!isControl) return
    let live = true
    loadAppConfig().then((c) => live && setSiteKey(c?.turnstileSiteKey || null))
    return () => {
      live = false
    }
  }, [isControl])
  const gated = isControl && !!siteKey
  const humanReady = !gated || !!token

  async function submit(e) {
    e.preventDefault()
    setError('')
    const c = code.trim().toUpperCase()
    if (c.length < 4) return setError('Enter the session code.')
    if (!humanReady) return setError('Still checking that you are human. Try again in a moment.')
    setBusy(true)
    try {
      if (!isControl) {
        onJoined(await joinView(c), { code: c })
      } else if (inviteMode) {
        if (!/^\d{6}$/.test(invite.trim())) throw new Error('Invite code is 6 digits.')
        const recovered = await requestPinViaInvite(c, invite.trim(), name.trim())
        const row = await joinSession(c, recovered, token)
        onJoined(row, { code: c, pin: recovered, name: name.trim() })
      } else {
        if (!/^\d{4}$/.test(pin)) throw new Error('PIN is 4 digits.')
        const row = await joinSession(c, pin, token)
        onJoined(row, { code: c, pin, name: name.trim() })
      }
    } catch (err) {
      setError(friendlyError(err))
      if (gated) setTsReset((k) => k + 1) // the token was spent; get a new one
    } finally {
      setBusy(false)
    }
  }

  if (!backendConfigured) {
    return (
      <div className="card">
        <h1>OpenLectern</h1>
        <p className="error">
          Not configured yet. Set VITE_API_BASE (Cloudflare) or the VITE_SUPABASE_* keys in .env.
        </p>
      </div>
    )
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>OpenLectern</h1>
      <p className="tagline">
        {!isControl ? 'Open the presenter screen' : inviteMode ? 'Join with an invite code' : 'Join to control the screen'}
      </p>

      <div className="field">
        <label htmlFor="code">Session code</label>
        <input
          id="code"
          type="text"
          autoCapitalize="characters"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="K7PM4Q"
        />
      </div>

      {isControl && !inviteMode && (
        <div className="field">
          <label htmlFor="pin">PIN</label>
          <input
            id="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="4 digits"
          />
        </div>
      )}

      {inviteMode && (
        <div className="field">
          <label htmlFor="invite">Invite code</label>
          <input
            id="invite"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={invite}
            onChange={(e) => setInvite(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6 digits from another controller"
          />
        </div>
      )}

      {isControl && (
        <div className="field">
          <label htmlFor="name">Your name (optional)</label>
          <input
            id="name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Priya"
          />
        </div>
      )}

      {!isControl && <p className="muted">View only. No PIN needed to watch.</p>}

      {error && <p className="error">{error}</p>}

      {gated && <Turnstile siteKey={siteKey} action="join-session" onToken={setToken} resetKey={tsReset} />}

      <button className="btn primary wide" type="submit" disabled={busy || !humanReady}>
        {busy ? (inviteMode ? 'Requesting...' : 'Joining...') : isControl ? 'Join' : 'Open'}
      </button>

      {isControl && (
        <p style={{ marginTop: '0.9rem', textAlign: 'center' }}>
          <button type="button" className="link-btn" onClick={() => setMode(inviteMode ? 'pin' : 'invite')}>
            {inviteMode ? 'Enter the PIN instead' : 'Join with an invite code'}
          </button>
        </p>
      )}

      {isControl && !inviteMode && (
        <p className="muted" style={{ marginTop: '0.6rem', textAlign: 'center', fontSize: '0.85rem' }}>
          Forgot the PIN and no controller is open? <a className="link-btn" href="#/">Start a new session.</a>
        </p>
      )}

      <p style={{ marginTop: '1rem', textAlign: 'center' }}>
        <a className="link-btn" href="#/">Back to start</a>
      </p>
    </form>
  )
}
