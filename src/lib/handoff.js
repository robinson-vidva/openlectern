// Hand a freshly created/joined session from the landing page to the controller
// route without a network re-join. The value lives in memory (survives a hash
// navigation, which does not reload the SPA) and is taken exactly once.
let pending = null
export function setHandoff(value) {
  pending = value
}
export function takeHandoff() {
  const v = pending
  pending = null
  return v
}

// Per-tab creds cache so a controller reload can silently rejoin (and "Show PIN"
// still works). Keyed by code; the PIN is a low-security ephemeral session PIN,
// not PII. Never leaves the device.
const CREDS_KEY = 'ol-creds'
export function saveCreds(creds) {
  try {
    sessionStorage.setItem(CREDS_KEY, JSON.stringify(creds))
  } catch {
    /* ignore */
  }
}
export function loadCreds(code) {
  try {
    const c = JSON.parse(sessionStorage.getItem(CREDS_KEY) || 'null')
    return c && c.code === code ? c : null
  } catch {
    return null
  }
}
export function clearCreds() {
  try {
    sessionStorage.removeItem(CREDS_KEY)
  } catch {
    /* ignore */
  }
}
