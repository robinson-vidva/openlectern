import { useEffect, useRef, useState } from 'react'
import { loadManifest } from '../lib/bibleData.js'
import { createSession, joinSession, loadAppConfig } from '../lib/session.js'
import Turnstile from '../components/Turnstile.jsx'
import { friendlyError, backendConfigured } from '../lib/backendConfig.js'
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
  const [code, setCode] = useState('') // control card
  const [pin, setPin] = useState('')
  const [viewCode, setViewCode] = useState('') // watch card
  const controlBusy = useRef(false)

  // Bot protection on session creation (Cloudflare Turnstile). The backend says
  // whether it is on by publishing its site key; when it is, Start waits for a
  // token and sends it along. Tokens are single-use: a failed create resets the
  // widget so the retry carries a fresh one.
  const [appCfg, setAppCfg] = useState(null)
  const [tsToken, setTsToken] = useState(null)
  const [tsReset, setTsReset] = useState(0)
  const [tsError, setTsError] = useState(false)
  useEffect(() => {
    let live = true
    loadAppConfig().then((c) => live && setAppCfg(c || {}))
    return () => {
      live = false
    }
  }, [])
  const needsHuman = !!appCfg?.turnstileSiteKey
  const humanReady = !needsHuman || !!tsToken

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
    if (!humanReady) return setError('Still checking that you are human. Try again in a moment.')
    setBusy(true)
    try {
      const newPin = generatePin()
      const row = await createSession(newPin, config, tsToken)
      const creds = { code: row.code, pin: newPin, name: '', creator: true }
      saveCreds(creds)
      setHandoff({ row, creds })
      goto('control', row.code)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
      if (needsHuman) setTsReset((k) => k + 1) // the token was spent; get a new one
    }
  }

  async function control(e) {
    e.preventDefault()
    setError('')
    const c = code.trim().toUpperCase()
    if (c.length < 4) return setError('Enter the screen code.')
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

  function watch(e) {
    e.preventDefault()
    setError('')
    const c = viewCode.trim().toUpperCase()
    if (c.length < 4) return setError('Enter the screen code.')
    goto('present', c)
  }

  if (!backendConfigured) {
    return (
      <div className="center-wrap">
        <div className="card">
          <h1>OpenLectern</h1>
          <p className="error">Not configured yet. Set VITE_API_BASE in .env (see the README).</p>
        </div>
      </div>
    )
  }

  return (
    <div className="center-wrap">
      <div className="landing">
        <header className="landing-head">
          <img className="landing-icon" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width="64" height="64" />
          <h1>OpenLectern</h1>
          <p className="tagline">Show scripture on a screen. Control it from any phone.</p>
          <p className="landing-lead">
            Bible verses on a fullscreen display, driven from your phone — search or <em>speak</em> a reference,
            in one or two languages at once. No installs, no account: share a code and you’re live.
          </p>
        </header>

        <div className="landing-cards">
          <section className="lcard">
            <h2>New session</h2>
            <p className="lcard-desc">Create a screen and become the controller. You get a code, QR, and PIN to share.</p>
            <div className="lcard-foot">
              {needsHuman && (
                <Turnstile
                  siteKey={appCfg.turnstileSiteKey}
                  onToken={(t) => {
                    setTsToken(t)
                    if (t) setTsError(false)
                  }}
                  onError={() => setTsError(true)}
                  resetKey={tsReset}
                />
              )}
              <button className="btn primary wide" onClick={start} disabled={busy || !humanReady}>
                {busy ? 'Starting…' : 'Start a session'}
              </button>
              {needsHuman && !tsToken && (
                <p className="muted turnstile-note" role="status">
                  {tsError
                    ? 'The human check could not load. Turn off content blockers for this site and reload.'
                    : 'Checking that you are human…'}
                </p>
              )}
            </div>
          </section>

          <form className="lcard" onSubmit={control}>
            <h2>Control a screen</h2>
            <p className="lcard-desc">Have a code and PIN? Drive an existing screen from your phone.</p>
            <div className="field">
              <label htmlFor="c-code">Screen code</label>
              <input
                id="c-code"
                type="text"
                autoCapitalize="characters"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. K7PM4Q"
              />
            </div>
            <div className="field">
              <label htmlFor="c-pin">PIN</label>
              <input
                id="c-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="4 digits"
              />
            </div>
            <div className="lcard-foot">
              <button className="btn primary wide" type="submit" disabled={busy}>Control</button>
              <a className="link-btn lcard-alt" href={`#/control?s=${code.trim().toUpperCase()}&invite=1`}>
                Join with an invite code instead
              </a>
            </div>
          </form>

          <form className="lcard" onSubmit={watch}>
            <h2>Watch a screen</h2>
            <p className="lcard-desc">Just viewing? Open the screen with a code — no PIN needed.</p>
            <div className="field">
              <label htmlFor="w-code">Screen code</label>
              <input
                id="w-code"
                type="text"
                autoCapitalize="characters"
                autoComplete="off"
                value={viewCode}
                onChange={(e) => setViewCode(e.target.value.toUpperCase())}
                placeholder="e.g. K7PM4Q"
              />
            </div>
            <div className="lcard-foot">
              <button className="btn wide" type="submit" disabled={busy}>Open the screen</button>
            </div>
          </form>
        </div>

        {error && <p className="error landing-error">{error}</p>}

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
