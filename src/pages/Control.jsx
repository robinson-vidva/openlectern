import { useEffect, useMemo, useRef, useState } from 'react'
import JoinForm from '../components/JoinForm.jsx'
import { updateSession } from '../lib/session.js'
import { supabase, friendlyError } from '../lib/supabase.js'
import { parseReference, formatLabel } from '../lib/parseRef.js'
import { resolveCurrent } from '../lib/resolve.js'

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
  const [presence, setPresence] = useState([])
  const [status, setStatus] = useState('')
  const channelRef = useRef(null)

  // Realtime + presence.
  useEffect(() => {
    const channel = supabase.channel(`session:${code}`, {
      config: { presence: { key: crypto.randomUUID() } }
    })
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sessions', filter: `code=eq.${code}` },
      (payload) => {
        if (payload.new?.state) setState(payload.new.state)
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
    channelRef.current = channel
    return () => channel.unsubscribe()
  }, [code, creds.name])

  // Push a patch to the shared state (server merges shallowly into state).
  async function patchState(patch) {
    setState((prev) => ({ ...prev, ...patch })) // optimistic
    try {
      await updateSession(code, creds.pin, { state: patch })
      setStatus('')
    } catch (err) {
      setStatus(friendlyError(err))
    }
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

  const queue = state.queue || []
  const current = state.current || null

  async function showNow() {
    if (!parsed) return
    const c = await resolveCurrent(versions, parsed, -1)
    patchState({ current: c, blank: false })
  }

  function addToQueue() {
    if (!parsed) return
    const item = { id: crypto.randomUUID(), input: debounced.trim(), label: formatLabel(parsed) }
    patchState({ queue: [...queue, item] })
    setInput('')
    setPreview(null)
  }

  async function showItem(item, index) {
    const p = parseReference(item.input)
    if (!p) return setStatus('That queue item could not be read.')
    const c = await resolveCurrent(versions, p, index)
    patchState({ current: c, blank: false })
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

  const currentIndex = current?.index ?? -1

  async function step(delta) {
    const target = currentIndex + delta
    if (target < 0 || target >= queue.length) return
    await showItem(queue[target], target)
  }

  function toggleBlank() {
    patchState({ blank: !state.blank })
  }

  // ---- import / export ----
  const fileRef = useRef(null)
  function exportQueue() {
    const data = {
      openlectern: 'queue',
      version: 1,
      items: queue.map((q) => ({ input: q.input, label: q.label }))
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
            return { id: crypto.randomUUID(), input: it.input || it.label, label: formatLabel(p) }
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

        <div>
          <div className="section-title">Queue ({queue.length})</div>
          <div className="queue">
            {queue.map((item, i) => (
              <div className={`queue-item${i === currentIndex ? ' active' : ''}`} key={item.id}>
                <button className="icon-btn" title="Move up" onClick={() => move(i, -1)}>up</button>
                <button className="icon-btn" title="Move down" onClick={() => move(i, 1)}>dn</button>
                <span className="label">{item.label}</span>
                <button className="icon-btn" onClick={() => showItem(item, i)}>Show</button>
                <button className="icon-btn" onClick={() => removeItem(item.id)}>x</button>
              </div>
            ))}
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

      <div className="bottom-bar">
        <button className="btn" onClick={() => step(-1)} disabled={currentIndex <= 0}>Back</button>
        <button className={`btn blank${state.blank ? ' on' : ''}`} onClick={toggleBlank}>
          {state.blank ? 'Unblank' : 'Blank'}
        </button>
        <button
          className="btn"
          onClick={() => step(1)}
          disabled={currentIndex >= queue.length - 1 || !queue.length}
        >
          Next
        </button>
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
