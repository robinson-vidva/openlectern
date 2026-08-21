import { useEffect, useMemo, useRef, useState } from 'react'
import JoinForm from '../components/JoinForm.jsx'
import { useVoice } from '../components/useVoice.js'
import { updateSession, joinSession } from '../lib/session.js'
import { supabase, friendlyError } from '../lib/supabase.js'
import { takeHandoff, saveCreds, loadCreds, clearCreds } from '../lib/handoff.js'
import { loadPrefs, savePrefs, clearPrefs } from '../lib/prefs.js'
import Qr from '../components/Qr.jsx'
import Icon from '../components/Icon.jsx'
import PresenterPreview from '../components/PresenterPreview.jsx'
import { parseReference, formatLabel, searchBooks, parsePartialRef } from '../lib/parseRef.js'
import { matchAliases } from '../lib/aliases.js'
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
  // Editable display name (shown to other controllers). Defaults to "Admin 1" for
  // the creator, "Admin" for a joiner; the pencil in settings changes it.
  const [displayName, setDisplayName] = useState(() => creds.name?.trim() || (creds.creator ? 'Admin 1' : 'Admin'))
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const credsRef = useRef(creds)
  credsRef.current = { ...creds, name: displayName }
  function saveName() {
    const n = nameDraft.trim().slice(0, 24) || displayName
    setDisplayName(n)
    setEditingName(false)
    try {
      saveCreds({ ...credsRef.current, name: n })
    } catch {
      /* ignore */
    }
  }
  const [listenerMode, setListenerMode] = useState(false)
  const [presenceEntries, setPresenceEntries] = useState([])
  const [listenerBanner, setListenerBanner] = useState('')
  const [qrBig, setQrBig] = useState(false)
  // Show the creator a "session is live -- here's how to share it" popup once per
  // new session, so the presenter/second-controller links are never assumed.
  const welcomeKey = `ol-welcome-${row.code}`
  const [welcomeOpen, setWelcomeOpen] = useState(() => {
    try {
      return !!creds.creator && sessionStorage.getItem(welcomeKey) !== '1'
    } catch {
      return !!creds.creator
    }
  })
  useEffect(() => {
    if (welcomeOpen) {
      try {
        sessionStorage.setItem(welcomeKey, '1')
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
        await channel.track({ name: displayName, at: Date.now(), listening: false })
      }
    })
    return () => channel.unsubscribe()
  }, [code, displayName])

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
    ch.track({ name: displayName, at: Date.now(), listening: listenerMode && voice.micState === 'listening' })
  }, [listenerMode, voice.micState, displayName])

  function toggleListener(on) {
    setListenerMode(on)
    if (on && voice.micState !== 'listening') voice.start()
  }

  const otherListeners = activeListeners(presenceEntries)

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
  // Bumped when structure data arrives so the chapter/verse type-ahead memos
  // (which read the refs) recompute even on a cold cache.
  const [structVersion, setStructVersion] = useState(0)
  const primaryId = versions[0]?.id
  useEffect(() => {
    loadStructure(primaryId)
      .then((s) => (structureRef.current = s || {}))
      .catch(() => (structureRef.current = {}))
      .finally(() => setStructVersion((v) => v + 1))
  }, [primaryId])
  useEffect(() => {
    loadStructure('eng-web')
      .then((s) => (fallbackStructRef.current = s || {}))
      .catch(() => (fallbackStructRef.current = {}))
      .finally(() => setStructVersion((v) => v + 1))
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
  // Live parse (not debounced) so the combobox + action buttons react instantly.
  const parsedNow = useMemo(() => parseReference(input), [input])

  // ---- Select2-style autocomplete combobox ----
  // One dropdown of ranked suggestions: a "show" row for a complete reference,
  // named passages, then book -> chapter -> verse completions (validated against
  // structure data). Options either fill the box or continue to the next stage.
  const [comboOpen, setComboOpen] = useState(false)
  const [comboActive, setComboActive] = useState(0)
  const comboBlurRef = useRef(null)

  function computeOptions(text) {
    const t = text.trim()
    if (!t) return []
    const out = []
    const seen = new Set()
    const push = (o) => {
      const k = o.action + '|' + o.value
      if (!seen.has(k)) {
        seen.add(k)
        out.push(o)
      }
    }
    const parsed = parseReference(text)
    if (parsed) push({ kind: 'show', label: `Show ${formatLabel(parsed)}`, hint: 'Enter', value: text, action: 'show' })
    for (const h of matchAliases(text).slice(0, 4)) {
      for (const ref of h.refs) push({ kind: 'alias', label: h.name, hint: ref, value: ref, action: 'fill' })
    }
    const partial = parsePartialRef(text)
    const endsWithSpace = /\s$/.test(text)
    const bookSettled = !!(partial && partial.book && (partial.chapter != null || endsWithSpace))
    if (!bookSettled) {
      const afterOrdinal = t.replace(/^\s*(iii|ii|i|1|2|3|first|second|third)\s+/i, '')
      if (!/\d/.test(afterOrdinal)) {
        for (const b of searchBooks(t, 8)) push({ kind: 'book', label: b.name, hint: 'chapter & verse next', value: `${b.name} `, action: 'continue' })
      }
    } else if (partial.chapter == null) {
      const bk = partial.book
      for (let c = 1; c <= chaptersOf(bk.id); c++) push({ kind: 'chapter', label: `${bk.name} ${c}`, hint: `chapter ${c}`, value: `${bk.name} ${c}:`, action: 'continue' })
    } else {
      const bk = partial.book
      const typed = partial.verse != null ? String(partial.verse) : ''
      if (!typed) push({ kind: 'wholechapter', label: `${bk.name} ${partial.chapter}`, hint: 'whole chapter', value: `${bk.name} ${partial.chapter}`, action: 'fill' })
      for (let v = 1; v <= versesOf(bk.id, partial.chapter); v++) {
        if (typed && !String(v).startsWith(typed)) continue
        push({ kind: 'verse', label: `${bk.name} ${partial.chapter}:${v}`, hint: `verse ${v}`, value: `${bk.name} ${partial.chapter}:${v}`, action: 'fill' })
      }
    }
    return out.slice(0, 80)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const comboOptions = useMemo(() => computeOptions(input), [input, parsedNow, structVersion])

  // Typing (not deleting) that narrows to a single book completes it, so "Matt"
  // jumps straight to "Matthew " and its chapters. Guarded to a strict prefix so
  // backspacing never re-adds what you just removed.
  function onRefChange(val) {
    const deleting = val.length < input.length
    setInput(val)
    setComboOpen(true)
    setComboActive(0)
    if (deleting) return
    const opts = computeOptions(val)
    if (opts.length === 1 && opts[0].kind === 'book') {
      const full = opts[0].value
      const bookLower = full.trim().toLowerCase()
      const valLower = val.trim().toLowerCase()
      if (valLower && valLower.length < bookLower.length && bookLower.startsWith(valLower)) {
        setInput(full)
        focusInputEnd(full)
      }
    }
  }

  function focusInputEnd(val) {
    requestAnimationFrame(() => {
      const el = refInputRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(val.length, val.length)
      }
    })
  }
  function selectOption(opt) {
    if (!opt) return
    clearTimeout(comboBlurRef.current)
    if (opt.action === 'show') {
      setComboOpen(false)
      showNow()
      return
    }
    setInput(opt.value)
    setComboActive(0)
    setComboOpen(opt.action === 'continue') // keep open to pick chapter/verse; close on a complete pick
    focusInputEnd(opt.value)
  }
  function comboKeyDown(e) {
    const opts = comboOptions
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setComboOpen(true)
      setComboActive((i) => Math.min(opts.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setComboActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      if (comboOpen && opts[comboActive]) {
        e.preventDefault()
        selectOption(opts[comboActive])
      } else if (parsedNow && !previewing) {
        e.preventDefault()
        showNow()
      }
    } else if (e.key === 'Escape') {
      setComboOpen(false)
    }
  }
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
    const p = parseReference(input)
    if (!p) return
    return showAdhoc(p, 'manual')
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
      if (!inviteRef.current) return
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
    const p = parseReference(input)
    if (!p) return
    const item = { id: crypto.randomUUID(), input: input.trim(), label: formatLabel(p), whole: true }
    patchState({ queue: [...queue, item] })
    setInput('')
    setPreview(null)
    setComboOpen(false)
  }

  function removeItem(id) {
    patchState({ queue: queue.filter((q) => q.id !== id) })
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
  const savedPlanItem = cursor?.savedPlan ? itemById(cursor.savedPlan.queueId) : null
  const stepping = activeItem && !activeItem.whole && cursor?.verseIndex != null
  const stepResults = curResults && curResults.id === cursor?.queueId ? curResults.results : null
  const stepTotal = stepResults ? verseCount(stepResults) : 0

  const inQueue = cursor?.queueId != null
  const lastSource = history[0]?.source
  const modeLabel = inQueue ? 'queue' : cursor?.adhoc ? (lastSource === 'voice' ? 'voice' : lastSource === 'auto' ? 'auto' : 'ad-hoc') : ''
  const firstLine = current?.primary?.verses?.[0]?.text || ''
  const firstLineShort = firstLine.length > 90 ? firstLine.slice(0, 90).trim() + '...' : firstLine
  const adminCount = presence.length || 1
  // A single-verse reference can't meaningfully step, so hide the mode switch.
  // For a queue item in step mode, current.ref is the single stepped verse, so
  // judge by the item's full passage instead.
  const nowPassageRef = cursor?.queueId != null && activeItem ? parseReference(activeItem.input) : current?.ref
  const nowSingleVerse = !!(
    nowPassageRef &&
    nowPassageRef.verseStart != null &&
    nowPassageRef.verseStart === (nowPassageRef.verseEnd ?? nowPassageRef.verseStart) &&
    (nowPassageRef.endChapter ?? nowPassageRef.chapter) === nowPassageRef.chapter
  )

  // Switch the passage that's on screen between whole-passage and verse-by-verse.
  function toggleNowMode() {
    const st = stateRef.current
    const c = st.current
    if (!c || !c.ref) return
    const cur = st.cursor
    const item = cur?.queueId != null ? itemById(cur.queueId) : null
    if (item) return toggleWhole(item)
    const rf = c.ref
    if (c.step) return showAdhoc(rf, 'manual') // step -> whole
    const verse = rf.verseStart || 1 // whole -> step at the first verse
    return showAdhocVerse({ bookId: rf.bookId, chapter: rf.chapter, first: verse, last: verse, count: chapterCount(rf.bookId, rf.chapter) }, verse)
  }

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
  const [related, setRelated] = useState([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [relatedExpanded, setRelatedExpanded] = useState(false)
  // Auto-load cross-references whenever the shown verse changes: the first 3
  // surface inline, the rest behind "More". Forgets nothing between verses.
  useEffect(() => {
    setRelated([])
    setRelatedExpanded(false)
    if (!relatedAnchor) return
    let cancelled = false
    setRelatedLoading(true)
    ;(async () => {
      try {
        const chunk = await loadXrefBook(relatedAnchor.bookId)
        const refs = lookupXrefs(chunk, relatedAnchor.chapter, relatedAnchor.verse)
        const items = refs.map((ref) => ({ ref, parsed: parseReference(ref) })).filter((x) => x.parsed)
        const withPreview = await Promise.all(
          items.map(async (x) => ({ ...x, preview: await resolvePreviewText(versions, x.parsed) }))
        )
        if (!cancelled) setRelated(withPreview)
      } finally {
        if (!cancelled) setRelatedLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relatedKey])

  if (listenerMode) {
    return <ListenerView v={voice} name={displayName} code={code} onExit={() => toggleListener(false)} />
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
          {editingName ? (
            <span className="tb-name-edit">
              <input
                value={nameDraft}
                maxLength={24}
                autoFocus
                aria-label="Your name"
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName()
                  else if (e.key === 'Escape') setEditingName(false)
                }}
                onBlur={saveName}
              />
            </span>
          ) : (
            <button
              className="tb-admins"
              onClick={() => {
                setNameDraft(displayName)
                setEditingName(true)
              }}
              title="Edit your name"
            >
              <Icon name="pencil" size={13} />
              <span className="tb-name">{displayName}</span>
              {adminCount > 1 && <span className="tb-plus">+{adminCount - 1}</span>}
            </button>
          )}
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
              {!nowSingleVerse && (
                <div className="now-modeswitch" role="group" aria-label="How to show this passage">
                  <button className={`nm-opt${!current.step ? ' on' : ''}`} onClick={() => current.step && toggleNowMode()} aria-pressed={!current.step}>
                    Whole passage
                  </button>
                  <button className={`nm-opt${current.step ? ' on' : ''}`} onClick={() => !current.step && toggleNowMode()} aria-pressed={current.step}>
                    Verse by verse
                  </button>
                </div>
              )}
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
              {cursor?.savedPlan && (
                <button className="btn small back-to-plan" onClick={backToPlan} title="Return to where you left off in the plan">
                  &#8617; Resume plan{savedPlanItem ? ` · ${savedPlanItem.label}` : ''}
                </button>
              )}
              {related.length > 0 && (
                <div className="related">
                  <div className="related-head">Related verses</div>
                  <div className="related-list">
                    {(relatedExpanded ? related : related.slice(0, 3)).map((x) => (
                      <button key={x.ref} className="related-chip" onClick={() => showAdhoc(x.parsed, 'related')}>
                        <span className="related-ref">{x.ref}</span>
                        {x.preview && <span className="related-preview">{x.preview}</span>}
                      </button>
                    ))}
                  </div>
                  {related.length > 3 && (
                    <button className="link-btn related-more" onClick={() => setRelatedExpanded((v) => !v)}>
                      {relatedExpanded ? 'Show fewer' : `More (${related.length - 3})`}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="now-empty">Nothing on screen yet</div>
          )}
        </section>

        {current && !current.step && (
          <div className="vps-bar">
            <span className="vps-bar-label">Verses per screen</span>
            <div className="vps-row">
              {[[0, 'Auto'], [2, '2'], [4, '4'], [6, '6'], [8, '8'], [10, '10'], [12, '12']].map(([n, label]) => (
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

        <section className="panel-card">
          <h3 className="card-h">Find a passage</h3>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="ref">Reference</label>
                <div className="combo">
                  <input
                    id="ref"
                    ref={refInputRef}
                    type="text"
                    autoComplete="off"
                    enterKeyHint="send"
                    role="combobox"
                    aria-expanded={comboOpen && comboOptions.length > 0}
                    aria-controls="ref-listbox"
                    aria-autocomplete="list"
                    value={input}
                    onChange={(e) => onRefChange(e.target.value)}
                    onFocus={() => setComboOpen(true)}
                    onBlur={() => {
                      comboBlurRef.current = setTimeout(() => setComboOpen(false), 120)
                    }}
                    onKeyDown={comboKeyDown}
                    placeholder="Search a book, reference, or name (e.g. John 3:16, the love chapter)"
                  />
                  {comboOpen && comboOptions.length > 0 && (
                    <ul className="combo-list" id="ref-listbox" role="listbox">
                      {comboOptions.map((o, i) => (
                        <li
                          key={o.action + '|' + o.value}
                          role="option"
                          aria-selected={i === comboActive}
                          className={`combo-opt${i === comboActive ? ' active' : ''} co-${o.kind}`}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            selectOption(o)
                          }}
                          onMouseEnter={() => setComboActive(i)}
                        >
                          <span className="co-label">{o.label}</span>
                          <span className="co-hint">{o.hint}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              {previewErr && comboOptions.length === 0 && <p className="error">{previewErr}</p>}
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
                <button className="btn primary" onClick={showNow} disabled={!parsedNow || previewing}>
                  Show now
                </button>
                <button className="btn" onClick={addToQueue} disabled={!parsedNow}>
                  Add to queue
                </button>
              </div>
        </section>
        </main>

        <aside className="console-right">
          <PresenterPreview state={state} onOpen={() => window.open(linkFor('present'), '_blank', 'noopener')} />

          <section className="panel-card screen-card">
            <div className="screen-row">
              <span className="mini-label">Theme</span>
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
            </div>
            <div className="screen-row">
              <span className="mini-label">Font size</span>
              <div className="font-size">
                <button className="icon-btn" aria-label="Smaller" onClick={() => nudgeFont(-10)} disabled={fontScale <= 80}>A-</button>
                <span className="fs-val">{fontScale}%</span>
                <button className="icon-btn" aria-label="Larger" onClick={() => nudgeFont(10)} disabled={fontScale >= 140}>A+</button>
              </div>
            </div>
          </section>

          <section className="panel-card plan-card">
            <div className="plan-head">
              <h3 className="card-h">Plan ({queue.length})</h3>
              <div className="plan-tools">
                <button className="iconbtn sm" title="Export the plan" aria-label="Export the plan" onClick={exportQueue} disabled={!queue.length && !history.length}>
                  <Icon name="download" />
                </button>
                <button className="iconbtn sm" title="Import a plan" aria-label="Import a plan" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" />
                </button>
                <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={importQueue} />
              </div>
            </div>
            <div className="queue">
              {queue.map((item, i) => {
                const active = cursor?.queueId === item.id
                return (
                  <div className={`queue-row${active ? ' active' : ''}`} key={item.id}>
                    <button className="qr-show" onClick={() => enterItemStart(item)} title={`Show ${item.label}`}>
                      {item.label}
                    </button>
                    <button className="icon-btn" aria-label={`Move ${item.label} up`} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                    <button className="icon-btn" aria-label={`Move ${item.label} down`} onClick={() => move(i, 1)} disabled={i === queue.length - 1}>↓</button>
                    <button className="icon-btn danger" aria-label={`Remove ${item.label}`} onClick={() => removeItem(item.id)}>✕</button>
                  </div>
                )
              })}
              {!queue.length && <p className="muted">Add passages from the search — they build up here. Tap one to put it on screen.</p>}
            </div>
          </section>
        </aside>
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
                  <p className="muted">Scan to watch, or share a link. A second controller also needs the PIN.</p>
                  <div className="share-btns">
                    <button className="btn small" onClick={() => copyLink('present')} title="Copy the watch (presenter) link">
                      <Icon name="copy" />{copied === 'present' ? 'Copied' : 'Watch link'}
                    </button>
                    <button className="btn small" onClick={() => copyLink('control')} title="Copy the control link">
                      <Icon name="copy" />{copied === 'control' ? 'Copied' : 'Control link'}
                    </button>
                    {pinReveal ? (
                      <span className="pin-reveal" role="status">PIN {creds.pin}</span>
                    ) : (
                      <button className="btn small" onClick={revealPin}><Icon name="eye" />Show PIN</button>
                    )}
                    {invite ? (
                      <span className="invite-live">Invite <strong>{invite.code}</strong> ({inviteSecs}s)</span>
                    ) : (
                      <button className="btn small" onClick={startInvite}><Icon name="invite" />Invite device</button>
                    )}
                  </div>
                  {inviteNote && <p className="muted" style={{ margin: 0 }}>{inviteNote}</p>}
                  <button className="link-btn ic-link" onClick={() => window.open(linkFor('present'), '_blank', 'noopener')}>
                    <Icon name="external" />Open the screen
                  </button>
                </div>
              </div>

              <div className="scard">
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
                <div className="field" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
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
              </div>

              <div className="scard">
                <div className="section-title">This session</div>
                <div className="sp-admins">
                  {presence.length ? presence.map((n, i) => <span className="chip" key={i}>{n}</span>) : <span className="chip">just you</span>}
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

      {welcomeOpen && (
        <div className="welcome-scrim" role="dialog" aria-label="Session started" onClick={() => setWelcomeOpen(false)}>
          <div className="welcome-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="welcome-head">
              <h2>Your session is live</h2>
              <span className="welcome-code">{code}</span>
            </div>
            <p className="welcome-sub">Get it on the big screen, and invite a helper if you want one.</p>

            <div className="welcome-step">
              <div className="ws-body">
                <div className="ws-title">1 &middot; Put it on the screen</div>
                <p className="muted" style={{ margin: '0.15rem 0 0' }}>
                  Open the presenter on your projector or a shared screen (e.g. a shared tab in Zoom).
                </p>
                <div className="ws-actions">
                  <button className="btn primary small" onClick={() => window.open(linkFor('present'), '_blank', 'noopener')}>
                    <Icon name="external" />Open the screen
                  </button>
                  <button className="btn small" onClick={() => copyLink('present')}>
                    <Icon name="copy" />{copied === 'present' ? 'Copied' : 'Copy screen link'}
                  </button>
                </div>
              </div>
              <button className="ws-qr" aria-label="Enlarge the QR code" title="Tap to enlarge" onClick={() => setQrBig(true)}>
                <Qr text={linkFor('present')} size={92} />
                <span className="muted ws-qrhint">Scan to watch</span>
              </button>
            </div>

            <div className="welcome-step">
              <div className="ws-body">
                <div className="ws-title">2 &middot; Add another controller <span className="muted">(optional)</span></div>
                <p className="muted" style={{ margin: '0.15rem 0 0' }}>
                  A helper can drive from their phone with the code and PIN, or use a one-time invite.
                </p>
                <div className="ws-actions">
                  <button className="btn small" onClick={() => copyLink('control')}>
                    <Icon name="copy" />{copied === 'control' ? 'Copied' : 'Copy control link'}
                  </button>
                  {pinReveal ? (
                    <span className="pin-reveal" role="status">PIN {creds.pin}</span>
                  ) : (
                    <button className="btn small" onClick={revealPin}><Icon name="eye" />Show PIN</button>
                  )}
                  {invite ? (
                    <span className="invite-live">Invite <strong>{invite.code}</strong> ({inviteSecs}s)</span>
                  ) : (
                    <button className="btn small" onClick={startInvite}><Icon name="invite" />Invite device</button>
                  )}
                </div>
                {inviteNote && <p className="muted" style={{ margin: '0.4rem 0 0' }}>{inviteNote}</p>}
              </div>
            </div>

            <div className="welcome-foot">
              <span className="muted">Reopen anytime from the settings gear.</span>
              <button className="btn primary" onClick={() => setWelcomeOpen(false)}>Done</button>
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
