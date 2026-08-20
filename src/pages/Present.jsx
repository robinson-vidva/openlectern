import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import JoinForm from '../components/JoinForm.jsx'
import { subscribeSession } from '../lib/session.js'

function VerseBlock({ block, className, hideNumber }) {
  if (!block) return null
  return (
    <div className={className} lang={block.language}>
      {block.verses.map((v) => (
        <span key={v.n}>
          {!hideNumber && <span className="present-verse-n">{v.n}</span>}
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
      let size = Math.min(parent.clientWidth, parent.clientHeight) * 0.13
      size = Math.min(size, 130)
      el.style.fontSize = size + 'px'
      let guard = 0
      while (
        (el.scrollHeight > parent.clientHeight || el.scrollWidth > parent.clientWidth) &&
        size > 14 &&
        guard < 300
      ) {
        size -= 2
        el.style.fontSize = size + 'px'
        guard++
      }
      el.style.fontSize = size * scale + 'px'
    }
    fit()
    // Re-fit once web fonts finish loading; their real metrics are taller than
    // the fallback, so an early fit can overflow and clip the reference line.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit)
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [dep, scale])
}

function Stage({ state, code }) {
  const blockRef = useRef(null)
  const current = state?.current
  const blank = state?.blank
  const display = state?.display || {}
  const theme = display.theme || 'light'
  const scale = (display.fontScale || 100) / 100
  const fitKey = blank ? 'blank' : current?.id || 'empty'
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
            <VerseBlock block={current.primary} className="present-primary" hideNumber={current.step} />
            <VerseBlock block={current.secondary} className="present-secondary" hideNumber={current.step} />
          </div>
        ) : blank ? (
          <div className="present-block" ref={blockRef} />
        ) : (
          <div className="present-block" ref={blockRef}>
            <div className="present-hint">Waiting for the first verse...</div>
          </div>
        )}
      </div>
      <div className="present-bar">
        <span>
          Join at this screen's code: <span className="present-code">{code}</span>
        </span>
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
  const codeRef = useRef('')
  const revRef = useRef(-1)

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
    return (
      <div className="center-wrap">
        <JoinForm role="present" initialCode={params.get('s') || params.get('c') || ''} onJoined={(r) => setRow(r)} />
      </div>
    )
  }

  return <Stage state={state} code={row.code} />
}
