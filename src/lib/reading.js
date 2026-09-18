// Responsive reading: the leader reads one verse, the congregation the next,
// and (optionally) everyone reads the last verse together -- the liturgical
// "responsive reading" printed in hymnals with the congregation's lines in bold.
//
// Pure: the pattern + per-verse overrides live in session state (`state.reading`)
// so every device agrees, and the role of any verse is computed from its
// position in the passage (index/total) plus an optional override keyed by the
// verse itself. The presenter, the mini preview and the console all call
// roleFor(), so they can never disagree about who reads what.

export const READING_PATTERNS = ['off', 'alternate', 'alternate-all']
export const READING_LABELS = {
  off: 'Off',
  alternate: 'Leader / People',
  'alternate-all': 'Leader / People, all at end'
}
export const ROLES = ['leader', 'people', 'all']
export const ROLE_LABELS = { leader: 'Leader', people: 'Congregation', all: 'All together' }
export const ROLE_SHORT = { leader: 'L', people: 'P', all: 'All' }

export function verseKey(bookId, chapter, verse) {
  return `${bookId} ${chapter}:${verse}`
}

export function normalizeReading(r) {
  const pattern = r && READING_PATTERNS.includes(r.pattern) ? r.pattern : 'off'
  const roles = {}
  if (r && r.roles && typeof r.roles === 'object') {
    for (const [k, v] of Object.entries(r.roles)) if (ROLES.includes(v)) roles[k] = v
  }
  return { pattern, roles }
}

// The role a verse is read in, or null when responsive reading is off.
// `index`/`total` are the verse's position within the passage the operator
// chose (not the page); `key` is verseKey(...) for a per-verse override.
export function roleFor(reading, { index, total, key } = {}) {
  const r = normalizeReading(reading)
  if (r.pattern === 'off') return null
  if (key && r.roles[key]) return r.roles[key]
  if (index == null || total == null) return null
  if (r.pattern === 'alternate-all' && total > 1 && index === total - 1) return 'all'
  return index % 2 === 0 ? 'leader' : 'people'
}

// Tap-to-change on a verse chip: auto -> leader -> people -> all -> auto.
// Returns the next `reading` value.
export function cycleRole(reading, key) {
  const r = normalizeReading(reading)
  const cur = r.roles[key] || null
  const order = [null, ...ROLES]
  const next = order[(order.indexOf(cur) + 1) % order.length]
  const roles = { ...r.roles }
  if (next) roles[key] = next
  else delete roles[key]
  return { pattern: r.pattern, roles }
}

// Roles for every verse of a whole passage, aligned with `verses` (each verse
// carries n and, across a chapter boundary, c).
export function rolesForPassage(reading, ref, verses) {
  if (!ref || !Array.isArray(verses)) return []
  const total = verses.length
  return verses.map((v, index) => roleFor(reading, { index, total, key: verseKey(ref.bookId, v?.c ?? ref.chapter, v?.n) }))
}

// Role of the single verse on screen in step mode.
export function roleForStep(reading, current) {
  if (!current || !current.step || !current.ref) return null
  return roleFor(reading, {
    index: current.verseIndex ?? null,
    total: current.verseTotal ?? null,
    key: verseKey(current.ref.bookId, current.ref.chapter, current.ref.verseStart)
  })
}
