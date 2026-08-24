// Pure bible-reference detection from a speech transcript. No DOM, no async.
// detectRefs(transcript, bookIndex) -> ranked, validated candidates.
//
// bookIndex is built by buildBookIndex() and carries:
//   byFirst:   Map firstToken -> [{ tokens, id, tier }] (longest first)
//   byId:      { [id]: { id, name, singleChapter } }
//   structure: { [id]: [verseCountCh1, verseCountCh2, ...] } (validation)

import { BOOKS, BOOK_BY_ID } from '../books.js'
import { HOMOPHONES } from './homophones.js'

const ONES = { zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 }
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const ORDINAL_WORD = { 1: 'first', 2: 'second', 3: 'third' }
const ORDINAL_ABBR = { 1: '1st', 2: '2nd', 3: '3rd' }
const RANGE_WORDS = new Set(['to', 'through', 'thru', 'until'])

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[௦-௯]/g, (d) => String(d.charCodeAt(0) - 0x0be6)) // Tamil digits -> ASCII
    .replace(/[.,;:!?"'`()\[\]]/g, ' ')
    .replace(/[-‐-―−]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(s) {
  return normalize(s).split(' ').filter(Boolean)
}

const isDigits = (t) => /^\d+$/.test(t || '')
const isSingleDigitWord = (t) => t in ONES

// One number starting at index i. Returns { value, next } or null.
function readNumber(tokens, i) {
  if (i >= tokens.length) return null
  const t = tokens[i]
  if (isDigits(t)) return { value: parseInt(t, 10), next: i + 1 }

  // 1) cardinal that actually uses hundred/thousand ("one hundred and nineteen")
  const card = readHundredCardinal(tokens, i)
  if (card) return card

  // 2) digit-spelling ("one oh five" -> 105); only when it clearly signals digits
  const digits = []
  let j = i
  while (j < tokens.length && isSingleDigitWord(tokens[j])) {
    digits.push(ONES[tokens[j]])
    j++
  }
  const hasZero = tokens.slice(i, j).some((x) => x === 'oh' || x === 'o' || x === 'zero')
  if (digits.length >= 2 && (hasZero || digits.length >= 3)) {
    return { value: parseInt(digits.join(''), 10), next: j }
  }

  // 3) a single atom: tens(+unit), teen, or one digit
  if (t in TENS) {
    let v = TENS[t]
    let n = i + 1
    const u = tokens[n]
    if (u in ONES && ONES[u] > 0) {
      v += ONES[u]
      n++
    }
    return { value: v, next: n }
  }
  if (t in TEENS) return { value: TEENS[t], next: i + 1 }
  // A bare zero-word ("oh"/"o"/"zero") is never a standalone scripture number --
  // it only carries meaning inside digit-spelling ("one oh five"), handled above.
  // Treating it as 0 here would corrupt the following verse slot and get the whole
  // candidate rejected by validation, dropping the reference on a common filler.
  if (t in ONES && ONES[t] > 0) return { value: ONES[t], next: i + 1 }
  return null
}

function readHundredCardinal(tokens, i) {
  let total = 0
  let current = 0
  let used = false
  let any = false
  let j = i
  while (j < tokens.length) {
    const t = tokens[j]
    if (t === 'and' && any) {
      j++
      continue
    }
    if (t in ONES && ONES[t] > 0) {
      current += ONES[t]
      any = true
      j++
    } else if (t in TEENS) {
      current += TEENS[t]
      any = true
      j++
    } else if (t in TENS) {
      current += TENS[t]
      any = true
      j++
    } else if (t === 'hundred') {
      current = (current || 1) * 100
      used = true
      any = true
      j++
    } else if (t === 'thousand') {
      total += (current || 1) * 1000
      current = 0
      used = true
      any = true
      j++
    } else break
  }
  if (!used) return null
  return { value: total + current, next: j }
}

const isNumberStart = (tokens, i) =>
  i < tokens.length &&
  (isDigits(tokens[i]) || (tokens[i] in ONES && ONES[tokens[i]] > 0) || tokens[i] in TEENS || tokens[i] in TENS)

// Parse grammar after a book name. Supports single-chapter forms plus cross-
// chapter ranges: "chapters five through seven", "chapter one verse one through
// chapter two verse three", "chapter five verse three through seven twenty nine".
function parseNumberSpec(tokens) {
  let i = 0
  let hadChapterWord = false
  if (tokens[i] === 'chapter' || tokens[i] === 'chapters') {
    hadChapterWord = true
    i++
    if (tokens[i] === 'number') i++ // "chapter number three"
  }
  const ch = readNumber(tokens, i)
  if (!ch) return null
  i = ch.next
  const chapter = ch.value
  let verseStart = null
  let verseEnd = null
  let endChapter = null

  if (tokens[i] === 'verse' || tokens[i] === 'verses') {
    i++
    if (tokens[i] === 'number') i++ // "verse number sixteen"
  }
  if (isNumberStart(tokens, i)) {
    const vs = readNumber(tokens, i)
    verseStart = vs.value
    i = vs.next
  }

  const sep = tokens[i]
  if (RANGE_WORDS.has(sep) || sep === 'and') {
    const save = i
    i++
    if (tokens[i] === 'chapter' || tokens[i] === 'chapters') {
      // "... through chapter two verse three" -> explicit cross-chapter end.
      i++
      const ec = readNumber(tokens, i)
      if (ec) {
        endChapter = ec.value
        i = ec.next
        if (tokens[i] === 'verse' || tokens[i] === 'verses') i++
        if (isNumberStart(tokens, i)) {
          const ve = readNumber(tokens, i)
          verseEnd = ve.value
          i = ve.next
        }
      } else i = save
    } else if (isNumberStart(tokens, i)) {
      const n = readNumber(tokens, i)
      if (verseStart != null) {
        // "verse three through seven" -> verse range in the same chapter.
        verseEnd = n.value
      } else {
        // "chapters five through seven" -> whole-chapter range.
        endChapter = n.value
      }
      i = n.next
    } else i = save
  }
  return { chapter, verseStart, verseEnd, endChapter, hadChapterWord }
}

// Longest book-name match at position p. Returns { id, length, tier } or null.
function matchBookAt(tokens, p, bookIndex) {
  const entries = bookIndex.byFirst.get(tokens[p])
  if (!entries) return null
  for (const e of entries) {
    if (p + e.tokens.length > tokens.length) continue
    let ok = true
    for (let k = 0; k < e.tokens.length; k++) {
      if (tokens[p + k] !== e.tokens[k]) {
        ok = false
        break
      }
    }
    if (ok) return { id: e.id, length: e.tokens.length, tier: e.tier }
  }
  return null
}

function refLabel(id, chapter, verseStart, endChapter, verseEnd) {
  const name = BOOK_BY_ID[id]?.name || id
  const ec = endChapter ?? chapter
  if (ec === chapter) {
    if (verseStart == null) return `${name} ${chapter}`
    if (verseEnd == null || verseEnd === verseStart) return `${name} ${chapter}:${verseStart}`
    return `${name} ${chapter}:${verseStart}-${verseEnd}`
  }
  const sp = verseStart == null ? `${chapter}` : `${chapter}:${verseStart}`
  const ep = verseEnd == null ? `${ec}` : `${ec}:${verseEnd}`
  return `${name} ${sp}-${ep}`
}

// Build the index detectRefs needs. tamilNames is an optional { [id]: name }.
export function buildBookIndex(structure, tamilNames) {
  const byFirst = new Map()
  const byId = {}
  const add = (phrase, id, tier) => {
    const toks = tokenize(phrase)
    if (!toks.length) return
    const first = toks[0]
    if (!byFirst.has(first)) byFirst.set(first, [])
    byFirst.get(first).push({ tokens: toks, id, tier })
  }

  for (const b of BOOKS) {
    byId[b.id] = { id: b.id, name: b.name, singleChapter: !!b.singleChapter }
    add(b.name, b.id, 'exact')
    for (const a of b.aliases) add(a, b.id, 'exact')
    const m = b.name.match(/^([123])\s+(.+)$/)
    if (m) {
      const n = Number(m[1])
      const rest = m[2]
      add(`${n} ${rest}`, b.id, 'exact')
      add(`${ORDINAL_WORD[n]} ${rest}`, b.id, 'exact')
      add(`${ORDINAL_ABBR[n]} ${rest}`, b.id, 'exact')
    }
  }
  for (const [id, list] of Object.entries(HOMOPHONES)) {
    for (const h of list) add(h, id, 'fuzzy')
  }
  if (tamilNames) {
    for (const [id, name] of Object.entries(tamilNames)) {
      if (BOOK_BY_ID[id]) add(name, id, 'exact')
    }
  }

  // Longest phrases first so multi-word names win over their prefixes.
  for (const list of byFirst.values()) list.sort((a, b) => b.tokens.length - a.tokens.length)

  return { byFirst, byId, structure: structure || {} }
}

// Parse + validate one book match into a candidate, or return null.
function buildCandidate(after, match, pos, bookIndex) {
  const book = bookIndex.byId[match.id] || BOOK_BY_ID[match.id]
  let spec = parseNumberSpec(after)
  // "Jude verse 5": single-chapter books can name a verse with no chapter.
  if (!spec && book?.singleChapter && (after[0] === 'verse' || after[0] === 'verses') && isNumberStart(after, 1)) {
    const v = readNumber(after, 1)
    spec = { chapter: 1, verseStart: v.value, verseEnd: null, hadChapterWord: true }
  }
  if (!spec) return null

  let { chapter, verseStart, verseEnd, endChapter } = spec
  // Single-chapter books: "Jude 5" means chapter 1, verse 5.
  if (book?.singleChapter && verseStart == null && !spec.hadChapterWord) {
    verseStart = chapter
    chapter = 1
  }

  const struct = bookIndex.structure[match.id]
  if (!struct || !struct.length) return null
  if (chapter < 1 || chapter > struct.length) return null
  const vmax = struct[chapter - 1]
  if (verseStart != null && (verseStart < 1 || verseStart > vmax)) return null

  // Validate the end endpoint against structure data (both endpoints must be
  // real). A backwards or out-of-range end kills the whole candidate.
  const ec = endChapter ?? chapter
  if (ec < chapter || ec > struct.length) return null
  if (ec === chapter) {
    if (verseEnd != null && verseStart != null && (verseEnd < verseStart || verseEnd > vmax)) return null
  } else if (verseEnd != null) {
    const evmax = struct[ec - 1]
    if (verseEnd < 1 || verseEnd > evmax) return null
  }

  const exact = match.tier === 'exact'
  const hasVerse = verseStart != null
  return {
    bookId: match.id,
    bookName: BOOK_BY_ID[match.id]?.name || match.id,
    chapter,
    verseStart,
    endChapter: ec,
    verseEnd,
    ref: refLabel(match.id, chapter, verseStart, ec, verseEnd),
    confidence: exact && hasVerse ? 'high' : 'medium',
    // Whether the book name was an exact (non-homophone) match. Auto-capture uses
    // this to decide whether an announced chapter ("Psalm 23") is safe to show.
    exactBook: exact,
    pos,
    key: `${match.id} ${chapter}:${verseStart ?? '-'}-${ec}:${verseEnd ?? '-'}`
  }
}

// Detect references in a transcript. Returns ranked, validated candidates:
// { bookId, bookName, chapter, verseStart, verseEnd, ref, confidence }.
export function detectRefs(transcript, bookIndex) {
  const tokens = tokenize(transcript)
  const out = []
  const seen = new Set()

  for (let p = 0; p < tokens.length; p++) {
    const match = matchBookAt(tokens, p, bookIndex)
    if (!match) continue
    // Skip past the matched book name so a shorter book inside a longer one
    // (e.g. "John" within "1st John") does not spawn a rival candidate.
    const advanceTo = p + match.length - 1
    const cand = buildCandidate(tokens.slice(p + match.length), match, p, bookIndex)
    if (cand && !seen.has(cand.key)) {
      seen.add(cand.key)
      out.push(cand)
    }
    p = advanceTo
  }

  const rank = { high: 0, medium: 1 }
  out.sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.pos - a.pos)
  return out
}
