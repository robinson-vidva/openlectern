import { useEffect, useRef, useState } from 'react'
import { detectRefs, buildBookIndex, continuationText, pickBestTranscript } from '../lib/voice/detectRefs.js'
import { loadStructure, loadIndex } from '../lib/bibleData.js'
import { resolvePreviewText } from '../lib/voiceData.js'
import { shouldAutoShow, nextAutoMode, normalizeAutoMode, AUTO_MODE_LABELS } from '../lib/voice/autocapture.js'
import { loadPrefs, savePrefs } from '../lib/prefs.js'

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
  // Recognition language, remembered per device so a bilingual operator's choice
  // sticks across sessions; falls back to the loaded translation's language.
  const [lang, setLang] = useState(() => {
    const saved = loadPrefs().voiceLang
    return VOICE_LANGS.some((l) => l.id === saved) ? saved : defaultLang || 'en-US'
  })
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
  const recentRef = useRef(new Map()) // ref -> last time a CHIP was created (de-dupe)
  const autoFiredRef = useRef(new Map()) // ref -> last time it AUTO-SHOWED (separate de-dupe)
  const lastRefRef = useRef(null) // { bookName, chapter } of the most recent citation, for "verse N" continuation
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
    // Always include Tamil book names in the index so a reference spoken in Tamil
    // (or transcribed as Tamil script by the on-device engine) is recognized even
    // when no Tamil translation is loaded. Prefer a loaded Tamil version's names;
    // otherwise fall back to the bundled Tamil (tam_irv). English names are always
    // present, so mixed English + Tamil both match.
    let tamilNames
    const tamil = vers.find((v) => v.language === 'ta')
    const tamilId = tamil?.id || 'tam_irv'
    const idx = await loadIndex(tamilId).catch(() => null)
    if (idx) tamilNames = Object.fromEntries(idx.map((b) => [b.id, b.name]))
    indexRef.current = buildBookIndex(structure, tamilNames)
    return indexRef.current
  }

  // Rebuild the book index when the active translations change.
  const versionsKey = versions.map((v) => v.id).join(',')
  useEffect(() => {
    indexRef.current = null
    if (runningRef.current) ensureIndex()
  }, [versionsKey])

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
    const prune = (map) => {
      for (const [ref, ts] of map) if (now - ts >= DEDUPE_MS) map.delete(ref)
    }
    prune(recentRef.current)
    prune(autoFiredRef.current)

    // Auto-show is decided independently of chip de-dupe, so a reference the
    // operator saw as an interim chip can still auto-show once it's finalized.
    // It fires at most once per reference per window.
    let fired = false
    if (opts.allowAuto !== false && shouldAutoShow(cand, autoRef.current)) {
      const lastAuto = autoFiredRef.current.get(cand.ref)
      if (!lastAuto || now - lastAuto >= DEDUPE_MS) {
        autoFiredRef.current.set(cand.ref, now)
        fired = true
      }
    }
    if (fired) onShowRef.current(cand, 'auto')

    // Chip de-dupe: don't stack the same reference from repeated interim frames.
    const lastChip = recentRef.current.get(cand.ref)
    if (lastChip && now - lastChip < DEDUPE_MS) {
      // Already have a chip for this ref; if we just auto-showed it, mark it shown.
      if (fired) setChips((prev) => prev.map((c) => (c.ref === cand.ref ? { ...c, shown: true, auto: true } : c)))
      return false
    }
    recentRef.current.set(cand.ref, now)

    const chip = {
      key: `${cand.ref}-${now}`,
      ref: cand.ref,
      detail: cand,
      text: cand.preview || '',
      shown: fired,
      auto: fired,
      ambiguous: !!cand.ambiguous,
      from: opts.from || null
    }
    setChips((prev) => [chip, ...prev].slice(0, 5))
    resolvePreviewText(versionsRef.current, cand)
      .then((t) => setChips((prev) => prev.map((c) => (c.key === chip.key ? { ...c, text: t } : c))))
      .catch(() => {})
    return true
  }

  // A detection broadcast by another (listening) device.
  function addSharedChip(cand, from) {
    pushCandidate(cand, { from, allowAuto: false })
  }

  // Detect references in `text` and create chips. Auto-show is allowed ONLY for
  // references that also appear in `spokenText` (pass null to force chip-only, e.g.
  // from interim text). A single utterance can name several passages ("John 3:16
  // and Romans 8:28"), so every distinct one is surfaced, not just the top-ranked.
  function runDetect(text, spokenText) {
    const idx = indexRef.current
    if (!idx || !text) return
    const res = detectRefs(text, idx)
    if (res.length) {
      const autoKeys = new Set(detectRefs(spokenText || '', idx).map((c) => c.key))
      for (const cand of res.slice(0, 4)) {
        if (pushCandidate(cand, { allowAuto: autoKeys.has(cand.key) })) onDetectRef.current?.(cand)
      }
      // Remember the top citation so a following bookless "verse N" can continue it.
      lastRefRef.current = { bookName: res[0].bookName, chapter: res[0].chapter }
      return
    }
    // Continuation: a bookless "verse N" / "chapter N verse M" carried from the
    // last citation ("open to Romans 8" ... "verse 28" ... "verse 31").
    const cont = continuationText(text, lastRefRef.current)
    if (cont) {
      const cres = detectRefs(cont, idx)
      if (cres.length) {
        const cand = cres[0]
        if (pushCandidate(cand, { allowAuto: !!spokenText })) onDetectRef.current?.(cand)
        lastRefRef.current = { bookName: cand.bookName, chapter: cand.chapter }
      }
    }
    // Named-passage aliases and quote-catch are intentionally NOT run on the mic:
    // the listener only surfaces references someone actually states. Named passages
    // still resolve when typed into the search box.
  }

  function handleResult(e) {
    let interim = ''
    let finalText = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) {
        // Among Chrome's alternative transcripts, prefer the one that parses.
        const alts = []
        for (let a = 0; a < r.length; a++) alts.push(r[a].transcript)
        finalText += pickBestTranscript(alts, indexRef.current) + ' '
      } else {
        interim += r[0].transcript
      }
    }
    // Detect on each segment as it comes in -- no accumulated context (that made
    // stale references linger and re-surface). Interim (still-forming) text shows
    // tap-only chips for responsiveness; only finalized speech may AUTO-show, and
    // only for references within its own words. So chips appear as you speak, but
    // ordinary talking and half-heard guesses never switch the screen.
    if (interim.trim()) runDetect(interim, null)
    if (finalText.trim()) runDetect(finalText, finalText)

    const line = (interim || finalText || transcriptRef.current).trim().slice(-140)
    transcriptRef.current = line
    setTranscript(line)
    backoffRef.current = 300
  }

  function makeRecognition() {
    const rec = new Rec()
    rec.continuous = true
    rec.interimResults = true
    // Ask for several guesses per phrase; the top one often mangles an unusual book
    // name while a lower-ranked one gets it right (see pickBestTranscript).
    rec.maxAlternatives = 5
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
    await requestWake()
    // The user may have toggled off while the awaits above were in flight; if so,
    // stop() already ran and starting now would leave an orphaned live mic.
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
    recentRef.current.clear()
    autoFiredRef.current.clear()
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
    savePrefs({ voiceLang: next }) // remember for the next session
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
