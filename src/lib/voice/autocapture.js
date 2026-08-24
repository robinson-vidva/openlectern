// Auto-capture policy: given a detected citation and the operator's auto-capture
// mode, decide whether OpenLectern may put it on the screen automatically. This is
// pure and side-effect-free so the decision is testable in isolation; useVoice
// applies it, and the same recentRef dedupe still prevents an immediate re-fire.
//
// Named-passage aliases and quote matches are fuzzier and are handled separately
// (always tap-only), so they never reach this function's auto path.
//
// Modes (cycled by the Auto button on the voice bar):
//   off     — nothing auto-shows; every detection is a tap-only chip.
//   verse   — auto-show a high-confidence citation (exact book + a specific verse),
//             e.g. "John three sixteen". The safe default.
//   chapter — the above, plus an announced whole chapter from an exact book name,
//             e.g. "turn to Psalm 23". Homophone/guessed books stay tap-only.
export const AUTO_MODES = ['off', 'verse', 'chapter']

export const AUTO_MODE_LABELS = {
  off: 'Auto off',
  verse: 'Auto: verses',
  chapter: 'Auto: chapters'
}

export function normalizeAutoMode(mode) {
  return AUTO_MODES.includes(mode) ? mode : 'off'
}

export function nextAutoMode(mode) {
  const i = AUTO_MODES.indexOf(mode)
  return AUTO_MODES[(i + 1) % AUTO_MODES.length]
}

export function shouldAutoShow(cand, mode) {
  if (!cand || normalizeAutoMode(mode) === 'off') return false
  // Exact book + valid verse: safe to show in either active mode.
  if (cand.confidence === 'high') return true
  // Announced whole chapter ("Psalm 23"): only in the eager "chapter" mode, and
  // only when the book name was an exact match (never a homophone/fuzzy guess).
  if (mode === 'chapter' && cand.confidence === 'medium' && cand.exactBook && cand.verseStart == null) return true
  return false
}
