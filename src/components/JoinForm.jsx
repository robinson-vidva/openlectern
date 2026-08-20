import { useState } from 'react'
import { joinSession } from '../lib/session.js'
import { friendlyError, supabaseConfigured } from '../lib/supabase.js'

// Collects code + PIN (and an optional display name for controllers), calls
// join_session, and hands the row plus credentials back to the parent page.
export default function JoinForm({ role, initialCode = '', onJoined }) {
  const [code, setCode] = useState(initialCode.toUpperCase())
  const [pin, setPin] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isControl = role === 'control'

  async function submit(e) {
    e.preventDefault()
    setError('')
    const c = code.trim().toUpperCase()
    if (c.length < 4) return setError('Enter the session code.')
    if (!/^\d{4}$/.test(pin)) return setError('PIN is 4 digits.')
    setBusy(true)
    try {
      const row = await joinSession(c, pin)
      onJoined(row, { code: c, pin, name: name.trim() })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!supabaseConfigured) {
    return (
      <div className="card">
        <h1>OpenLectern</h1>
        <p className="error">
          Not configured yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.
        </p>
      </div>
    )
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>OpenLectern</h1>
      <p className="tagline">{isControl ? 'Join to control the screen' : 'Open the presenter screen'}</p>

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

      {error && <p className="error">{error}</p>}

      <button className="btn primary wide" type="submit" disabled={busy}>
        {busy ? 'Joining...' : 'Join'}
      </button>

      <p style={{ marginTop: '1rem', textAlign: 'center' }}>
        <a className="link-btn" href="#/">Back to start</a>
      </p>
    </form>
  )
}
