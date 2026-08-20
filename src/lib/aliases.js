import aliasData from '../data/aliases.json'

// Words that carry no matching signal ("show the ...", "read us ...").
const STOP = new Set([
  'show', 'shows', 'showing', 'read', 'reading', 'go', 'to', 'the', 'a', 'an', 'of', 'us',
  'me', 'i', 'please', 'can', 'you', 'lets', 'let', 'turn', 'open', 'put', 'up', 'on', 'and',
  'from', 'that', 'this', 'which', 'mentioned', 'about', 'passage', 'passages', 'slide', 'slides',
  'next', 'now', 'verse', 'verses', 'number', 'bring', 'pull', 'display', 'give', 'find'
])
// Words too generic to anchor a match on their own ("chapter", "story"...).
const GENERIC = new Set(['chapter', 'chapters', 'verse', 'verses', 'passage', 'book', 'story', 'account', 'prayer', 'psalm', 'parable', 'song'])

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9஀-௿]+/g, ' ')
    .trim()
}
function tokens(s) {
  const n = norm(s)
  return n ? n.split(/\s+/) : []
}
// The most distinctive word in a phrase: longest non-stop, non-generic token,
// falling back to the longest non-stop token. Used so a bare generic word like
// "chapter" never matches "the love chapter".
function headToken(phrase) {
  const t = tokens(phrase)
  const strong = t.filter((w) => !STOP.has(w) && !GENERIC.has(w))
  const pool = strong.length ? strong : t.filter((w) => !STOP.has(w))
  if (!pool.length) return null
  return pool.reduce((a, b) => (b.length > a.length ? b : a))
}

function scorePhrase(qNorm, qSet, phrase) {
  const pNorm = norm(phrase)
  if (!pNorm) return 0
  if (qNorm === pNorm) return 1
  const pToks = tokens(phrase)
  const pContent = pToks.filter((t) => !STOP.has(t))
  const qContent = [...qSet].filter((t) => !STOP.has(t))
  if (!pContent.length || !qContent.length) return 0
  const head = headToken(phrase)
  const pSet = new Set(pToks)
  // The full phrase appears within the query ("show me the good samaritan").
  if (pContent.every((t) => qSet.has(t))) return 0.9
  // The query is a subset of the phrase and names its distinctive word
  // ("prodigal" -> "the prodigal son").
  if (head && qSet.has(head) && qContent.every((t) => pSet.has(t))) return 0.75
  // Distinctive word present with decent overlap.
  if (head && qSet.has(head)) {
    const overlap = pContent.filter((t) => qSet.has(t)).length / pContent.length
    return overlap >= 0.5 ? 0.6 : 0.45
  }
  return 0
}

// Fuzzy-match a free-text query against the alias table. Returns up to `limit`
// results { name, refs, score, phrase } sorted by score, best per entry. Empty
// when nothing plausibly matches (generic/off-topic queries score 0).
export function matchAliases(query, data = aliasData, limit = 5) {
  const qNorm = norm(query)
  if (!qNorm) return []
  const qSet = new Set(tokens(query))
  const out = []
  for (const e of data?.entries || []) {
    const phrases = [e.name, ...(e.aliases || []), ...(e.ta || [])]
    let best = 0
    let bestPhrase = null
    for (const ph of phrases) {
      const s = scorePhrase(qNorm, qSet, ph)
      if (s > best) {
        best = s
        bestPhrase = ph
      }
    }
    if (best > 0) out.push({ name: e.name, refs: Array.isArray(e.ref) ? e.ref : [e.ref], score: best, phrase: bestPhrase })
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return out.slice(0, limit)
}

export { aliasData }
