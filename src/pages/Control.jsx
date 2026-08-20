import { useEffect, useMemo, useRef, useState } from 'react'
import JoinForm from '../components/JoinForm.jsx'
import VoiceMode from '../components/VoiceMode.jsx'
import { updateSession } from '../lib/session.js'
import { supabase, friendlyError } from '../lib/supabase.js'
import { parseReference, formatLabel } from '../lib/parseRef.js'
import { resolveItem, resolveCurrent, wholeCurrent, stepCurrent, verseCount } from '../lib/resolve.js'

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
        if (payload.new?.state) {
          stateRef.current = payload.new.state
          setState(payload.new.state)
        }
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
  async function patchState(patch) {
    const next = { ...stateRef.current, ...patch }
    stateRef.current = next
    setState(next)
    try {
      await updateSession(code, creds.pin, { state: patch })
      setStatus('')
    } catch (err) {
      setStatus(friendlyError(err))
    }
  }

  const queue = state.queue || []
  const current = state.current || null
  const cursor = state.cursor || null // { queueId, verseIndex } | null

  const itemById = (id) => queue.find((q) => q.id === id) || null

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
  async function showItemAtVerse(item, verseIndex) {
    const p = parseReference(item.input)
    if (!p) return setStatus('That queue item could not be read.')
    try {
      const results = await resolveItem(versions, p)
      const c = stepCurrent(results, p, verseIndex)
      await patchState({ current: c, cursor: { queueId: item.id, verseIndex: c.verseIndex ?? null }, blank: false })
    } catch (e) {
      setStatus(e.message)
    }
  }

  async function showItemWhole(item) {
    const p = parseReference(item.input)
    if (!p) return setStatus('That queue item could not be read.')
    try {
      const results = await resolveItem(versions, p)
      await patchState({ current: wholeCurrent(results), cursor: { queueId: item.id, verseIndex: null }, blank: false })
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
      await patchState({ current: c, cursor: { queueId: item.id, verseIndex: c.verseIndex ?? null }, blank: false })
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

  async function showNow() {
    if (!parsed) return
    try {
      const results = await resolveItem(versions, parsed)
      await patchState({ current: wholeCurrent(results), cursor: { queueId: null, verseIndex: null }, blank: false })
    } catch (e) {
      setStatus(e.message)
    }
  }

  // Show a reference detected by voice (same ad-hoc path as Show now).
  // A single-verse detection has verseEnd null; getPassage treats that as
  // "to end of chapter", so pin verseEnd to verseStart first.
  async function showDetected(cand) {
    const ref = { ...cand, verseEnd: cand.verseStart != null && cand.verseEnd == null ? cand.verseStart : cand.verseEnd }
    try {
      const results = await resolveItem(versions, ref)
      await patchState({ current: wholeCurrent(results), cursor: { queueId: null, verseIndex: null }, blank: false })
    } catch (e) {
      setStatus(e.message)
    }
  }

  // ---- Back / Next navigation ----
  async function goNext() {
    const st = stateRef.current
    const q = st.queue || []
    const cur = st.cursor || null
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
      items: queue.map((q) => ({ input: q.input, label: q.label, whole: !!q.whole }))
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
        <a className="link-btn" href={`#/present?c=${code}`}>Open presenter</a>
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
            <button className="btn" onClick={exportQueue} disabled={!queue.length}>Export</button>
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
      </div>

      {hint && (
        <div className="plan-hint">{hint === 'end' ? 'End of plan' : 'Start of plan'}</div>
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
          initialCode={params.get('c') || ''}
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
