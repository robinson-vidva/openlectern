import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import JoinForm from '../components/JoinForm.jsx'
import { subscribeSession, joinView } from '../lib/session.js'
import { friendlyError } from '../lib/supabase.js'
import { passagePages } from '../lib/resolve.js'
import { MIN_FONT_VMIN } from '../lib/paginate.js'

function VerseBlock({ block, className, hideNumber }) {
  if (!block) return null
  return (
    <div className={className} lang={block.language}>
      {block.verses.map((v) => (
        <span key={v.c ? `${v.c}:${v.n}` : v.n}>
          {!hideNumber && <span className="present-verse-n">{v.label ?? v.n}</span>}
          {v.text}{' '}
        </span>
      ))}
    </div>
  )
}

// Shrink the verse block until it fits the available body area, then apply the
// operator's font-size adjustment on top.
function useAutoFit(ref, dep, scale = 1) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const parent = el.parentElement
    const fit = () => {
      // Legibility floor: never auto-shrink below MIN_FONT_VMIN (of the smaller
      // viewport side). Long passages paginate instead of going smaller.
      const floor = (MIN_FONT_VMIN / 100) * Math.min(window.innerWidth, window.innerHeight)
      let size = Math.min(parent.clientWidth, parent.clientHeight) * 0.13
      size = Math.min(size, 130)
      el.style.fontSize = size + 'px'
      let guard = 0
      while (
        (el.scrollHeight > parent.clientHeight || el.scrollWidth > parent.clientWidth) &&
        size > floor &&
        guard < 400
      ) {
        size -= 2
        el.style.fontSize = size + 'px'
        guard++
      }
      el.style.fontSize = Math.max(size, floor) * scale + 'px'
    }
    fit()
    // Re-fit once web fonts finish loading; their real metrics are taller than
    // the fallback, so an early fit can overflow and clip the reference line.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit)
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [dep, scale])
}

// Discreet session-code control for a clean share: an info dot that reveals the
// code and a join hint on hover / focus / tap, auto-dismissing. Never the PIN.
function CodeInfo({ code }) {
  const [open, setOpen] = useState(false)
  const timerRef = useRef(null)
  function reveal() {
    setOpen(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setOpen(false), 4000)
  }
  function hide() {
    setOpen(false)
    clearTimeout(timerRef.current)
  }
  return (
    <div className="code-info" onMouseEnter={reveal} onMouseLeave={hide}>
      <button
        className="code-info-btn"
        aria-label="Show the code to join as a controller"
        aria-expanded={open}
        onClick={reveal}
        onFocus={reveal}
        onBlur={hide}
      >
        i
      </button>
      {open && (
        <div className="code-info-pop" role="status">
          <span className="cip-code">{code}</span>
          <span className="cip-hint">Join as a controller with this code</span>
        </div>
      )}
    </div>
  )
}

function Stage({ state, code }) {
  const blockRef = useRef(null)
  const current = state?.current
  const blank = state?.blank
  const display = state?.display || {}
  const theme = display.theme || 'light'
  const scale = (display.fontScale || 100) / 100

  // Whole passages paginate; render only the current page's verses. A manual
  // verses-per-screen override (display.versesPerScreen) takes precedence over
  // the automatic by-weight pagination.
  const perPage = display.versesPerScreen || 0
  const allPages = current && !current.step ? passagePages(current, perPage) : null
  const paged = allPages && allPages.length > 1
  const pages = paged ? allPages : null
  const pageIdx = paged ? Math.min(current.page || 0, pages.length - 1) : 0
  const pageVerses = paged ? pages[pageIdx] : null
  const pagePrimary =
    pageVerses && current.primary
      ? { language: current.primary.language, verses: pageVerses.map((i) => current.primary.verses[i]).filter(Boolean) }
      : current?.primary
  const pageSecondary =
    pageVerses && current.secondary
      ? { language: current.secondary.language, verses: pageVerses.map((i) => current.secondary.verses[i]).filter(Boolean) }
      : current?.secondary

  const fitKey = blank ? 'blank' : `${current?.id || 'empty'}:${pageIdx}`
  useAutoFit(blockRef, fitKey, scale)

  const rootRef = useRef(null)
  const [isFs, setIsFs] = useState(false)

  useEffect(() => {
    const onFs = () => setIsFs(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen()
    else rootRef.current?.requestFullscreen?.()
  }

  return (
    <div className={`present theme-${theme}`} ref={rootRef}>
      <div className="present-body">
        {!blank && current ? (
          <div className="present-block" ref={blockRef}>
            <div className="present-ref">{current.reference}</div>
            <VerseBlock block={pagePrimary} className="present-primary" hideNumber={current.step} />
            <VerseBlock block={pageSecondary} className="present-secondary" hideNumber={current.step} />
          </div>
        ) : blank ? (
          <div className="present-block" ref={blockRef} />
        ) : (
          <div className="present-block" ref={blockRef}>
            <div className="present-hint">Waiting for the first verse...</div>
          </div>
        )}
      </div>
      {paged && !blank && pages.length > 1 && (
        <div className="present-page">{pageIdx + 1}/{pages.length}</div>
      )}
      <div className="present-bar">
        {current && !blank ? (
          <CodeInfo code={code} />
        ) : (
          <span>
            Join at this screen's code: <span className="present-code">{code}</span>
          </span>
        )}
        <button className="fs-btn" onClick={toggleFullscreen}>
          {isFs ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
    </div>
  )
}

export default function Present({ params }) {
  const [row, setRow] = useState(null)
  const [state, setState] = useState(null)
  const [joinError, setJoinError] = useState('')
  const codeRef = useRef('')
  const revRef = useRef(-1)
  const initialCode = params.get('s') || params.get('c') || ''

  // A presenter link is view-only and code-only, so open the screen directly
  // when the code is in the URL -- no click needed.
  useEffect(() => {
    if (row || !initialCode) return
    let live = true
    joinView(initialCode)
      .then((r) => live && setRow(r))
      .catch((e) => live && setJoinError(friendlyError(e)))
    return () => {
      live = false
    }
  }, [initialCode, row])

  useEffect(() => {
    if (!row) return
    codeRef.current = row.code
    revRef.current = row.state?.rev || 0
    setState(row.state)
    const channel = subscribeSession(row.code, (newRow) => {
      const incoming = newRow.state
      if (!incoming) return
      if ((incoming.rev || 0) < revRef.current) return
      revRef.current = incoming.rev || 0
      setState(incoming)
    })
    channel.subscribe()
    return () => channel.unsubscribe()
  }, [row])

  if (!row) {
    if (initialCode && !joinError) {
      return (
        <div className="center-wrap">
          <div className="card">
            <h1>OpenLectern</h1>
            <p className="tagline">Opening the screen...</p>
          </div>
        </div>
      )
    }
    return (
      <div className="center-wrap">
        <JoinForm role="present" initialCode={initialCode} onJoined={(r) => setRow(r)} />
      </div>
    )
  }

  return <Stage state={state} code={row.code} />
}
