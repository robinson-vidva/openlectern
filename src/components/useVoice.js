import { useEffect, useRef, useState } from 'react'
import { detectRefs, buildBookIndex } from '../lib/voice/detectRefs.js'
import { loadStructure, loadIndex } from '../lib/bibleData.js'
import { resolvePreviewText } from '../lib/voiceData.js'
import { matchAliases } from '../lib/aliases.js'
import { parseReference, formatLabel } from '../lib/parseRef.js'
import { BOOK_BY_ID } from '../lib/books.js'
import { WINDOW_WORDS } from '../lib/quote/quoteIndex.js'
import { normalizeTokens } from '../lib/quote/shingle.js'

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
  const transcriptRef = useRef('')
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect
  const quoteWorkerRef = useRef(null)
  const quoteWindowRef = useRef([])
  const quoteSeqRef = useRef(0)
  useEffect(() => {
    autoRef.current = auto
  }, [auto])

  async function ensureIndex() {
    if (indexRef.current) return indexRef.current
    const primary = versions[0]
    // Detection validates against the primary version's structure. If a
    // switched-to (e.g. online) version has no local structure, degrade to the
    // bundled WEB structure -- best available, never the wrong version silently.
    let structure = primary ? await loadStructure(primary.id) : null
    if (!structure || !Object.keys(structure).length) structure = (await loadStructure('eng-web')) || {}
    let tamilNames
    const tamil = versions.find((v) => v.language === 'ta')
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
    if (w) w.postMessage({ type: 'load', base: BASE, versionIds: versions.map((v) => v.id) })
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
  function pushCandidate(cand, opts = {}) {
    const now = Date.now()
    const last = recentRef.current.get(cand.ref)
    if (last && now - last < DEDUPE_MS) return // cross-device dedupe
    recentRef.current.set(cand.ref, now)

    // Quote chips NEVER auto-show, regardless of the auto toggle.
    const fired = opts.allowAuto !== false && autoRef.current && cand.confidence === 'high'
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
    setChips((prev) => [chip, ...prev].slice(0, 3))
    resolvePreviewText(versions, cand)
      .then((t) => setChips((prev) => prev.map((c) => (c.key === chip.key ? { ...c, text: t } : c))))
      .catch(() => {})
    if (fired) onShow(cand, 'auto')
  }

  // A detection broadcast by another (listening) device.
  function addSharedChip(cand, from) {
    pushCandidate(cand, { from, allowAuto: false })
  }

  function runDetect(text, isFinal) {
    const idx = indexRef.current
    if (!idx || !text) return
    const res = detectRefs(text, idx)
    if (res.length) {
      pushCandidate(res[0])
      onDetectRef.current?.(res[0])
      return
    }
    // No citation. On final segments only, try named-passage aliases -- fuzzier
    // than a citation, so chip-only and never auto-shown.
    if (!isFinal) return
    const hit = matchAliases(text)[0]
    if (!hit) return
    const parsed = parseReference(hit.refs[0])
    if (!parsed) return
    const cand = { ...parsed, ref: `${hit.name} -> ${formatLabel(parsed)}`, confidence: 'alias', alias: hit.name }
    pushCandidate(cand, { allowAuto: false })
    onDetectRef.current?.(cand)
  }

  function handleResult(e) {
    let interim = ''
    let didFinal = false
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      const text = r[0].transcript
      if (r.isFinal) {
        didFinal = true
        runDetect(text, true)
        feedQuoteWindow(text)
      } else {
        interim += text
      }
    }
    const line = (interim || (didFinal ? '' : transcriptRef.current)).trim().slice(-140)
    transcriptRef.current = line
    setTranscript(line)
    if (interim) runDetect(interim, false)
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
    onShow(chip.detail, 'voice')
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
    auto,
    setAuto,
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
