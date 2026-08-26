import { useLayoutEffect, useRef } from 'react'
import { passagePages } from '../lib/resolve.js'
import Icon from './Icon.jsx'

// A live "program monitor" of the presenter screen, rendered from the same
// state the controller already holds, so it reflects every change instantly.
function PvVerses({ block, hideNumber }) {
  if (!block) return null
  return (
    <div className="pv-verses" lang={block.language}>
      {block.verses.map((v) => (
        <span key={v.c ? `${v.c}:${v.n}` : v.n}>
          {!hideNumber && <span className="pv-vn">{v.label ?? v.n}</span>}
          {v.text}{' '}
        </span>
      ))}
    </div>
  )
}

// Shrink the body text so the whole passage fits the 16:9 box without clipping,
// the same way the real presenter auto-fits. `scale` (the font-size setting)
// nudges short passages larger, but never past what fits.
function useFitPreview(bodyRef, screenRef, dep, scale) {
  useLayoutEffect(() => {
    const el = bodyRef.current
    const box = screenRef.current
    if (!el || !box) return
    const FLOOR = 6
    const fit = () => {
      const cs = getComputedStyle(box)
      const availW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const availH = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      if (availW <= 0 || availH <= 0) return
      // Largest size that still fits, found by shrinking from a generous start.
      // Height is the real constraint; the width check keeps a small tolerance
      // because scrollWidth rounds up to an integer that would otherwise always
      // read a hair over the fractional available width and shrink to the floor.
      let size = Math.min(availH * 0.32, 30)
      let guard = 0
      el.style.fontSize = size + 'px'
      while ((el.scrollHeight > availH + 1 || el.scrollWidth > availW + 2) && size > FLOOR && guard < 400) {
        size -= 1
        el.style.fontSize = size + 'px'
        guard++
      }
      // `fittedMax` is the largest size the whole passage fits at (scale 1). The
      // font-size setting then scales from there, exactly like the real screen:
      // A- shrinks cleanly; A+ grows past the fit and the small box crops, the
      // honest consequence of "bigger than fits" in a preview this size.
      const fittedMax = size
      el.style.fontSize = Math.max(FLOOR, fittedMax * (scale || 1)) + 'px'
    }
    fit()
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit)
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  }, [dep, scale])
}

export default function PresenterPreview({ state, onOpen }) {
  const current = state?.current
  const blank = state?.blank
  const display = state?.display || {}
  const theme = display.theme || 'light'
  const perPage = display.versesPerScreen || 0
  const scale = (display.fontScale || 100) / 100

  const allPages = current && !current.step ? passagePages(current, perPage) : null
  const paged = allPages && allPages.length > 1
  const pageIdx = paged ? Math.min(current.page || 0, allPages.length - 1) : 0
  const pageVerses = paged ? allPages[pageIdx] : null
  const primary =
    pageVerses && current.primary
      ? { language: current.primary.language, verses: pageVerses.map((i) => current.primary.verses[i]).filter(Boolean) }
      : current?.primary
  const secondary =
    pageVerses && current.secondary
      ? { language: current.secondary.language, verses: pageVerses.map((i) => current.secondary.verses[i]).filter(Boolean) }
      : current?.secondary

  // Mirror the presenter's translation-visibility choice.
  const showMode = display.show || 'both'
  const effShow = showMode === 'secondary' && !current?.secondary ? 'primary' : showMode
  const showPrimary = effShow !== 'secondary'
  const showSecondary = effShow !== 'primary'

  const screenRef = useRef(null)
  const bodyRef = useRef(null)
  const fitKey = blank
    ? 'blank'
    : `${current?.id || 'empty'}:${pageIdx}:${current?.step ? 1 : 0}:${effShow}`
  useFitPreview(bodyRef, screenRef, fitKey, scale)

  return (
    <div className="pv-panel">
      <div className="pv-head">
        <span className="pv-title">On the screen</span>
        <span className="pv-live"><span className="pv-dot" />live</span>
      </div>
      <div className={`pv-screen theme-${theme}`} ref={screenRef}>
        {blank ? (
          <div className="pv-blank">{state?.blankTitle || 'Screen is blank'}</div>
        ) : current ? (
          <div className="pv-body" ref={bodyRef}>
            <div className="pv-ref">{current.reference}</div>
            {showPrimary && <PvVerses block={primary} hideNumber={current.step} />}
            {showSecondary && <PvVerses block={secondary} hideNumber={current.step} />}
          </div>
        ) : (
          <div className="pv-hint">Waiting for the first verse...</div>
        )}
        {paged && !blank && <div className="pv-page">{pageIdx + 1}/{allPages.length}</div>}
      </div>
      <button className="pv-open link-btn ic-link" onClick={onOpen}><Icon name="external" />Open the full screen</button>
    </div>
  )
}
