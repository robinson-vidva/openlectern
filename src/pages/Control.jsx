import { useEffect, useMemo, useRef, useState } from 'react'
import JoinForm from '../components/JoinForm.jsx'
import { useVoice } from '../components/useVoice.js'
import { updateSession, joinSession } from '../lib/session.js'
import { supabase, friendlyError } from '../lib/supabase.js'
import { takeHandoff, saveCreds, loadCreds, clearCreds } from '../lib/handoff.js'
import { loadPrefs, savePrefs, clearPrefs, hintSeen, markHintSeen } from '../lib/prefs.js'
import Qr from '../components/Qr.jsx'
import { parseReference, formatLabel, searchBooks, parsePartialRef } from '../lib/parseRef.js'
import { matchAliases } from '../lib/aliases.js'
import { extractReferences } from '../lib/planText.js'
import { resolveItem, resolveCurrent, wholeCurrent, stepCurrent, verseCount, passagePages } from '../lib/resolve.js'
import { pageOfVerse } from '../lib/paginate.js'
import { loadStructure, loadManifest, loadHelloaoList } from '../lib/bibleData.js'
import { appendHistory } from '../lib/history.js'
import { makeInviteCode, isInviteValid, hmacKey, signMsg, verifyMsg } from '../lib/crypto.js'
import { checkInviteProof, buildInviteResponse } from '../lib/invite.js'
import { activeListeners, listenerDrops } from '../lib/listener.js'
import { loadXrefBook, lookupXrefs } from '../lib/xrefs.js'
import { resolvePreviewText } from '../lib/voiceData.js'
import ListenerView from '../components/ListenerView.jsx'

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function Console({ row, creds }) {
  const code = row.code
  const [config, setConfig] = useState(row.config || {})
  const versions = config?.versions || []
  const [state, setState] = useState(row.state)
  // Mirror of the latest state so rapid Next/Back taps read fresh values.
  const stateRef = useRef(row.state)
  const [presence, setPresence] = useState([])
  const [status, setStatus] = useState('')
  const [connected, setConnected] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [copied, setCopied] = useState('')
  const [pinReveal, setPinReveal] = useState(false)
  const [invite, setInvite] = useState(null)
  const [inviteSecs, setInviteSecs] = useState(0)
  const [inviteNote, setInviteNote] = useState('')
  const inviteRef = useRef(null)
  const credsRef = useRef(creds)
  credsRef.current = creds
  const [listenerMode, setListenerMode] = useState(false)
  const [presenceEntries, setPresenceEntries] = useState([])
  const [listenerBanner, setListenerBanner] = useState('')
  const [showHint, setShowHint] = useState(() => !hintSeen())
  const [qrBig, setQrBig] = useState(false)
  function dismissHint() {
    markHintSeen()
    setShowHint(false)
  }
  function resetRemembered() {
    clearPrefs()
    setStatus('Remembered settings cleared. New sessions will start from defaults.')
  }
  const voiceRef = useRef(null)
  const channelRef = useRef(null)
  const keyRef = useRef(null)
  const prevListenersRef = useRef([])
  async function getSigKey() {
    if (!keyRef.current) keyRef.current = await hmacKey('pin:' + credsRef.current.pin)
    return keyRef.current
  }
  // Broadcast a local detection (signed) so operating controllers see a labeled chip.
  async function broadcastDetect(cand) {
    const ch = channelRef.current
    if (!ch) return
    const msg = JSON.stringify({ cand, from: credsRef.current.name || 'Someone', at: Date.now() })
    try {
      ch.send({ type: 'broadcast', event: 'detect', payload: { msg, sig: await signMsg(await getSigKey(), msg) } })
    } catch {
      /* ignore transient send errors */
    }
  }
  const [tab, setTab] = useState(() => {
    try {
      return sessionStorage.getItem('ol-tab') || 'go'
    } catch {
      return 'go'
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem('ol-tab', tab)
    } catch {
      /* ignore */
    }
  }, [tab])

  // Realtime + presence.
  useEffect(() => {
    const channel = supabase.channel(`session:${code}`, {
      config: { presence: { key: crypto.randomUUID() }, broadcast: { self: false } }
    })
    // Invite responder: a new device that knows a live invite code gets the PIN
    // encrypted (never in the clear). Any attempt burns the single-use invite.
    channel.on('broadcast', { event: 'invite-req' }, async ({ payload }) => {
      const inv = inviteRef.current
      if (!payload?.nonce || !isInviteValid(inv, Date.now())) return
      inviteRef.current = { ...inv, used: true }
      setInvite(null)
      setInviteSecs(0)
      if (await checkInviteProof(inv.code, payload.nonce, payload.proof)) {
        const res = await buildInviteResponse(inv.code, credsRef.current.pin, payload.nonce)
        channel.send({ type: 'broadcast', event: 'invite-res', payload: res })
        setInviteNote(`${payload.name || 'A device'} joined via your invite.`)
      } else {
        channel.send({ type: 'broadcast', event: 'invite-res', payload: { nonce: payload.nonce, denied: true } })
        setInviteNote('An invite attempt failed; the code was used up.')
      }
    })
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sessions', filter: `code=eq.${code}` },
      (payload) => {
        if (payload.new?.config) setConfig(payload.new.config)
        const incoming = payload.new?.state
        if (!incoming) return
        // Ignore our own stale echo arriving after a newer optimistic write.
        if ((incoming.rev || 0) < (stateRef.current.rev || 0)) return
        stateRef.current = incoming
        setState(incoming)
      }
    )
    // Shared voice chips from other listening devices (signed by a PIN holder).
    channel.on('broadcast', { event: 'detect' }, async ({ payload }) => {
      if (!payload?.msg || !payload?.sig) return
      if (!(await verifyMsg(await getSigKey(), payload.msg, payload.sig))) return
      try {
        const data = JSON.parse(payload.msg)
        voiceRef.current?.addSharedChip?.(data.cand, data.from)
      } catch {
        /* ignore malformed */
      }
    })
    channel.on('presence', { event: 'sync' }, () => {
      const s = channel.presenceState()
      const entries = Object.values(s)
        .flat()
        .map((m) => ({ name: m.name || 'Someone', listening: !!m.listening }))
      setPresenceEntries(entries)
      setPresence(entries.map((e) => e.name))
      const curr = activeListeners(entries)
      const dropped = listenerDrops(prevListenersRef.current, curr)
      if (dropped.length) setListenerBanner(`Listener ${dropped.join(', ')} is no longer listening.`)
      if (curr.length) setListenerBanner('')
      prevListenersRef.current = curr
    })
    channelRef.current = channel
    channel.subscribe(async (st) => {
      setConnected(st === 'SUBSCRIBED')
      if (st === 'SUBSCRIBED') {
        await channel.track({ name: creds.name || 'Guest', at: Date.now(), listening: false })
      }
    })
    return () => channel.unsubscribe()
  }, [code, creds.name])

  // Push a patch to the shared state (server merges shallowly into state).
  // A monotonic `rev` lets every client discard stale realtime echoes.
  async function patchState(patch) {
    const fullPatch = { ...patch, rev: (stateRef.current.rev || 0) + 1 }
    const next = { ...stateRef.current, ...fullPatch }
    stateRef.current = next
    setState(next)
    try {
      await updateSession(code, creds.pin, { state: fullPatch })
      setStatus('')
    } catch (err) {
      setStatus(friendlyError(err))
    }
  }

  // Change the session translations (syncs to all) and re-resolve the shown
  // verse in place. On failure keep the old text and surface an error; never
  // blank the presenter over a translation switch.
  async function patchConfig(newConfig) {
    const prev = config
    setConfig(newConfig)
    try {
      await updateSession(code, creds.pin, { config: newConfig })
    } catch (err) {
      setConfig(prev)
      return setStatus(friendlyError(err))
    }
    savePrefs({ config: newConfig }) // remember translations for the next session
    await reresolveCurrent(newConfig.versions)
  }

  async function reresolveCurrent(newVersions) {
    const c = stateRef.current.current
    if (!c) return
    const rf = c.ref || parseReference(c.reference)
    if (!rf) return
    try {
      const results = await resolveItem(newVersions, rf)
      let next
      if (c.step) {
        next = stepCurrent(results, rf, 0)
      } else {
        next = wholeCurrent(results, rf)
        const pp = stateRef.current.display?.versesPerScreen || 0
        const oldPages = passagePages(c, pp)
        const firstIdx = oldPages[Math.min(c.page || 0, oldPages.length - 1)]?.[0] ?? 0
        const newPages = passagePages(next, pp)
        next.page = pageOfVerse(newPages, firstIdx)
        next.pageCount = newPages.length
      }
      await patchState({ current: next })
    } catch {
      setStatus('That translation would not load (check the network); keeping the current text.')
    }
  }

  const queue = state.queue || []
  const current = state.current || null
  const cursor = state.cursor || null // { queueId, verseIndex, adhoc?, savedPlan? } | null
  const history = state.history || []

  // Voice engine lives here (always alive) so its chips can render in a
  // persistent slot while the controls live in a tab.
  const voice = useVoice({
    versions,
    defaultLang: versions[0]?.language === 'ta' ? 'ta-IN' : 'en-US',
    onShow: showDetected,
    onDetect: broadcastDetect
  })
  voiceRef.current = voice

  // Advertise listening health in presence so others can see it / spot a drop.
  useEffect(() => {
    const ch = channelRef.current
    if (!ch) return
    ch.track({ name: creds.name || 'Guest', at: Date.now(), listening: listenerMode && voice.micState === 'listening' })
  }, [listenerMode, voice.micState, creds.name])

  function toggleListener(on) {
    setListenerMode(on)
    if (on && voice.micState !== 'listening') voice.start()
  }

  const otherListeners = activeListeners(presenceEntries).filter((n) => !(listenerMode && n === (creds.name || 'Guest')))

  // ---- available translations for the Display pickers ----
  const [allVersions, setAllVersions] = useState([])
  useEffect(() => {
    let cancel = false
    Promise.all([loadManifest().catch(() => ({ versions: [] })), loadHelloaoList()]).then(([m, online]) => {
      if (cancel) return
      const bundled = (m.versions || []).map((v) => ({ ...v, online: false }))
      const ids = new Set(bundled.map((v) => v.id))
      setAllVersions([...bundled, ...online.filter((v) => !ids.has(v.id))])
    })
    return () => {
      cancel = true
    }
  }, [])
  const bundledVersions = allVersions.filter((v) => !v.online)
  const onlineVersions = allVersions.filter((v) => v.online)
  const versionObj = (id) => {
    const v = allVersions.find((x) => x.id === id)
    return v ? { id: v.id, name: v.name, language: v.language, helloaoId: v.helloaoId || null } : null
  }
  function setPrimary(id) {
    const pv = versionObj(id)
    if (!pv) return
    const sec = versions[1] || null
    patchConfig({ ...config, versions: sec ? [pv, sec] : [pv] })
  }
  function setSecondary(id) {
    const pri = versions[0]
    if (!pri) return
    if (id === 'none') return patchConfig({ ...config, versions: [pri] })
    const sv = versionObj(id)
    patchConfig({ ...config, versions: sv ? [pri, sv] : [pri] })
  }

  // ---- presenter display (theme + font size), synced to all ----
  const display = state.display || {}
  const theme = display.theme || 'light'
  const fontScale = display.fontScale || 100
  const perPage = display.versesPerScreen || 0 // 0 = auto (by weight)
  // Read the freshest display from stateRef so rapid theme/font taps never
  // clobber each other with stale closure values.
  function displayBase() {
    const d = stateRef.current.display || {}
    return { theme: d.theme || 'light', fontScale: d.fontScale || 100, versesPerScreen: d.versesPerScreen || 0 }
  }
  function setTheme(t) {
    const next = { ...displayBase(), theme: t }
    savePrefs({ display: next })
    patchState({ display: next })
  }
  function nudgeFont(delta) {
    const cur = displayBase()
    const next = { ...cur, fontScale: Math.max(80, Math.min(140, cur.fontScale + delta)) }
    savePrefs({ display: next })
    patchState({ display: next })
  }
  // Live stepper values (2..12, then Auto=0 as the "most" end).
  const VPS_STEPS = [2, 4, 6, 8, 10, 12, 0]
  function stepPerPage(dir) {
    const i = VPS_STEPS.indexOf(display.versesPerScreen || 0)
    const j = Math.max(0, Math.min(VPS_STEPS.length - 1, i + dir))
    setVersesPerScreen(VPS_STEPS[j])
  }
  // Manual verses-per-screen for whole passages. Remap the current page to keep
  // the shown verse visible, and update both display + the passage atomically.
  function setVersesPerScreen(n) {
    const st = stateRef.current
    const next = { ...displayBase(), versesPerScreen: n || 0 }
    savePrefs({ display: next })
    const c = st.current
    if (c && !c.step) {
      const oldPages = passagePages(c, st.display?.versesPerScreen || 0)
      const firstIdx = oldPages[Math.min(c.page || 0, oldPages.length - 1)]?.[0] ?? 0
      const newPages = passagePages(c, n || 0)
      patchState({ display: next, current: { ...c, page: pageOfVerse(newPages, firstIdx), pageCount: newPages.length } })
    } else {
      patchState({ display: next })
    }
  }

  const itemById = (id) => queue.find((q) => q.id === id) || null

  // Per-chapter verse counts for the primary version (ad-hoc stepping bounds +
  // chapter/verse type-ahead). Reloads when the primary translation changes; a
  // bundled WEB copy is kept as a fallback so type-ahead still works when the
  // primary is online-only or lacks a book.
  const structureRef = useRef(null)
  const fallbackStructRef = useRef(null)
  const primaryId = versions[0]?.id
  useEffect(() => {
    loadStructure(primaryId)
      .then((s) => (structureRef.current = s || {}))
      .catch(() => (structureRef.current = {}))
  }, [primaryId])
  useEffect(() => {
    loadStructure('eng-web')
      .then((s) => (fallbackStructRef.current = s || {}))
      .catch(() => (fallbackStructRef.current = {}))
  }, [])
  function structOf(bookId) {
    const s = structureRef.current
    if (s && s[bookId] && s[bookId].length) return s[bookId]
    const f = fallbackStructRef.current
    return f && f[bookId] ? f[bookId] : null
  }
  function chapterCount(bookId, chapter) {
    const arr = structOf(bookId)
    return arr ? arr[chapter - 1] || 0 : 0
  }
  const chaptersOf = (bookId) => structOf(bookId)?.length || 0
  const versesOf = (bookId, chapter) => structOf(bookId)?.[chapter - 1] || 0

  // ---- reference input + preview ----
  const [input, setInput] = useState('')
  const refInputRef = useRef(null)
  const debounced = useDebounced(input, 300)
  const parsed = useMemo(() => parseReference(debounced), [debounced])
  // Type-ahead in three stages: book -> chapter -> verse. `partial` reads the
  // in-progress reference; a book is "settled" once a chapter digit exists or the
  // input ends with a space after a recognized book.
  const partial = useMemo(() => parsePartialRef(input), [input])
  const endsWithSpace = /\s$/.test(input)
  const bookSettled = !!(partial && partial.book && (partial.chapter != null || endsWithSpace))

  const bookHits = useMemo(() => {
    if (bookSettled) return []
    const t = input.trim()
    if (!t) return []
    const afterOrdinal = t.replace(/^\s*(iii|ii|i|1|2|3|first|second|third)\s+/i, '')
    if (/\d/.test(afterOrdinal)) return [] // already onto chapter/verse
    return searchBooks(t, 6)
  }, [bookSettled, input])

  // Chapter suggestions once the book is settled but no chapter is chosen.
  const chapterChips = useMemo(() => {
    if (!bookSettled || !partial || partial.chapter != null) return null
    const n = chaptersOf(partial.book.id)
    return n > 1 ? { book: partial.book, count: n } : null
  }, [bookSettled, partial])

  // Verse suggestions once a chapter is present but no verse is chosen.
  const verseChips = useMemo(() => {
    if (!partial || !partial.book || partial.chapter == null || partial.verse != null) return null
    const n = versesOf(partial.book.id, partial.chapter)
    return n > 1 ? { book: partial.book, chapter: partial.chapter, count: n } : null
  }, [partial])

  function fillRef(val, focus = true) {
    setInput(val)
    if (!focus) return
    requestAnimationFrame(() => {
      const el = refInputRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(val.length, val.length)
      }
    })
  }
  const pickBook = (b) => fillRef(`${b.name} `)
  const pickChapter = (n) => fillRef(`${chapterChips.book.name} ${n}:`)
  const pickVerse = (n) => fillRef(`${verseChips.book.name} ${verseChips.chapter}:${n}`)
  // When a typed phrase is not a reference, offer named-passage aliases
  // ("the prodigal son" -> Luke 15:11-32). Flatten multi-ref entries to one
  // suggestion per reference; never auto-pick among them.
  const aliasHits = useMemo(() => {
    if (parsed || !debounced.trim()) return []
    return matchAliases(debounced).flatMap((h) => h.refs.map((ref) => ({ name: h.name, ref })))
  }, [parsed, debounced])
  const [preview, setPreview] = useState(null)
  const [previewErr, setPreviewErr] = useState('')
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!parsed) {
      setPreview(null)
      setPreviewErr(debounced.trim() ? 'Could not read that reference.' : '')
      return
    }
    setPreviewing(true)
    setPreviewErr('')
    resolveCurrent(versions, parsed)
      .then((c) => !cancelled && setPreview(c))
      .catch((e) => !cancelled && (setPreview(null), setPreviewErr(e.message)))
      .finally(() => !cancelled && setPreviewing(false))
    return () => {
      cancelled = true
    }
  }, [parsed, debounced])

  // Resolve the verses of the item currently being shown, for the jump list.
  const [curResults, setCurResults] = useState(null)
  useEffect(() => {
    let cancelled = false
    const id = cursor?.queueId
    const item = id ? itemById(id) : null
    const p = item ? parseReference(item.input) : null
    if (!p) {
      setCurResults(null)
      return
    }
    resolveItem(versions, p)
      .then((r) => !cancelled && setCurResults({ id, results: r }))
      .catch(() => !cancelled && setCurResults(null))
    return () => {
      cancelled = true
    }
  }, [cursor?.queueId, queue, versions])

  // ---- boundary hint (this controller only, never touches the presenter) ----
  const [hint, setHint] = useState('')
  const hintTimer = useRef(null)
  function flash(kind) {
    setHint(kind)
    clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setHint(''), 2500)
  }

  // ---- showing helpers ----
  // Every show goes through here so it lands on the presenter and is logged.
  async function commitShow(currentObj, cursorObj, source) {
    const history = appendHistory(stateRef.current.history || [], {
      ref: currentObj.reference,
      at: Date.now(),
      source
    })
    await patchState({ current: currentObj, cursor: cursorObj, blank: false, history })
  }

  async function showItemAtVerse(item, verseIndex) {
    const p = parseReference(item.input)
    if (!p) return setStatus('That queue item could not be read.')
    try {
      const results = await resolveItem(versions, p)
      const c = stepCurrent(results, p, verseIndex)
      await commitShow(c, { queueId: item.id, verseIndex: c.verseIndex ?? null }, 'queue')
    } catch (e) {
      setStatus(e.message)
    }
  }

  async function showItemWhole(item) {
    const p = parseReference(item.input)
    if (!p) return setStatus('That queue item could not be read.')
    try {
      const results = await resolveItem(versions, p)
      await commitShow(wholeCurrent(results, p), { queueId: item.id, verseIndex: null }, 'queue')
    } catch (e) {
      setStatus(e.message)
    }
  }

  function enterItemStart(item) {
    return item.whole ? showItemWhole(item) : showItemAtVerse(item, 0)
  }

  async function enterItemEnd(item) {
    if (item.whole) {
      const p = parseReference(item.input)
      if (!p) return setStatus('That queue item could not be read.')
      try {
        const results = await resolveItem(versions, p)
        const c = wholeCurrent(results, p)
        const pages = passagePages(c, perPage)
        c.pageCount = pages.length
        c.page = Math.max(0, pages.length - 1)
        return commitShow(c, { queueId: item.id, verseIndex: null }, 'queue')
      } catch (e) {
        return setStatus(e.message)
      }
    }
    const p = parseReference(item.input)
    if (!p) return setStatus('That queue item could not be read.')
    try {
      const results = await resolveItem(versions, p)
      const last = Math.max(0, verseCount(results) - 1)
      const c = stepCurrent(results, p, last)
      await commitShow(c, { queueId: item.id, verseIndex: c.verseIndex ?? null }, 'queue')
    } catch (e) {
      setStatus(e.message)
    }
  }

  async function countOf(item) {
    const p = parseReference(item.input)
    if (!p) return 0
    try {
      return verseCount(await resolveItem(versions, p))
    } catch {
      return 0
    }
  }

  // Ad-hoc show (Show now / voice). Sets an ad-hoc cursor so Back/Next continue
  // stepping through the chapter, and preserves any active plan position so the
  // operator can return to it.
  async function showAdhoc(ref, source) {
    try {
      const results = await resolveItem(versions, ref)
      const cur = stateRef.current.cursor || null
      const savedPlan =
        cur && cur.queueId != null
          ? { queueId: cur.queueId, verseIndex: cur.verseIndex ?? null }
          : cur?.savedPlan || null
      const count = chapterCount(ref.bookId, ref.chapter) || verseCount(results)
      const first = ref.verseStart || 1
      const last = ref.verseEnd || ref.verseStart || count
      const cursorNext = {
        queueId: null,
        verseIndex: null,
        adhoc: { bookId: ref.bookId, chapter: ref.chapter, first, last, count },
        savedPlan
      }
      await commitShow(wholeCurrent(results, ref), cursorNext, source)
    } catch (e) {
      setStatus(e.message)
    }
  }

  function showNow() {
    if (!parsed) return
    return showAdhoc(parsed, 'manual')
  }

  // Show a reference detected by voice. A single-verse detection has verseEnd
  // null; getPassage treats that as "to end of chapter", so pin it first. A
  // cross-chapter detection carries endChapter (null verseEnd = whole end chapter).
  function showDetected(cand, source = 'voice') {
    const endChapter = cand.endChapter ?? cand.chapter
    const singleChapter = endChapter === cand.chapter
    const ref = {
      bookId: cand.bookId,
      bookName: cand.bookName,
      chapter: cand.chapter,
      verseStart: cand.verseStart,
      endChapter,
      verseEnd:
        singleChapter && cand.verseStart != null && cand.verseEnd == null ? cand.verseStart : cand.verseEnd
    }
    return showAdhoc(ref, source)
  }

  // Step to a single verse within an ad-hoc chapter, keeping the saved plan.
  async function showAdhocVerse(adhoc, verse) {
    const ref = { bookId: adhoc.bookId, chapter: adhoc.chapter, verseStart: verse, verseEnd: verse }
    try {
      const results = await resolveItem(versions, ref)
      const c = stepCurrent(results, ref, 0)
      const cursorNext = {
        queueId: null,
        verseIndex: null,
        adhoc: { ...adhoc, first: verse, last: verse },
        savedPlan: stateRef.current.cursor?.savedPlan || null
      }
      await commitShow(c, cursorNext, 'manual')
    } catch (e) {
      setStatus(e.message)
    }
  }

  async function backToPlan() {
    const saved = stateRef.current.cursor?.savedPlan
    if (!saved) return
    const item = itemById(saved.queueId)
    if (!item) return setStatus('That plan item is no longer in the queue.')
    if (saved.verseIndex != null) await showItemAtVerse(item, saved.verseIndex)
    else await showItemWhole(item)
  }

  // Re-show a history entry (goes through the normal show path, so it re-logs).
  function reShow(entry) {
    const p = parseReference(entry.ref)
    if (!p) return setStatus('Could not re-read that reference.')
    return showAdhoc(p, 'manual')
  }

  function fmtTime(at) {
    try {
      return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  // ---- session panel (share links, leave) ----
  function linkFor(route) {
    return `${window.location.origin}${window.location.pathname}#/${route}?s=${code}`
  }
  async function copyLink(route) {
    try {
      await navigator.clipboard.writeText(linkFor(route))
      setCopied(route)
      setTimeout(() => setCopied(''), 1500)
    } catch {
      setCopied('')
    }
  }
  function leaveSession() {
    clearCreds()
    window.location.hash = '#/'
  }

  // Creator only: apply this device's remembered theme/font to the fresh session
  // (translations were already applied via the remembered config at creation).
  useEffect(() => {
    if (!creds.creator) return
    const d = loadPrefs().display
    if (d && (d.theme !== 'light' || d.fontScale !== 100)) patchState({ display: d })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function revealPin() {
    setPinReveal(true)
    setTimeout(() => setPinReveal(false), 4000)
  }

  function startInvite() {
    const inv = { code: makeInviteCode(), expiresAt: Date.now() + 60000, used: false }
    inviteRef.current = inv
    setInviteNote('')
    setInvite(inv)
    setInviteSecs(60)
  }
  useEffect(() => {
    if (!invite) return
    const t = setInterval(() => {
      const left = Math.ceil((inviteRef.current.expiresAt - Date.now()) / 1000)
      if (left <= 0 || inviteRef.current.used) {
        inviteRef.current = null
        setInvite(null)
        setInviteSecs(0)
      } else {
        setInviteSecs(left)
      }
    }, 500)
    return () => clearInterval(t)
  }, [invite])

  // ---- Back / Next navigation ----
  async function goNext() {
    const st = stateRef.current
    const q = st.queue || []
    const cur = st.cursor || null
    const c = st.current
    // Paginated whole passage: page forward before leaving the passage.
    if (c && !c.step) {
      const pageCount = passagePages(c, st.display?.versesPerScreen || 0).length
      if (pageCount > 1 && (c.page || 0) < pageCount - 1) {
        return patchState({ current: { ...c, page: (c.page || 0) + 1 } })
      }
    }
    // Ad-hoc stepping: continue through the chapter.
    if (cur && cur.adhoc) {
      const a = cur.adhoc
      const cnt = chapterCount(a.bookId, a.chapter) || a.count
      if (a.last + 1 <= cnt) return showAdhocVerse({ ...a, count: cnt }, a.last + 1)
      return flash('chapter-end')
    }
    if (!st.current) {
      if (q.length) return enterItemStart(q[0])
      return
    }
    if (!cur || cur.queueId == null) {
      if (q.length) return enterItemStart(q[0])
      return flash('end')
    }
    const i = q.findIndex((x) => x.id === cur.queueId)
    if (i === -1) {
      if (q.length) return enterItemStart(q[0])
      return flash('end')
    }
    const item = q[i]
    if (!item.whole && cur.verseIndex != null) {
      const count = await countOf(item)
      if (cur.verseIndex < count - 1) return showItemAtVerse(item, cur.verseIndex + 1)
    }
    if (i < q.length - 1) return enterItemStart(q[i + 1])
    return flash('end')
  }

  async function goBack() {
    const st = stateRef.current
    const q = st.queue || []
    const cur = st.cursor || null
    const c = st.current
    // Paginated whole passage: page backward before leaving the passage.
    if (c && !c.step && (c.page || 0) > 0) {
      return patchState({ current: { ...c, page: c.page - 1 } })
    }
    if (cur && cur.adhoc) {
      const a = cur.adhoc
      if (a.first - 1 >= 1) return showAdhocVerse(a, a.first - 1)
      return flash('chapter-start')
    }
    if (!st.current || !cur || cur.queueId == null) return flash('start')
    const i = q.findIndex((x) => x.id === cur.queueId)
    if (i === -1) return flash('start')
    const item = q[i]
    if (!item.whole && cur.verseIndex != null && cur.verseIndex > 0) {
      return showItemAtVerse(item, cur.verseIndex - 1)
    }
    if (i > 0) return enterItemEnd(q[i - 1])
    return flash('start')
  }

  function toggleBlank() {
    patchState({ blank: !state.blank })
  }

  // ---- queue editing ----
  function addToQueue() {
    if (!parsed) return
    const item = { id: crypto.randomUUID(), input: debounced.trim(), label: formatLabel(parsed), whole: false }
    patchState({ queue: [...queue, item] })
    setInput('')
    setPreview(null)
  }

  function removeItem(id) {
    patchState({ queue: queue.filter((q) => q.id !== id) })
  }

  // Operator-only note on a plan item (never shown on the big screen).
  function setItemNote(id, note) {
    const q = (stateRef.current.queue || []).map((x) => (x.id === id ? { ...x, note: note.trim() || undefined } : x))
    patchState({ queue: q })
  }

  // Paste a pastor's note and add every reference it contains, in order.
  const [planText, setPlanText] = useState('')
  function addPlanFromText() {
    const refs = extractReferences(planText)
    if (!refs.length) return setStatus('No references found in that note.')
    const items = refs.map((r) => ({ id: crypto.randomUUID(), input: r.input, label: r.label, whole: false }))
    patchState({ queue: [...(stateRef.current.queue || []), ...items] })
    setPlanText('')
    setStatus(`Added ${items.length} passage${items.length === 1 ? '' : 's'} to the plan.`)
  }

  function move(index, delta) {
    const next = [...queue]
    const j = index + delta
    if (j < 0 || j >= next.length) return
    ;[next[index], next[j]] = [next[j], next[index]]
    patchState({ queue: next })
  }

  async function toggleWhole(item) {
    const updated = { ...item, whole: !item.whole }
    await patchState({ queue: queue.map((q) => (q.id === item.id ? updated : q)) })
    if (cursor?.queueId === item.id) {
      if (updated.whole) await showItemWhole(updated)
      else await showItemAtVerse(updated, 0)
    }
  }

  // ---- import / export ----
  const fileRef = useRef(null)
  function exportQueue() {
    const data = {
      openlectern: 'queue',
      version: 1,
      items: queue.map((q) => ({ input: q.input, label: q.label, whole: !!q.whole, note: q.note || undefined })),
      history: history.map((e) => ({ ref: e.ref, at: e.at, source: e.source }))
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `openlectern-queue-${code}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function importQueue(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result)
        const items = (data.items || [])
          .map((it) => {
            const p = parseReference(it.input || it.label || '')
            if (!p) return null
            return { id: crypto.randomUUID(), input: it.input || it.label, label: formatLabel(p), whole: !!it.whole, note: it.note || undefined }
          })
          .filter(Boolean)
        if (!items.length) return setStatus('No readable references in that file.')
        patchState({ queue: [...queue, ...items] })
      } catch {
        setStatus('That file is not a valid queue export.')
      }
    }
    reader.readAsText(file)
  }

  // ---- derived UI bits ----
  const activeItem = cursor?.queueId ? itemById(cursor.queueId) : null
  const stepping = activeItem && !activeItem.whole && cursor?.verseIndex != null
  const stepResults = curResults && curResults.id === cursor?.queueId ? curResults.results : null
  const stepTotal = stepResults ? verseCount(stepResults) : 0

  const inQueue = cursor?.queueId != null
  const lastSource = history[0]?.source
  const modeLabel = inQueue ? 'queue' : cursor?.adhoc ? (lastSource === 'voice' ? 'voice' : lastSource === 'auto' ? 'auto' : 'ad-hoc') : ''
  const firstLine = current?.primary?.verses?.[0]?.text || ''
  const firstLineShort = firstLine.length > 90 ? firstLine.slice(0, 90).trim() + '...' : firstLine
  const adminCount = presence.length || 1

  // Paginated whole passage (for the Now card page indicator + verse jump).
  // Pages are computed live from the current verses-per-screen setting.
  const allWholePages = current && !current.step ? passagePages(current, perPage) : null
  const pagedWhole = !!allWholePages && allWholePages.length > 1
  const pagedPages = pagedWhole ? allWholePages : null
  const curPage = pagedWhole ? Math.min(current.page || 0, pagedPages.length - 1) : 0
  function jumpToVersePage(k) {
    const cc = stateRef.current.current
    if (!cc) return
    patchState({ current: { ...cc, page: pageOfVerse(passagePages(cc, perPage), k) } })
  }

  // ---- related verses (cross-references, openbible.info CC-BY) ----
  // Anchor is the current verse in step mode, the passage's first verse in whole
  // mode -- current.ref.verseStart is exactly that in both cases.
  const relatedAnchor = useMemo(() => {
    if (!current) return null
    const r = current.ref || parseReference(current.reference)
    if (!r || !r.bookId) return null
    return { bookId: r.bookId, chapter: r.chapter, verse: r.verseStart || 1 }
  }, [current])
  const relatedKey = relatedAnchor ? `${relatedAnchor.bookId}:${relatedAnchor.chapter}:${relatedAnchor.verse}` : ''
  const [relatedOpen, setRelatedOpen] = useState(false)
  const [related, setRelated] = useState([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  // Collapse and forget whenever the shown verse changes (remembers nothing).
  useEffect(() => {
    setRelatedOpen(false)
    setRelated([])
  }, [relatedKey])
  async function openRelated() {
    setRelatedOpen(true)
    if (!relatedAnchor || related.length) return
    setRelatedLoading(true)
    try {
      const chunk = await loadXrefBook(relatedAnchor.bookId)
      const refs = lookupXrefs(chunk, relatedAnchor.chapter, relatedAnchor.verse)
      const items = refs.map((ref) => ({ ref, parsed: parseReference(ref) })).filter((x) => x.parsed)
      const withPreview = await Promise.all(
        items.map(async (x) => ({ ...x, preview: await resolvePreviewText(versions, x.parsed) }))
      )
      setRelated(withPreview)
    } finally {
      setRelatedLoading(false)
    }
  }

  if (listenerMode) {
    return <ListenerView v={voice} name={creds.name} code={code} onExit={() => toggleListener(false)} />
  }

  const micLabel = voice.micState === 'listening' ? 'Listening' : voice.micState === 'error' ? 'Mic error' : 'Voice off'

  return (
    <div className="console">
      {/* TOP BAR: identity + voice (always visible) + tools */}
      <header className="topbar">
        <div className="tb-brand">
          <b>OpenLectern</b>
          <span className="tb-code">{code}</span>
          <span className={`tb-live${connected ? ' on' : ''}`}>
            <span className="live-dot" />
            {connected ? 'live' : 'connecting'}
          </span>
        </div>

        <div className={`voicebar mic-${voice.micState}${voice.active ? ' listening' : ''}`}>
          <span className="vb-status"><span className="vb-ring" aria-hidden="true"><i /></span>{micLabel}</span>
          {voice.supported ? (
            <>
              <button className="btn small vb-toggle" onClick={voice.toggle} aria-pressed={voice.active}>
                {voice.active ? 'Stop' : 'Start listening'}
              </button>
              <span className="vb-sep" aria-hidden="true" />
              <label className="vb-auto">
                <input type="checkbox" checked={voice.auto} onChange={(e) => voice.setAuto(e.target.checked)} />
                Auto
              </label>
              <select className="vb-lang" value={voice.lang} onChange={(e) => voice.changeLang(e.target.value)} aria-label="Recognition language">
                {voice.langs.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </>
          ) : (
            <span className="muted vb-unsupported">Voice needs Chrome or Edge</span>
          )}
        </div>

        <div className="tb-tools">
          <span className="tb-admins">{adminCount} {adminCount === 1 ? 'admin' : 'admins'}</span>
          <button className="btn small ghost" onClick={() => toggleListener(true)}>Listener mode</button>
          <button className="iconbtn" title="Settings and sharing" aria-label="Settings and sharing" onClick={() => setPanelOpen(true)}>
            <span aria-hidden="true">⚙</span>
          </button>
        </div>
      </header>

      {voice.error && <p className="voice-err">{voice.error}</p>}
      {status && <p className="error console-status">{status}</p>}

      <div className="console-body">
        {/* LEFT RAIL: one live activity feed (voice, shared, quote, related, history, listeners) */}
        <aside className="activity">
          <div className="activity-head">
            <h2>Activity</h2>
            <span className={`activity-sub${voice.active ? ' on' : ''}`}>{voice.active ? 'listening' : 'idle'}</span>
          </div>
          <div className="feed">
            {voice.micState === 'listening' && (
              <div className="feed-listening"><span className="fl-dot" />{voice.transcript || 'Listening for a reference...'}</div>
            )}
            {listenerBanner && <div className="feed-alert">{listenerBanner}</div>}
            {otherListeners.length > 0 && (
              <div className="feed-note"><span className="who">Listening:</span> {otherListeners.join(', ')}</div>
            )}
            {voice.chips.map((chip) => (
              <button key={chip.key} className={`feed-card${chip.shown ? ' shown' : ''}`} onClick={() => voice.tapChip(chip)}>
                <span className="fc-row">
                  {chip.quote && <span className="badge quote">quote</span>}
                  {chip.auto && <span className="badge auto">auto</span>}
                  <span className="fc-ref">{chip.ref}</span>
                  {chip.from && <span className="fc-from">{chip.from}</span>}
                </span>
                {chip.text && <span className="fc-prev">{chip.text}</span>}
              </button>
            ))}
            {(voice.chips.length > 0 || history.length > 0) && <div className="feed-divider">Shown earlier</div>}
            {history.map((e, i) => (
              <button className="feed-hist" key={i} onClick={() => reShow(e)}>
                <span className="fh-ref">{e.ref}</span>
                {e.source === 'auto' && <span className="badge auto">auto</span>}
                <span className="fh-time">{fmtTime(e.at)}</span>
              </button>
            ))}
            {voice.chips.length === 0 && history.length === 0 && (
              <p className="feed-empty muted">
                Detected references, quotes, and shown verses appear here. Tap any to put it on the screen.
              </p>
            )}
            {voice.supported && (
              <p className="feed-foot muted">Quote-catch matches the loaded translations wording (e.g. WEB); a verse remembered in another wording may not match.</p>
            )}
          </div>
        </aside>

        {/* MAIN: Now + Find + Plan */}
        <main className="console-main">
          {showHint && (
            <div className="first-hint">
              <button
                className="first-hint-body"
                onClick={() => {
                  setPanelOpen(true)
                  dismissHint()
                }}
              >
                Your code, QR and PIN live under the gear. Open the screen on the big display from there too.
              </button>
              <button className="first-hint-x" aria-label="Dismiss" onClick={dismissHint}>Got it</button>
            </div>
          )}

          <section className="now-card" aria-live="polite">
          {state.blank ? (
            <div className="now-blank">Screen is blank</div>
          ) : current ? (
            <>
              <div className="now-top">
                <div className="now-ref">{current.reference}</div>
                <div className="now-mode">
                  {pagedWhole ? (
                    <span className="now-pos">{curPage + 1} / {pagedPages.length}</span>
                  ) : inQueue && stepping && stepTotal ? (
                    <span className="now-pos">{cursor.verseIndex + 1} / {stepTotal}</span>
                  ) : null}
                  {modeLabel && <span className={`mode-pill mp-${modeLabel}`}>{modeLabel}</span>}
                </div>
              </div>
              {firstLineShort && <div className="now-line">{firstLineShort}</div>}
              {stepping && stepResults && (
                <div className="verse-chips scroll-x">
                  {stepResults[0].verses.map((v, k) => (
                    <button
                      key={v.c ? `${v.c}:${v.n}` : v.n}
                      className={`vchip${k === cursor.verseIndex ? ' on' : ''}`}
                      aria-label={`Show verse ${v.label ?? v.n}`}
                      onClick={() => showItemAtVerse(activeItem, k)}
                    >
                      {v.label ?? v.n}
                    </button>
                  ))}
                </div>
              )}
              {pagedWhole && (
                <div className="verse-chips scroll-x">
                  {current.primary.verses.map((v, k) => (
                    <button
                      key={v.c ? `${v.c}:${v.n}` : v.n}
                      className={`vchip${pagedPages[curPage].includes(k) ? ' on' : ''}`}
                      aria-label={`Go to verse ${v.label ?? v.n}`}
                      onClick={() => jumpToVersePage(k)}
                    >
                      {v.label ?? v.n}
                    </button>
                  ))}
                </div>
              )}
              {current && !current.step && (current.primary?.verses?.length || 0) > 2 && (
                <div className="vps-live">
                  <span className="vps-live-label">Per screen</span>
                  <button className="icon-btn" aria-label="Fewer verses per screen" onClick={() => stepPerPage(-1)}>-</button>
                  <span className="vps-live-val">{perPage ? perPage : 'Auto'}</span>
                  <button className="icon-btn" aria-label="More verses per screen" onClick={() => stepPerPage(1)}>+</button>
                </div>
              )}
              {cursor?.savedPlan && (
                <button className="btn small back-to-plan" onClick={backToPlan}>Back to plan</button>
              )}
              {relatedAnchor && (
                <div className="related">
                  <button
                    className="related-toggle"
                    aria-expanded={relatedOpen}
                    onClick={() => (relatedOpen ? setRelatedOpen(false) : openRelated())}
                  >
                    {relatedOpen ? 'Hide related' : 'Related'}
                  </button>
                  {relatedOpen && (
                    <div className="related-list">
                      {relatedLoading && <p className="muted related-note">Loading...</p>}
                      {!relatedLoading && !related.length && (
                        <p className="muted related-note">No cross-references for this verse.</p>
                      )}
                      {related.map((x) => (
                        <button key={x.ref} className="related-chip" onClick={() => showAdhoc(x.parsed, 'related')}>
                          <span className="related-ref">{x.ref}</span>
                          {x.preview && <span className="related-preview">{x.preview}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="now-empty">Nothing on screen yet</div>
          )}
        </section>

        <section className="panel-card">
          <h3 className="card-h">Find a passage</h3>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="ref">Reference</label>
                <input
                  id="ref"
                  ref={refInputRef}
                  type="text"
                  autoComplete="off"
                  enterKeyHint="send"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && parsed && !previewing) {
                      e.preventDefault()
                      showNow()
                    }
                  }}
                  placeholder="Type a book, e.g. John"
                />
              </div>
              {bookHits.length > 0 && (
                <div className="book-hints scroll-x">
                  {bookHits.map((b) => (
                    <button key={b.id} className="book-hint" onClick={() => pickBook(b)}>
                      {b.name}
                    </button>
                  ))}
                </div>
              )}
              {chapterChips && (
                <div className="numpick">
                  <span className="numpick-label">{chapterChips.book.name} · chapter</span>
                  <div className="numpick-row scroll-x">
                    {Array.from({ length: chapterChips.count }, (_, i) => i + 1).map((n) => (
                      <button key={n} className="numchip" onClick={() => pickChapter(n)}>{n}</button>
                    ))}
                  </div>
                </div>
              )}
              {verseChips && (
                <div className="numpick">
                  <span className="numpick-label">{verseChips.book.name} {verseChips.chapter} · verse</span>
                  <div className="numpick-row scroll-x">
                    {Array.from({ length: verseChips.count }, (_, i) => i + 1).map((n) => (
                      <button key={n} className="numchip" onClick={() => pickVerse(n)}>{n}</button>
                    ))}
                  </div>
                </div>
              )}
              {aliasHits.length > 0 && (
                <div className="alias-suggest">
                  <p className="muted alias-hint">Did you mean...</p>
                  {aliasHits.map((h, i) => (
                    <button
                      key={`${h.name}-${h.ref}-${i}`}
                      className="alias-chip"
                      onClick={() => setInput(h.ref)}
                    >
                      <span className="alias-name">{h.name}</span>
                      <span className="alias-ref">{h.ref}</span>
                    </button>
                  ))}
                </div>
              )}
              {previewErr && aliasHits.length === 0 && bookHits.length === 0 && !chapterChips && !verseChips && <p className="error">{previewErr}</p>}
              {preview && (
                <div className="preview">
                  <div className="ref">{preview.reference}</div>
                  <div className="primary" lang={preview.primary?.language}>
                    {preview.primary?.verses.map((v) => (
                      <span key={v.n}>
                        <sup>{v.n}</sup> {v.text}{' '}
                      </span>
                    ))}
                  </div>
                  {preview.secondary && (
                    <div className="secondary" lang={preview.secondary.language}>
                      {preview.secondary.verses.map((v) => (
                        <span key={v.n}>
                          <sup>{v.n}</sup> {v.text}{' '}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="toolbar" style={{ marginTop: '0.6rem' }}>
                <button className="btn primary" onClick={showNow} disabled={!parsed || previewing}>
                  Show now
                </button>
                <button className="btn" onClick={addToQueue} disabled={!parsed}>
                  Add to queue
                </button>
              </div>
        </section>

        <section className="panel-card">
          <h3 className="card-h">Plan ({queue.length})</h3>
              <div className="queue">
                {queue.map((item, i) => {
                  const active = cursor?.queueId === item.id
                  return (
                    <div className={`queue-item-wrap${active ? ' active' : ''}`} key={item.id}>
                      <div className="queue-item">
                        <button className="icon-btn" aria-label="Move up" onClick={() => move(i, -1)}>up</button>
                        <button className="icon-btn" aria-label="Move down" onClick={() => move(i, 1)}>dn</button>
                        <span className="label">{item.label}</span>
                        <button
                          className={`icon-btn mode${item.whole ? '' : ' on'}`}
                          aria-label={item.whole ? 'Showing whole passage, tap to step' : 'Stepping verse by verse, tap for whole'}
                          onClick={() => toggleWhole(item)}
                        >
                          {item.whole ? 'Whole' : 'Step'}
                        </button>
                        <button className="icon-btn" aria-label={`Show ${item.label}`} onClick={() => enterItemStart(item)}>Show</button>
                        <button className="icon-btn" aria-label={`Remove ${item.label}`} onClick={() => removeItem(item.id)}>x</button>
                      </div>
                      <input
                        className="queue-note"
                        type="text"
                        defaultValue={item.note || ''}
                        placeholder="Add a note (e.g. sermon intro) - not shown on screen"
                        aria-label={`Note for ${item.label}`}
                        onBlur={(e) => {
                          if ((e.target.value.trim() || '') !== (item.note || '')) setItemNote(item.id, e.target.value)
                        }}
                      />
                    </div>
                  )
                })}
                {!queue.length && <p className="muted">Nothing queued yet.</p>}
              </div>

              <div className="section-title" style={{ marginTop: '1rem' }}>Paste a plan</div>
              <textarea
                className="plan-paste"
                rows={3}
                value={planText}
                onChange={(e) => setPlanText(e.target.value)}
                placeholder="Paste the pastor's note, e.g. Psalm 100, John 3:16-21, then Romans 8:28-30"
                aria-label="Paste a plan"
              />
              <div className="toolbar" style={{ marginTop: '0.5rem' }}>
                <button className="btn primary" onClick={addPlanFromText} disabled={!planText.trim()}>Add all to plan</button>
              </div>

              <div className="toolbar" style={{ marginTop: '0.9rem' }}>
                <button className="btn" onClick={exportQueue} disabled={!queue.length && !history.length}>Export</button>
                <button className="btn" onClick={() => fileRef.current?.click()}>Import</button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onChange={importQueue}
                />
              </div>
        </section>
        </main>
      </div>

      {hint && (
        <div className="plan-hint">
          {hint === 'end'
            ? 'End of plan'
            : hint === 'start'
              ? 'Start of plan'
              : hint === 'chapter-end'
                ? 'End of chapter'
                : 'Start of chapter'}
        </div>
      )}

      <nav className="transport">
        <button className="btn transport-btn" onClick={goBack} aria-label="Previous verse">Back</button>
        <button
          className={`btn transport-btn blank${state.blank ? ' on' : ''}`}
          onClick={toggleBlank}
          aria-pressed={state.blank}
        >
          {state.blank ? 'Unblank' : 'Blank'}
        </button>
        <button className="btn transport-btn primary next" onClick={goNext} aria-label="Next verse">Next</button>
      </nav>

      {panelOpen && (
        <div className="settings-scrim" role="dialog" aria-label="Screen settings" onClick={() => setPanelOpen(false)}>
          <div className="settings-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="settings-head">
              <h2>Screen settings</h2>
              <button className="btn small" onClick={() => setPanelOpen(false)}>Done</button>
            </div>
            <div className="settings-grid">
              <div className="scard share">
                <button className="sp-qr" aria-label="Enlarge the QR code" title="Tap to enlarge" onClick={() => setQrBig(true)}>
                  <Qr text={linkFor('present')} size={116} />
                </button>
                <div className="share-body">
                  <div className="share-code">{code}</div>
                  <p className="muted">Scan to watch, or share a link. Controllers also need the PIN.</p>
                  <div className="share-btns">
                    <button className="btn small" onClick={() => copyLink('present')}>{copied === 'present' ? 'Copied' : 'Copy watch link'}</button>
                    <button className="btn small" onClick={() => copyLink('control')}>{copied === 'control' ? 'Copied' : 'Copy control link'}</button>
                    {pinReveal ? (
                      <span className="pin-reveal" role="status">PIN {creds.pin}</span>
                    ) : (
                      <button className="btn small" onClick={revealPin}>Show PIN</button>
                    )}
                    {invite ? (
                      <span className="invite-live">Invite <strong>{invite.code}</strong> ({inviteSecs}s)</span>
                    ) : (
                      <button className="btn small" onClick={startInvite}>Invite device</button>
                    )}
                  </div>
                  {inviteNote && <p className="muted" style={{ margin: 0 }}>{inviteNote}</p>}
                  <a className="link-btn" href={`#/present?s=${code}`} target="_blank" rel="noopener">Open the screen (new tab)</a>
                </div>
              </div>

              <div className="scard scard-wide">
                <div className="section-title">Translations</div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="primary-v">Primary</label>
                <select id="primary-v" value={versions[0]?.id || ''} onChange={(e) => setPrimary(e.target.value)}>
                  <optgroup label="Bundled">
                    {bundledVersions.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </optgroup>
                  {onlineVersions.length > 0 && (
                    <optgroup label="Online (needs internet)">
                      {onlineVersions.map((v) => (
                        <option key={v.id} value={v.id}>{v.name} ({v.languageName || v.language})</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <div className="field" style={{ marginTop: '0.6rem' }}>
                <label htmlFor="secondary-v">Secondary</label>
                <select id="secondary-v" value={versions[1]?.id || 'none'} onChange={(e) => setSecondary(e.target.value)}>
                  <option value="none">None</option>
                  <optgroup label="Bundled">
                    {bundledVersions.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </optgroup>
                  {onlineVersions.length > 0 && (
                    <optgroup label="Online (needs internet)">
                      {onlineVersions.map((v) => (
                        <option key={v.id} value={v.id}>{v.name} ({v.languageName || v.language})</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div className="section-title" style={{ marginTop: '0.9rem' }}>Presenter theme</div>
              <div className="theme-swatches">
                {['light', 'sepia', 'dark', 'contrast'].map((t) => (
                  <button
                    key={t}
                    className={`swatch sw-${t}${theme === t ? ' on' : ''}`}
                    aria-label={`${t} theme`}
                    aria-pressed={theme === t}
                    onClick={() => setTheme(t)}
                  />
                ))}
              </div>
              <div className="section-title" style={{ marginTop: '0.9rem' }}>Font size</div>
              <div className="font-size">
                <button className="icon-btn" aria-label="Smaller" onClick={() => nudgeFont(-10)} disabled={fontScale <= 80}>A-</button>
                <span className="fs-val">{fontScale}%</span>
                <button className="icon-btn" aria-label="Larger" onClick={() => nudgeFont(10)} disabled={fontScale >= 140}>A+</button>
              </div>

              <div className="section-title" style={{ marginTop: '0.9rem' }}>Verses per screen</div>
              <div className="vps-row">
                {[
                  [0, 'Auto'],
                  [2, '2'],
                  [4, '4'],
                  [6, '6'],
                  [8, '8'],
                  [10, '10'],
                  [12, '12']
                ].map(([n, label]) => (
                  <button
                    key={n}
                    className={`vps-btn${perPage === n ? ' on' : ''}`}
                    aria-pressed={perPage === n}
                    onClick={() => setVersesPerScreen(n)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="muted vps-hint">Auto fits as many verses as stay readable. A number shows exactly that many per screen for long passages.</p>
              </div>

              <div className="scard">
                <div className="section-title">In this session</div>
                <div className="sp-admins">
                  {presence.length ? (
                    presence.map((n, i) => (
                      <span className="chip" key={i}>{n}</span>
                    ))
                  ) : (
                    <span className="chip">just you</span>
                  )}
                </div>
                <div className="share-btns" style={{ marginTop: '0.7rem' }}>
                  <button className="link-btn" onClick={resetRemembered}>Reset remembered settings</button>
                  <button className="link-btn danger" onClick={leaveSession}>Leave session</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {qrBig && (
        <div className="qr-modal" role="dialog" aria-label="Presenter QR code" onClick={() => setQrBig(false)}>
          <div className="qr-modal-inner" onClick={(e) => e.stopPropagation()}>
            <Qr text={linkFor('present')} size={Math.min(320, window.innerWidth - 80)} />
            <div className="qr-modal-code">{code}</div>
            <div className="muted">Scan to watch on any phone</div>
            <button className="btn small" onClick={() => setQrBig(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Control({ params }) {
  const code = params.get('s') || params.get('c') || ''
  const inviteWanted = params.get('invite') === '1'
  // Take a fresh handoff from the landing page exactly once (survives StrictMode
  // double-render via the ref guard).
  const handoffRef = useRef()
  if (handoffRef.current === undefined) {
    const h = takeHandoff()
    handoffRef.current = h && h.creds?.code === code ? h : null
  }
  const handoff = handoffRef.current

  const [row, setRow] = useState(handoff ? handoff.row : null)
  const [creds, setCreds] = useState(handoff ? handoff.creds : null)
  // Only show "Opening..." when we actually have creds to rejoin with.
  const [resolving, setResolving] = useState(() => !handoff && !!loadCreds(code)?.pin && !inviteWanted)

  useEffect(() => {
    if (row || !resolving) return
    const cached = loadCreds(code)
    if (!cached?.pin) {
      setResolving(false)
      return
    }
    joinSession(code, cached.pin)
      .then((r) => {
        setRow(r)
        setCreds(cached)
        setResolving(false)
      })
      .catch(() => {
        clearCreds()
        setResolving(false)
      })
  }, [code, row, resolving])

  if (!row) {
    if (resolving) {
      return (
        <div className="center-wrap">
          <div className="card">
            <h1>OpenLectern</h1>
            <p className="tagline">Opening your remote...</p>
          </div>
        </div>
      )
    }
    return (
      <div className="center-wrap">
        <JoinForm
          role="control"
          initialCode={code}
          initialInvite={inviteWanted}
          onJoined={(r, c) => {
            saveCreds(c)
            setRow(r)
            setCreds(c)
          }}
        />
      </div>
    )
  }
  return <Console row={row} creds={creds} />
}
