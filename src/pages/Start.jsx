import { useEffect, useRef, useState } from 'react'
import { loadManifest } from '../lib/bibleData.js'
import { createSession, joinSession } from '../lib/session.js'
import { friendlyError, backendConfigured } from '../lib/supabase.js'
import { generatePin } from '../lib/newpin.js'
import { loadPrefs } from '../lib/prefs.js'
import { setHandoff, saveCreds } from '../lib/handoff.js'

function goto(route, code) {
  window.location.hash = `#/${route}?s=${code}`
}

export default function Start() {
  const [defaultConfig, setDefaultConfig] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('home') // 'home' | 'join'
  const [code, setCode] = useState('')
  const [havePin, setHavePin] = useState(false)
  const [pin, setPin] = useState('')
  const controlBusy = useRef(false)

  // Only needed when there is no remembered config: pick the bundled default.
  useEffect(() => {
    if (loadPrefs().config?.versions?.length) return
    loadManifest()
      .then((m) => {
        const list = m.versions || []
        const web = list.find((v) => v.id === 'eng-web') || list[0]
        if (web) setDefaultConfig({ versions: [{ id: web.id, name: web.name, language: web.language, helloaoId: web.helloaoId || null }] })
      })
      .catch((e) => setError(e.message))
  }, [])

  async function start() {
    setError('')
    const remembered = loadPrefs()
    const config = remembered.config?.versions?.length ? { versions: remembered.config.versions } : defaultConfig
    if (!config) return setError('Still loading. Try again in a moment.')
    setBusy(true)
    try {
      const newPin = generatePin()
      const row = await createSession(newPin, config)
      const creds = { code: row.code, pin: newPin, name: '', creator: true }
      saveCreds(creds)
      setHandoff({ row, creds })
      goto('control', row.code)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  function watch() {
    const c = code.trim().toUpperCase()
    if (c.length < 4) return setError('Enter the code from the screen.')
    goto('present', c)
  }

  async function control() {
    setError('')
    const c = code.trim().toUpperCase()
    if (c.length < 4) return setError('Enter the code from the screen.')
    if (!/^\d{4}$/.test(pin)) return setError('The PIN is 4 digits.')
    if (controlBusy.current) return
    controlBusy.current = true
    setBusy(true)
    try {
      const row = await joinSession(c, pin)
      const creds = { code: c, pin, name: '' }
      saveCreds(creds)
      setHandoff({ row, creds })
      goto('control', c)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
      controlBusy.current = false
    }
  }

  if (!backendConfigured) {
    return (
      <div className="center-wrap">
        <div className="card">
          <h1>OpenLectern</h1>
          <p className="error">
            Not configured yet. Set VITE_API_BASE to your Cloudflare Worker URL (or VITE_SUPABASE_URL and
            VITE_SUPABASE_ANON_KEY) in .env.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="center-wrap">
      <div className="card landing">
        <div className="landing-hero">
          <img className="landing-icon" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width="56" height="56" />
          <div>
            <h1>OpenLectern</h1>
            <p className="tagline">Show scripture on a screen. Control it from any phone.</p>
          </div>
        </div>

        <p className="landing-desc">
          OpenLectern puts Bible verses on a fullscreen display for your congregation while you drive it
          from your phone. Search or <em>speak</em> a reference and it appears — in one or two languages
          at once. Nothing to install and no account: share a code and you’re live.
        </p>

        <ul className="landing-features">
          <li>Fullscreen screen + phone remote</li>
          <li>Two languages side by side</li>
          <li>Speak a reference — it appears</li>
          <li>Free &amp; open · any device</li>
        </ul>

        {mode === 'home' ? (
          <div className="landing-actions">
            <button className="btn primary wide start-btn" onClick={start} disabled={busy}>
              {busy ? 'Starting…' : 'Start a session'}
            </button>
            <button
              className="btn wide"
              onClick={() => {
                setError('')
                setMode('join')
              }}
              disabled={busy}
            >
              Join or view a screen
            </button>
            <p className="muted start-sub">
              <strong>Start</strong> creates a screen and takes you to the remote — your code and PIN are inside.
              <strong> Join</strong> if someone already shared a code.
            </p>
          </div>
        ) : (
          <div className="join-panel">
            <div className="join-panel-head">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setError('')
                  setMode('home')
                }}
              >
                ← Back
              </button>
              <span className="join-panel-title">Join a screen</span>
            </div>

            <div className="field">
              <label htmlFor="code">Screen code</label>
              <input
                id="code"
                type="text"
                autoCapitalize="characters"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. K7PM4Q"
              />
            </div>

            <button className="btn wide" onClick={watch} disabled={busy}>Open the screen (view only)</button>

            {!havePin ? (
              <p className="have-pin">
                Controlling from your phone?{' '}
                <button type="button" className="link-btn" onClick={() => setHavePin(true)}>I have a PIN</button>
              </p>
            ) : (
              <div className="pin-block">
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
                <button className="btn primary wide" onClick={control} disabled={busy}>Control the screen</button>
                <p className="muted invite-line">
                  <a className="link-btn" href={`#/control?s=${code.trim().toUpperCase()}&invite=1`}>Join with an invite code instead</a>
                </p>
              </div>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <p className="muted credits">
          Scripture: World English Bible, King James Version, American Standard Version (public domain) and
          community translations. Cross-references from{' '}
          <a className="link-btn" href="https://www.openbible.info/labs/cross-references/" target="_blank" rel="noreferrer">openbible.info</a>{' '}
          (CC BY).
        </p>
      </div>
    </div>
  )
}
