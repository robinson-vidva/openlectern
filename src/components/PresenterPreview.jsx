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

export default function PresenterPreview({ state, onOpen }) {
  const current = state?.current
  const blank = state?.blank
  const display = state?.display || {}
  const theme = display.theme || 'light'
  const perPage = display.versesPerScreen || 0
  // Reflect the presenter font-size setting so the monitor previews it.
  const fontScale = (display.fontScale || 100) / 100

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

  return (
    <div className="pv-panel">
      <div className="pv-head">
        <span className="pv-title">On the screen</span>
        <span className="pv-live"><span className="pv-dot" />live</span>
      </div>
      <div className={`pv-screen theme-${theme}`}>
        {blank ? (
          <div className="pv-blank">Screen is blank</div>
        ) : current ? (
          <div className="pv-body" style={{ fontSize: `${(0.9 * fontScale).toFixed(3)}rem` }}>
            <div className="pv-ref">{current.reference}</div>
            <PvVerses block={primary} hideNumber={current.step} />
            <PvVerses block={secondary} hideNumber={current.step} />
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
