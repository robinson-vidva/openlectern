import { useEffect, useState } from 'react'
import { loadManifest } from '../lib/bibleData.js'
import { createSession } from '../lib/session.js'
import { friendlyError, supabaseConfigured } from '../lib/supabase.js'

export default function Start() {
  const [versions, setVersions] = useState([])
  const [primary, setPrimary] = useState('')
  const [secondary, setSecondary] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null) // { code }

  useEffect(() => {
    loadManifest()
      .then((m) => {
        const list = m.versions || []
        setVersions(list)
        if (list[0]) setPrimary(list[0].id)
      })
      .catch((e) => setError(e.message))
  }, [])

  async function start(e) {
    e.preventDefault()
    setError('')
    if (!primary) return setError('Pick at least one translation.')
    if (!/^\d{4}$/.test(pin)) return setError('Choose a 4-digit PIN.')
    const chosen = [primary, secondary].filter(Boolean)
    const config = {
      versions: chosen.map((id) => {
        const v = versions.find((x) => x.id === id)
        return { id: v.id, name: v.name, language: v.language, helloaoId: v.helloaoId || null }
      })
    }
    setBusy(true)
    try {
      const row = await createSession(pin, config)
      setCreated({ code: row.code })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!supabaseConfigured) {
    return (
      <div className="center-wrap">
        <div className="card">
          <h1>OpenLectern</h1>
          <p className="error">
            Not configured yet. Copy .env.example to .env and set VITE_SUPABASE_URL and
            VITE_SUPABASE_ANON_KEY.
          </p>
        </div>
      </div>
    )
  }

  if (created) {
    return (
      <div className="center-wrap">
        <div className="card">
          <h1>Session ready</h1>
          <p className="tagline">Share the code. Keep the PIN private.</p>
          <div className="code-badge">{created.code}</div>
          <p className="muted" style={{ textAlign: 'center', margin: '0.75rem 0 1.25rem' }}>
            Anyone with the code and PIN can join.
          </p>
          <div className="row">
            <a className="btn primary" href={`#/present?c=${created.code}`}>Open presenter</a>
            <a className="btn" href={`#/control?c=${created.code}`}>Open controller</a>
          </div>
          <p style={{ marginTop: '1rem', textAlign: 'center' }}>
            <button className="link-btn" onClick={() => setCreated(null)}>Start another</button>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="center-wrap">
      <form className="card" onSubmit={start}>
        <h1>OpenLectern</h1>
        <p className="tagline">Show scripture on a screen. Control it from any phone.</p>

        <div className="field">
          <label htmlFor="primary">First translation</label>
          <select id="primary" value={primary} onChange={(e) => setPrimary(e.target.value)}>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="secondary">Second translation (optional)</label>
          <select id="secondary" value={secondary} onChange={(e) => setSecondary(e.target.value)}>
            <option value="">None</option>
            {versions
              .filter((v) => v.id !== primary)
              .map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="pin">Choose a 4-digit PIN</label>
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

        {error && <p className="error">{error}</p>}

        <button className="btn primary wide" type="submit" disabled={busy || !versions.length}>
          {busy ? 'Starting...' : 'Start a session'}
        </button>

        <p style={{ marginTop: '1.25rem', textAlign: 'center' }} className="muted">
          Already have a code?{' '}
          <a className="link-btn" href="#/control">Control</a>{' or '}
          <a className="link-btn" href="#/present">Present</a>
        </p>
      </form>
    </div>
  )
}
