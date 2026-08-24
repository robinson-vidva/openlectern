// Pure helpers for split voice roles (listener mode).

// Presence -> health: which named devices are currently listening.
export function activeListeners(entries) {
  return (entries || []).filter((e) => e && e.listening).map((e) => e.name || 'Someone')
}

// Names that were listening before but are not now (dropped / stopped / errored).
export function listenerDrops(prevNames, currNames) {
  return (prevNames || []).filter((n) => !(currNames || []).includes(n))
}
