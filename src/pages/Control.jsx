import { useEffect, useMemo, useRef, useState } from 'react'
import JoinForm from '../components/JoinForm.jsx'
import VoiceMode from '../components/VoiceMode.jsx'
import { updateSession } from '../lib/session.js'
import { supabase, friendlyError } from '../lib/supabase.js'
import { parseReference, formatLabel } from '../lib/parseRef.js'
import { resolveItem, resolveCurrent, wholeCurrent, stepCurrent, verseCount } from '../lib/resolve.js'
import { loadStructure } from '../lib/bibleData.js'
import { appendHistory } from '../lib/history.js'

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function Console({ row, creds }) {
  const versions = row.config?.versions || []
  const code = row.code
  const [state, setState] = useState(row.state)
  // Mirror of the latest state so rapid Next/Back taps read fresh values.
  const stateRef = useRef(row.state)
  const [presence, setPresence] = useState([])
  const [status, setStatus] = useState('')

  // Realtime + presence.
  useEffect(() => {
    const channel = supabase.channel(`session:${code}`, {
      config: { presence: { key: crypto.randomUUID() } }
    })
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sessions', filter: `code=eq.${code}` },
      (payload) => {
        const incoming = payload.new?.state
        if (!incoming) return
        // Ignore our own stale echo arriving after a newer optimistic write.
        if ((incoming.rev || 0) < (stateRef.current.rev || 0)) return
        stateRef.current = incoming
        setState(incoming)
      }
    )
    channel.on('presence', { event: 'sync' }, () => {
      const s = channel.presenceState()
      const names = Object.values(s).flat().map((m) => m.name || 'Someone')
      setPresence(names)
    })
    channel.subscribe(async (st) => {
      if (st === 'SUBSCRIBED') {
        await channel.track({ name: creds.name || 'Guest', at: Date.now() })
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

  const queue = state.queue || []
  const current = state.current || null
  const cursor = state.cursor || null // { queueId, verseIndex, adhoc?, savedPlan? } | null
  const history = state.history || []
  const [historyOpen, setHistoryOpen] = useState(false)

  // ---- presenter display (theme + font size), synced to all ----
  const display = state.display || {}
  const theme = display.theme || 'light'
  const fontScale = display.fontScale || 100
  // Read the freshest display from stateRef so rapid theme/font taps never
  // clobber each other with stale closure values.
  function setTheme(t) {
    const d = stateRef.current.display || {}
    patchState({ display: { theme: t, fontScale: d.fontScale || 100 } })
  }
  function nudgeFont(delta) {
    const d = stateRef.current.display || {}
    const v = Math.max(80, Math.min(140, (d.fontScale || 100) + delta))
    patchState({ display: { theme: d.theme || 'light', fontScale: v } })
  }

  const itemById = (id) => queue.find((q) => q.id === id) || null

  // Per-chapter verse counts for the primary version, for ad-hoc stepping bounds.
  const structureRef = useRef(null)
  useEffect(() => {
    loadStructure(versions[0]?.id)
      .then((s) => (structureRef.current = s || {}))
      .catch(() => (structureRef.current = {}))
  }, [])
  function chapterCount(bookId, chapter) {
    const s = structureRef.current
    return s && s[bookId] ? s[bookId][chapter - 1] || 0 : 0
  }

  // ---- reference input + preview ----
  const [input, setInput] = useState('')
  const debounced = useDebounced(input, 300)
  const parsed = useMemo(() => parseReference(debounced), [debounced])
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
  }, [cursor?.queueId, queue])

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
      await commitShow(wholeCurrent(results), { queueId: item.id, verseIndex: null }, 'queue')
    } catch (e) {
      setStatus(e.message)
    }
  }

  function enterItemStart(item) {
    return item.whole ? showItemWhole(item) : showItemAtVerse(item, 0)
  }

  async function enterItemEnd(item) {
    if (item.whole) return showItemWhole(item)
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
      await commitShow(wholeCurrent(results), cursorNext, source)
    } catch (e) {
      setStatus(e.message)
    }
  }

  function showNow() {
    if (!parsed) return
    return showAdhoc(parsed, 'manual')
  }

  // Show a reference detected by voice. A single-verse detection has verseEnd
  // null; getPassage treats that as "to end of chapter", so pin it first.
  function showDetected(cand, source = 'voice') {
    const ref = {
      bookId: cand.bookId,
      bookName: cand.bookName,
      chapter: cand.chapter,
      verseStart: cand.verseStart,
      verseEnd: cand.verseStart != null && cand.verseEnd == null ? cand.verseStart : cand.verseEnd
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

  // ---- Back / Next navigation ----
  async function goNext() {
    const st = stateRef.current
    const q = st.queue || []
    const cur = st.cursor || null
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
      items: queue.map((q) => ({ input: q.input, label: q.label, whole: !!q.whole })),
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
            return { id: crypto.randomUUID(), input: it.input || it.label, label: formatLabel(p), whole: !!it.whole }
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

  return (
    <div className="control">
      <div className="control-head">
        <span>
          Code <span className="code">{code}</span>
        </span>
        <a className="link-btn" href={`#/present?s=${code}`} target="_blank" rel="noopener">Open presenter</a>
      </div>

      <div className="presence">
        <span className="muted">Connected:</span>
        {presence.length ? (
          presence.map((n, i) => (
            <span className="chip" key={i}>{n}</span>
          ))
        ) : (
          <span className="chip">just you</span>
        )}
      </div>

      <div className="control-main">
        {status && <p className="error">{status}</p>}

        <VoiceMode
          versions={versions}
          defaultLang={versions[0]?.language === 'ta' ? 'ta-IN' : 'en-US'}
          onShow={showDetected}
        />

        <div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="ref">Reference</label>
            <input
              id="ref"
              type="text"
              autoComplete="off"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="John 3:16-18"
            />
          </div>
          {previewErr && <p className="error">{previewErr}</p>}
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
        </div>

        {current && (
          <div className="nowshowing">
            <div className="ns-ref">
              Now showing: <strong>{current.reference}</strong>
              {stepping && stepTotal ? <span className="pos"> {cursor.verseIndex + 1} / {stepTotal}</span> : null}
            </div>
            {cursor?.adhoc && (
              <div className="ns-note">
                <span className="muted">Next continues through this chapter.</span>
                {cursor.savedPlan && (
                  <button className="btn small" onClick={backToPlan}>Back to plan</button>
                )}
              </div>
            )}
            {stepping && stepResults && (
              <div className="verse-chips">
                {stepResults[0].verses.map((v, k) => (
                  <button
                    key={v.n}
                    className={`vchip${k === cursor.verseIndex ? ' on' : ''}`}
                    onClick={() => showItemAtVerse(activeItem, k)}
                  >
                    {v.n}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="section-title">Queue ({queue.length})</div>
          <div className="queue">
            {queue.map((item, i) => {
              const active = cursor?.queueId === item.id
              return (
                <div className={`queue-item${active ? ' active' : ''}`} key={item.id}>
                  <button className="icon-btn" title="Move up" onClick={() => move(i, -1)}>up</button>
                  <button className="icon-btn" title="Move down" onClick={() => move(i, 1)}>dn</button>
                  <span className="label">{item.label}</span>
                  <button
                    className={`icon-btn mode${item.whole ? '' : ' on'}`}
                    title={item.whole ? 'Showing whole passage' : 'Stepping verse by verse'}
                    onClick={() => toggleWhole(item)}
                  >
                    {item.whole ? 'Whole' : 'Step'}
                  </button>
                  <button className="icon-btn" onClick={() => enterItemStart(item)}>Show</button>
                  <button className="icon-btn" onClick={() => removeItem(item.id)}>x</button>
                </div>
              )
            })}
            {!queue.length && <p className="muted">Nothing queued yet.</p>}
          </div>
          <div className="toolbar" style={{ marginTop: '0.6rem' }}>
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
        </div>

        <div>
          <button className="section-title as-toggle" onClick={() => setHistoryOpen((o) => !o)}>
            History ({history.length}) {historyOpen ? '-' : '+'}
          </button>
          {historyOpen && (
            <div className="history">
              {history.length ? (
                history.map((e, i) => (
                  <button className="history-item" key={i} onClick={() => reShow(e)}>
                    <span className="hi-ref">{e.ref}</span>
                    {e.source === 'auto' && <span className="vc-auto">auto</span>}
                    <span className="hi-time muted">{fmtTime(e.at)}</span>
                  </button>
                ))
              ) : (
                <p className="muted">Nothing shown yet.</p>
              )}
            </div>
          )}
        </div>

        <div className="display-panel">
          <div className="section-title">Display</div>
          <div className="display-row">
            <div className="theme-swatches">
              {['light', 'sepia', 'dark', 'contrast'].map((t) => (
                <button
                  key={t}
                  className={`swatch sw-${t}${theme === t ? ' on' : ''}`}
                  title={t}
                  aria-label={`${t} theme`}
                  onClick={() => setTheme(t)}
                />
              ))}
            </div>
            <div className="font-size">
              <button className="icon-btn" onClick={() => nudgeFont(-10)} disabled={fontScale <= 80}>A-</button>
              <span className="fs-val">{fontScale}%</span>
              <button className="icon-btn" onClick={() => nudgeFont(10)} disabled={fontScale >= 140}>A+</button>
            </div>
          </div>
        </div>
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

      <div className="bottom-bar">
        <button className="btn" onClick={goBack}>Back</button>
        <button className={`btn blank${state.blank ? ' on' : ''}`} onClick={toggleBlank}>
          {state.blank ? 'Unblank' : 'Blank'}
        </button>
        <button className="btn" onClick={goNext}>Next</button>
      </div>
    </div>
  )
}

export default function Control({ params }) {
  const [row, setRow] = useState(null)
  const [creds, setCreds] = useState(null)

  if (!row) {
    return (
      <div className="center-wrap">
        <JoinForm
          role="control"
          initialCode={params.get('s') || params.get('c') || ''}
          onJoined={(r, c) => {
            setRow(r)
            setCreds(c)
          }}
        />
      </div>
    )
  }
  return <Console row={row} creds={creds} />
}
