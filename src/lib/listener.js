// Pure helpers for split voice roles (listener mode).

// Cross-device chip dedupe: skip a ref shown within the window on any device.
export function isRecent(lastAt, now, windowMs = 10000) {
  return lastAt != null && now - lastAt < windowMs
}

// Presence -> health: which named devices are currently listening.
export function activeListeners(entries) {
  return (entries || []).filter((e) => e && e.listening).map((e) => e.name || 'Someone')
}

// Names that were listening before but are not now (dropped / stopped / errored).
export function listenerDrops(prevNames, currNames) {
  return (prevNames || []).filter((n) => !(currNames || []).includes(n))
}
