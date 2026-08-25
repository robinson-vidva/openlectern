import { useEffect, useRef, useState } from 'react'
import { detectRefs, buildBookIndex } from '../lib/voice/detectRefs.js'
import { loadStructure, loadIndex } from '../lib/bibleData.js'
import { resolvePreviewText } from '../lib/voiceData.js'
import { matchAliases } from '../lib/aliases.js'
import { parseReference, formatLabel } from '../lib/parseRef.js'
import { BOOK_BY_ID } from '../lib/books.js'
import { WINDOW_WORDS } from '../lib/quote/quoteIndex.js'
import { normalizeTokens } from '../lib/quote/shingle.js'
import { shouldAutoShow, nextAutoMode, normalizeAutoMode, AUTO_MODE_LABELS } from '../lib/voice/autocapture.js'
import { growContext } from '../lib/voice/context.js'
import { loadPrefs, savePrefs } from '../lib/prefs.js'

const BASE = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.BASE_URL || '/' : '/'

const Rec = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
export const VOICE_SUPPORTED = !!Rec
export const VOICE_LANGS = [
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-IN', label: 'English (India)' },
  { id: 'ta-IN', label: 'Tamil' }
]
const DEDUPE_MS = 10000

// The voice engine, lifted into a hook so the controls (in a tab) and the chips
// (in a persistent slot) can share one always-alive recognition session. Behavior
// is identical to the previous VoiceMode component.
export function useVoice({ versions, defaultLang, onShow, onDetect }) {
  const [lang, setLang] = useState(defaultLang || 'en-US')
  // Auto-capture mode: 'off' | 'verse' | 'chapter' (remembered per device).
  const [autoMode, setAutoMode] = useState(() => normalizeAutoMode(loadPrefs().autoMode))
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
  // Rolling window of recently finalized words, so a reference split across
  // recognition segments is still detected as a whole.
  const contextRef = useRef('')
  const autoRef = useRef(autoMode)
  const langRef = useRef(lang)
  const transcriptRef = useRef('')
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect
  // The recognition callbacks are bound once in makeRecognition(); read the
  // latest onShow + versions through refs so a mid-session translation switch
  // resolves auto-shows and previews against the NEW translations.
  const onShowRef = useRef(onShow)
  onShowRef.current = onShow
  const versionsRef = useRef(versions)
  versionsRef.current = versions
  const quoteWorkerRef = useRef(null)
  const quoteWindowRef = useRef([])
  const quoteSeqRef = useRef(0)
  useEffect(() => {
    autoRef.current = autoMode
  }, [autoMode])
  function cycleAutoMode() {
    setAutoMode((m) => {
      const next = nextAutoMode(m)
      savePrefs({ autoMode: next })
      return next
    })
  }

  async function ensureIndex() {
    if (indexRef.current) return indexRef.current
    const vers = versionsRef.current
    const primary = vers[0]
    // Detection validates against the primary version's structure. If a
    // switched-to (e.g. online) version has no local structure, degrade to the
    // bundled WEB structure -- best available, never the wrong version silently.
    let structure = primary ? await loadStructure(primary.id) : null
    if (!structure || !Object.keys(structure).length) structure = (await loadStructure('eng-web')) || {}
    let tamilNames
    const tamil = vers.find((v) => v.language === 'ta')
    if (tamil) {
      const idx = await loadIndex(tamil.id)
      if (idx) tamilNames = Object.fromEntries(idx.map((b) => [b.id, b.name]))
    }
    indexRef.current = buildBookIndex(structure, tamilNames)
    return indexRef.current
  }

  // Rebuild the book index when the active translations change.
  const versionsKey = versions.map((v) => v.id).join(',')
  useEffect(() => {
    indexRef.current = null
    if (runningRef.current) {
      ensureIndex()
      loadQuoteIndex()
    }
  }, [versionsKey])

  // ---- quotation detection (stage 1) ----
  // A Web Worker holds the shingle index and scans a rolling window off the main
  // thread. Detected quotes become chips that NEVER auto-show.
  function ensureQuoteWorker() {
    if (quoteWorkerRef.current || typeof Worker === 'undefined') return quoteWorkerRef.current
    try {
      const w = new Worker(new URL('../workers/quoteWorker.js', import.meta.url), { type: 'module' })
      w.onmessage = (e) => {
        const msg = e.data
        if (msg?.type !== 'result' || !msg.hits?.length) return
        const hit = msg.hits[0]
        const name = BOOK_BY_ID[hit.bookId]?.name || hit.bookId
        const cand = {
          bookId: hit.bookId,
          bookName: name,
          chapter: hit.chapter,
          verseStart: hit.verse,
          endChapter: hit.chapter,
          verseEnd: hit.verse,
          ref: `${name} ${hit.chapter}:${hit.verse}`,
          confidence: 'quote'
        }
        pushCandidate(cand, { allowAuto: false })
        onDetectRef.current?.(cand)
      }
      quoteWorkerRef.current = w
    } catch {
      /* workers unavailable: quote detection is simply off */
    }
    return quoteWorkerRef.current
  }
  function loadQuoteIndex() {
    const w = ensureQuoteWorker()
    if (w) w.postMessage({ type: 'load', base: BASE, versionIds: versionsRef.current.map((v) => v.id) })
  }
  function feedQuoteWindow(text) {
    const w = quoteWorkerRef.current
    if (!w) return
    const words = normalizeTokens(text)
    if (!words.length) return
    const win = quoteWindowRef.current.concat(words).slice(-WINDOW_WORDS)
    quoteWindowRef.current = win
    w.postMessage({ type: 'scan', seq: ++quoteSeqRef.current, tokens: win })
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

  // opts.from = source device name (shared chip from another device).
  // opts.allowAuto = whether this device may auto-show (local detections only).
  // Returns true if a chip was created, false if the reference was suppressed as a
  // recent duplicate -- so callers only broadcast genuinely new detections.
  function pushCandidate(cand, opts = {}) {
    const now = Date.now()
    const last = recentRef.current.get(cand.ref)
    if (last && now - last < DEDUPE_MS) return false // cross-device dedupe
    // Evict entries past the dedupe window so an all-day session doesn't grow this
    // map without bound (one entry per distinct detected reference otherwise).
    for (const [ref, ts] of recentRef.current) {
      if (now - ts >= DEDUPE_MS) recentRef.current.delete(ref)
    }
    recentRef.current.set(cand.ref, now)

    // Quote/alias chips pass allowAuto:false and never auto-show. Citations go
    // through the auto-capture policy for the current mode.
    const fired = opts.allowAuto !== false && shouldAutoShow(cand, autoRef.current)
    const chip = {
      key: `${cand.ref}-${now}`,
      ref: cand.ref,
      detail: cand,
      text: cand.preview || '',
      shown: fired,
      auto: fired,
      quote: cand.confidence === 'quote',
      from: opts.from || null
    }
    setChips((prev) => [chip, ...prev].slice(0, 5))
    resolvePreviewText(versionsRef.current, cand)
      .then((t) => setChips((prev) => prev.map((c) => (c.key === chip.key ? { ...c, text: t } : c))))
      .catch(() => {})
    if (fired) onShowRef.current(cand, 'auto')
    return true
  }

  // A detection broadcast by another (listening) device.
  function addSharedChip(cand, from) {
    pushCandidate(cand, { from, allowAuto: false })
  }

  // Detect references across `windowText` (the rolling window, for recall) and
  // create chips. Auto-show is allowed ONLY for references that also appear in
  // `spokenText` -- the words just finalized in this segment. So a reference left
  // lingering in the window, or one still forming mid-word, can never switch the
  // screen on its own: it stays a tap-only chip. A single utterance can name
  // several passages ("John 3:16 and Romans 8:28"), so every distinct one is
  // surfaced, not just the top-ranked.
  function runDetect(windowText, spokenText) {
    const idx = indexRef.current
    if (!idx || !windowText) return
    const res = detectRefs(windowText, idx)
    if (res.length) {
      const autoKeys = new Set(detectRefs(spokenText || '', idx).map((c) => c.key))
      for (const cand of res.slice(0, 4)) {
        if (pushCandidate(cand, { allowAuto: autoKeys.has(cand.key) })) onDetectRef.current?.(cand)
      }
      return
    }
    // No citation in the window: try a named-passage alias -- fuzzier than a
    // citation, so chip-only and never auto-shown.
    const hit = matchAliases(windowText)[0]
    if (!hit) return
    const parsed = parseReference(hit.refs[0])
    if (!parsed) return
    const cand = { ...parsed, ref: `${hit.name} -> ${formatLabel(parsed)}`, confidence: 'alias', alias: hit.name }
    if (pushCandidate(cand, { allowAuto: false })) onDetectRef.current?.(cand)
  }

  function handleResult(e) {
    let interim = ''
    let finalText = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finalText += r[0].transcript + ' '
      else interim += r[0].transcript
    }
    // Detection runs ONLY on finalized speech, never on interim (half-heard) text,
    // so ordinary talking and mid-word guesses can't switch the screen. Finalized
    // words extend the rolling window (to reassemble a reference split across
    // segments); auto-show is gated to references within this segment's own words.
    if (finalText.trim()) {
      contextRef.current = growContext(contextRef.current, finalText)
      feedQuoteWindow(finalText)
      runDetect(contextRef.current, finalText)
    }

    // Interim words only update the live transcript line, so the operator still
    // sees the mic is hearing them.
    const line = (interim || finalText || transcriptRef.current).trim().slice(-140)
    transcriptRef.current = line
    setTranscript(line)
    backoffRef.current = 300
  }

  function makeRecognition() {
    const rec = new Rec()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = langRef.current
    rec.onstart = () => {
      setMicState('listening')
      setError('')
      backoffRef.current = 300 // recovered; restart quickly if it drops again
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
      } else if (e.error === 'language-not-supported' || e.error === 'bad-grammar') {
        setError('This browser cannot transcribe the selected language. Try Chrome, or pick another recognition language.')
        stop()
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
    if (!VOICE_SUPPORTED) return
    setError('')
    runningRef.current = true
    setActive(true)
    await ensureIndex()
    loadQuoteIndex()
    await requestWake()
    // The user may have toggled off while the awaits above were in flight; if so,
    // stop() already ran and starting recognition now would leave an orphaned live
    // mic that the UI shows as "off".
    if (!runningRef.current) return
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
    if (quoteWorkerRef.current) {
      quoteWorkerRef.current.terminate()
      quoteWorkerRef.current = null
    }
    quoteWindowRef.current = []
    contextRef.current = ''
    setMicState('off')
    setTranscript('')
    transcriptRef.current = ''
  }

  function toggle() {
    if (active) stop()
    else start()
  }

  function changeLang(next) {
    setLang(next)
    langRef.current = next
    if (runningRef.current) {
      const rec = recRef.current
      recRef.current = null
      clearTimeout(restartRef.current)
      if (rec) {
        // Recreate with the new language only after the current session has
        // fully ended -- starting a new recognition while the old one is still
        // releasing throws in Chrome and would silently kill transcription.
        rec.onend = () => {
          if (runningRef.current) makeRecognition()
        }
        try {
          rec.stop()
        } catch {
          makeRecognition()
        }
      } else {
        makeRecognition()
      }
    }
  }

  function tapChip(chip) {
    onShowRef.current(chip.detail, 'voice')
    setChips((prev) => prev.map((c) => (c.key === chip.key ? { ...c, shown: true } : c)))
  }

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && runningRef.current && !wakeRef.current) requestWake()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useEffect(() => () => stop(), [])

  return {
    supported: VOICE_SUPPORTED,
    langs: VOICE_LANGS,
    lang,
    changeLang,
    autoMode,
    autoModeLabel: AUTO_MODE_LABELS[autoMode],
    cycleAutoMode,
    active,
    micState,
    error,
    transcript,
    chips,
    toggle,
    start,
    stop,
    tapChip,
    addSharedChip
  }
}
