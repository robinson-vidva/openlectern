import { useEffect, useRef, useState } from 'react'
import { loadManifest } from '../lib/bibleData.js'
import { createSession, joinSession } from '../lib/session.js'
import { friendlyError, supabaseConfigured } from '../lib/supabase.js'
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

  if (!supabaseConfigured) {
    return (
      <div className="center-wrap">
        <div className="card">
          <h1>OpenLectern</h1>
          <p className="error">
            Not configured yet. Copy .env.example to .env and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="center-wrap">
      <div className="card landing">
        <h1>OpenLectern</h1>
        <p className="tagline">Show scripture on a screen. Control it from any phone.</p>

        <button className="btn primary wide start-btn" onClick={start} disabled={busy}>
          {busy ? 'Starting...' : 'Start'}
        </button>
        <p className="muted start-sub">One tap. You go straight to the remote; your code and PIN are inside.</p>

        <div className="join-block">
          <div className="field">
            <label htmlFor="code">Have a code? Join a screen</label>
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

          <button className="btn wide" onClick={watch} disabled={busy}>Watch</button>

          {!havePin ? (
            <p className="have-pin">
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
              <button className="btn primary wide" onClick={control} disabled={busy}>Control</button>
              <p className="muted invite-line">
                <a className="link-btn" href={`#/control?s=${code.trim().toUpperCase()}&invite=1`}>Join with an invite code instead</a>
              </p>
            </div>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        <p className="muted credits">
          Scripture: World English Bible (public domain) and community translations.
          Cross-references from{' '}
          <a className="link-btn" href="https://www.openbible.info/labs/cross-references/" target="_blank" rel="noreferrer">openbible.info</a>{' '}
          (CC BY).
        </p>
      </div>
    </div>
  )
}
