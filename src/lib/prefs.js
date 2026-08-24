// Per-device remembered settings (localStorage). Reused silently when the same
// device starts another session, so a volunteer never re-picks translations or
// re-sets theme/font. No PII: just translation ids + display prefs.
const KEY = 'ol-prefs'
export const HINT_KEY = 'ol-hint-seen'

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {}
  } catch {
    return {}
  }
}
export function savePrefs(patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }))
  } catch {
    /* storage disabled: fall back to defaults, no error */
  }
}
export function clearPrefs() {
  try {
    localStorage.removeItem(KEY)
    localStorage.removeItem(HINT_KEY)
  } catch {
    /* ignore */
  }
}
