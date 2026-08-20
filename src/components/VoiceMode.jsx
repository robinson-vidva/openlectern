import { useEffect, useRef, useState } from 'react'
import { detectRefs, buildBookIndex } from '../lib/voice/detectRefs.js'
import { loadStructure, loadIndex } from '../lib/bibleData.js'
import { resolvePreviewText } from '../lib/voiceData.js'

const Rec = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
const SUPPORTED = !!Rec
const LANGS = [
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-IN', label: 'English (India)' },
  { id: 'ta-IN', label: 'Tamil' }
]
const DEDUPE_MS = 10000

// Voice mode: the controller's mic listens and surfaces detected references as
// chips (CONFIRM). AUTO shows high-confidence detections without a tap.
export default function VoiceMode({ versions, defaultLang, onShow }) {
  const [lang, setLang] = useState(defaultLang || 'en-US')
  const [auto, setAuto] = useState(false)
  const [active, setActive] = useState(false)
  const [micState, setMicState] = useState('off') // off | listening | error
  const [error, setError] = useState('')
  const [transcript, setTranscript] = useState('')
  const [chips, setChips] = useState([])

  const recRef = useRef(null)
  const runningRef = useRef(false)
  const restartRef = useRef(null)
  const backoffRef = useRef(300)
  const wakeRef = useRef(null)
  const indexRef = useRef(null)
  const recentRef = useRef(new Map())
  const autoRef = useRef(auto)
  const langRef = useRef(lang)
  useEffect(() => {
    autoRef.current = auto
  }, [auto])

  // Build the book index (primary version structure + Tamil book names) once.
  async function ensureIndex() {
    if (indexRef.current) return indexRef.current
    const primary = versions[0]
    const structure = (await loadStructure(primary.id)) || {}
    let tamilNames
    const tamil = versions.find((v) => v.language === 'ta')
    if (tamil) {
      const idx = await loadIndex(tamil.id)
      if (idx) tamilNames = Object.fromEntries(idx.map((b) => [b.id, b.name]))
    }
    indexRef.current = buildBookIndex(structure, tamilNames)
    return indexRef.current
  }

  async function requestWake() {
    try {
      if (navigator.wakeLock) wakeRef.current = await navigator.wakeLock.request('screen')
    } catch {
      /* wake lock is best-effort */
    }
  }
  function releaseWake() {
    try {
      wakeRef.current?.release?.()
    } catch {
      /* ignore */
    }
    wakeRef.current = null
  }

  function pushCandidate(cand) {
    const now = Date.now()
    const last = recentRef.current.get(cand.ref)
    if (last && now - last < DEDUPE_MS) return
    recentRef.current.set(cand.ref, now)

    const fired = autoRef.current && cand.confidence === 'high'
    const chip = { key: `${cand.ref}-${now}`, ref: cand.ref, detail: cand, text: '', shown: fired, auto: fired }
    setChips((prev) => [chip, ...prev].slice(0, 3))
    resolvePreviewText(versions, cand)
      .then((t) => setChips((prev) => prev.map((c) => (c.key === chip.key ? { ...c, text: t } : c))))
      .catch(() => {})
    if (fired) onShow(cand)
  }

  function handleResult(e) {
    let interim = ''
    let didFinal = false
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      const text = r[0].transcript
      if (r.isFinal) {
        didFinal = true
        runDetect(text)
      } else {
        interim += text
      }
    }
    setTranscript((interim || (didFinal ? '' : transcript)).trim().slice(-140))
    if (interim) runDetect(interim)
    backoffRef.current = 300 // healthy stream, reset backoff
  }

  function runDetect(text) {
    const idx = indexRef.current
    if (!idx || !text) return
    const res = detectRefs(text, idx)
    if (res.length) pushCandidate(res[0])
  }

  function makeRecognition() {
    const rec = new Rec()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = langRef.current
    rec.onstart = () => {
      setMicState('listening')
      setError('')
    }
    rec.onresult = handleResult
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('Microphone blocked. Allow mic access in the browser, then start again.')
        stop()
      } else if (e.error === 'no-speech' || e.error === 'aborted') {
        /* benign; onend will restart */
      } else if (e.error === 'network') {
        setError('Speech service unreachable. Voice needs internet; retrying...')
        setMicState('error')
      } else {
        setError(`Voice error: ${e.error}`)
        setMicState('error')
      }
    }
    rec.onend = () => {
      if (!runningRef.current) return
      restartRef.current = setTimeout(() => {
        try {
          rec.start()
        } catch {
          makeRecognition()
        }
      }, backoffRef.current)
      backoffRef.current = Math.min(backoffRef.current * 2, 4000)
    }
    recRef.current = rec
    try {
      rec.start()
    } catch {
      /* start throws if called too soon after a previous one */
    }
  }

  async function start() {
    if (!SUPPORTED) return
    setError('')
    runningRef.current = true
    setActive(true)
    await ensureIndex()
    await requestWake()
    makeRecognition()
  }

  function stop() {
    runningRef.current = false
    setActive(false)
    clearTimeout(restartRef.current)
    const rec = recRef.current
    recRef.current = null
    if (rec) {
      rec.onend = null
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
    }
    releaseWake()
    setMicState('off')
    setTranscript('')
  }

  function toggle() {
    if (active) stop()
    else start()
  }

  // Re-acquire the wake lock when returning to the tab.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && runningRef.current && !wakeRef.current) requestWake()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Restart recognition with the new language when it changes mid-session.
  function changeLang(next) {
    setLang(next)
    langRef.current = next
    if (runningRef.current) {
      const rec = recRef.current
      recRef.current = null
      if (rec) {
        rec.onend = null
        try {
          rec.stop()
        } catch {
          /* ignore */
        }
      }
      makeRecognition()
    }
  }

  useEffect(() => () => stop(), [])

  function tapChip(chip) {
    onShow(chip.detail)
    setChips((prev) => prev.map((c) => (c.key === chip.key ? { ...c, shown: true } : c)))
  }

  if (!SUPPORTED) {
    return (
      <div className="voice">
        <div className="voice-head">
          <span className="voice-title">Voice</span>
        </div>
        <p className="muted" style={{ margin: '0.4rem 0 0' }}>
          Voice needs Chrome or Edge on this device.
        </p>
      </div>
    )
  }

  return (
    <div className="voice">
      <div className="voice-head">
        <span className="voice-title">Voice</span>
        <span className={`mic ${micState}`}>
          <span className="mic-dot" />
          {micState === 'listening' ? 'Listening' : micState === 'error' ? 'Error' : 'Off'}
        </span>
        <button className={`btn small${active ? ' primary' : ''}`} onClick={toggle}>
          {active ? 'Stop' : 'Start listening'}
        </button>
      </div>

      {chips.length > 0 && (
        <div className="voice-chips">
          {chips.map((chip) => (
            <button
              key={chip.key}
              className={`voice-chip${chip.shown ? ' shown' : ''}`}
              onClick={() => tapChip(chip)}
            >
              <span className="vc-ref">{chip.ref}</span>
              {chip.text && <span className="vc-text">{chip.text}</span>}
              {chip.auto && <span className="vc-auto">auto</span>}
            </button>
          ))}
        </div>
      )}

      <div className="voice-controls">
        <label className="voice-lang">
          Language
          <select value={lang} onChange={(e) => changeLang(e.target.value)}>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
        <label className="voice-auto">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Auto-show strong matches
        </label>
      </div>

      {auto && (
        <p className="muted voice-hint">Auto shows exact book + valid verse instantly. Anything unsure still waits as a chip.</p>
      )}
      {error && <p className="error" style={{ margin: '0.4rem 0 0' }}>{error}</p>}
      {micState === 'listening' && (
        <p className="voice-transcript">{transcript || 'Listening for a reference...'}</p>
      )}
      {micState === 'listening' && (
        <p className="muted voice-hint">Keep this screen on and unlocked; the mic stops if the phone sleeps.</p>
      )}
    </div>
  )
}
