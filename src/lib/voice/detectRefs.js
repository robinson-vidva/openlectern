// Pure bible-reference detection from a speech transcript. No DOM, no async.
// detectRefs(transcript, bookIndex) -> ranked, validated candidates.
//
// bookIndex is built by buildBookIndex() and carries:
//   byFirst:   Map firstToken -> [{ tokens, id, tier }] (longest first)
//   byId:      { [id]: { id, name, singleChapter } }
//   structure: { [id]: [verseCountCh1, verseCountCh2, ...] } (validation)

import { BOOKS, BOOK_BY_ID } from '../books.js'
import { HOMOPHONES, TAMIL_ALIASES } from './homophones.js'

const ONES = { zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }
// Speech-recognition homophones of small numbers. Recognizers routinely emit
// these for spoken verse numbers ("four" -> "for", "eight" -> "ate"). They are
// NOT in ONES, so they never start a number on their own or feed digit-spelling;
// parseNumberSpec only accepts them in the verse slot when the surrounding words
// confirm a number is meant, so ordinary speech ("for I am persuaded") is safe.
const NUM_HOMOPHONES = { for: 4, fore: 4, ate: 8, won: 1, too: 2 }
const homoNum = (t) => (t in NUM_HOMOPHONES ? NUM_HOMOPHONES[t] : null)
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 }
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const ORDINAL_WORD = { 1: 'first', 2: 'second', 3: 'third' }
const ORDINAL_ABBR = { 1: '1st', 2: '2nd', 3: '3rd' }
const RANGE_WORDS = new Set(['to', 'through', 'thru', 'until', 'வரை', 'முதல்'])
// Words meaning "and" that join a verse list ("4 and 5"), incl. Tamil.
const AND_WORDS = new Set(['and', 'மற்றும்', 'மற்றும'])

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

  // Fillers before the verse: "John 3 from verse 4", "John 3 and verse 16".
  if (tokens[i] === 'from') i++
  if (AND_WORDS.has(tokens[i]) && (tokens[i + 1] === 'verse' || tokens[i + 1] === 'verses')) i++
  let verseKeyword = false
  if (tokens[i] === 'verse' || tokens[i] === 'verses') {
    i++
    if (tokens[i] === 'number') i++ // "verse number sixteen"
    verseKeyword = true
  }
  if (isNumberStart(tokens, i)) {
    const vs = readNumber(tokens, i)
    verseStart = vs.value
    i = vs.next
  } else {
    // Homophone verse ("Psalm 91 for and five" -> 91:4-5). Only when a number is
    // clearly intended: an explicit "verse", or a following range / "and <num>".
    const h = homoNum(tokens[i])
    if (h != null) {
      const after = tokens[i + 1]
      const confirmed =
        verseKeyword ||
        RANGE_WORDS.has(after) ||
        (AND_WORDS.has(after) && (isNumberStart(tokens, i + 2) || homoNum(tokens[i + 2]) != null))
      if (confirmed) {
        verseStart = h
        i++
      }
    }
  }

  const sep = tokens[i]
  if (RANGE_WORDS.has(sep) || AND_WORDS.has(sep)) {
    const save = i
    i++
    if (tokens[i] === 'verse' || tokens[i] === 'verses') i++ // "verse 4 to verse 8"
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
    } else if (isNumberStart(tokens, i) || homoNum(tokens[i]) != null) {
      const n = isNumberStart(tokens, i) ? readNumber(tokens, i) : { value: homoNum(tokens[i]), next: i + 1 }
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
  // Common spoken Tamil name variants (exact -- real names, not mishearings).
  for (const [id, list] of Object.entries(TAMIL_ALIASES)) {
    if (BOOK_BY_ID[id]) for (const a of list) add(a, id, 'exact')
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

// Alternative chapter:verse readings of a number the recognizer may have merged,
// because we can't hear the pause. Ordered by how the reference is most naturally
// SPOKEN, so the best reading comes first:
//   "twenty one"    -> 20:1  (tens + ones)
//   "eleven"        -> 1:1   (teen)
//   "three sixteen" -> 3:16  (digit-join; every split, shortest chapter first)
// Only splits where BOTH the chapter and verse exist in `struct` are returned.
function altReadings(num, struct) {
  const out = []
  const seen = new Set()
  const push = (c, v) => {
    if (c >= 1 && c <= struct.length && v >= 1 && v <= struct[c - 1]) {
      const k = c + ':' + v
      if (!seen.has(k)) {
        seen.add(k)
        out.push({ chapter: c, verse: v })
      }
    }
  }
  // Natural spoken decomposition of a two-digit number ("twenty one" -> 20:1).
  if (num >= 21 && num <= 99 && num % 10 !== 0) push(Math.floor(num / 10) * 10, num % 10)
  if (num >= 11 && num <= 19) push(1, num - 10)
  // Digit-join ("316" -> 3:16, "77" -> 7:7): every split point, shortest chapter first.
  const s = String(num)
  for (let i = 1; i < s.length; i++) push(parseInt(s.slice(0, i), 10), parseInt(s.slice(i), 10))
  return out
}

// Parse + validate one book match into candidate(s). Usually one; two when a
// spoken number is genuinely ambiguous ("Mark 11" could be chapter 11 OR 1:1),
// in which case both are returned (flagged ambiguous) for the operator to choose.
function buildCandidates(after, match, pos, bookIndex) {
  const book = bookIndex.byId[match.id] || BOOK_BY_ID[match.id]
  let spec = parseNumberSpec(after)
  // "Jude verse 5": single-chapter books can name a verse with no chapter.
  if (!spec && book?.singleChapter && (after[0] === 'verse' || after[0] === 'verses') && isNumberStart(after, 1)) {
    const v = readNumber(after, 1)
    spec = { chapter: 1, verseStart: v.value, verseEnd: null, hadChapterWord: true }
  }
  if (!spec) return []

  let { chapter, verseStart, verseEnd, endChapter } = spec
  // Single-chapter books: "Jude 5" means chapter 1, verse 5.
  if (book?.singleChapter && verseStart == null && !spec.hadChapterWord) {
    verseStart = chapter
    chapter = 1
  }

  const struct = bookIndex.structure[match.id]
  if (!struct || !struct.length) return []

  const chapterOnly = verseStart == null && (endChapter == null || endChapter === chapter)

  // Structure-aware recovery: a number too large to be a chapter ("Matthew 77",
  // "John 316", "Matthew 29") is re-read as chapter:verse using the most natural
  // spoken split. Unambiguous, because chapter N genuinely does not exist.
  if (chapter > struct.length && chapterOnly) {
    const alt = altReadings(chapter, struct)[0]
    if (alt) {
      chapter = alt.chapter
      verseStart = alt.verse
      verseEnd = null
      endChapter = chapter
    }
  }

  if (chapter < 1 || chapter > struct.length) return []
  const vmax = struct[chapter - 1]
  if (verseStart != null && (verseStart < 1 || verseStart > vmax)) return []

  // Validate the end endpoint against structure data (both endpoints must be
  // real). A backwards or out-of-range end kills the whole candidate.
  const ec = endChapter ?? chapter
  if (ec < chapter || ec > struct.length) return []
  if (ec === chapter) {
    if (verseEnd != null && verseStart != null && (verseEnd < verseStart || verseEnd > vmax)) return []
  } else if (verseEnd != null) {
    const evmax = struct[ec - 1]
    if (verseEnd < 1 || verseEnd > evmax) return []
  }

  const exact = match.tier === 'exact'
  const mk = (ch, vs, ecc, ve, ambiguous) => ({
    bookId: match.id,
    bookName: BOOK_BY_ID[match.id]?.name || match.id,
    chapter: ch,
    verseStart: vs,
    endChapter: ecc,
    verseEnd: ve,
    ref: refLabel(match.id, ch, vs, ecc, ve),
    confidence: exact && vs != null ? 'high' : 'medium',
    // Whether the book name was an exact (non-homophone) match. Auto-capture uses
    // this to decide whether an announced chapter ("Psalm 23") is safe to show.
    exactBook: exact,
    // Ambiguous candidates are tap-only (never auto-shown) so the operator picks.
    ambiguous: !!ambiguous,
    pos,
    key: `${match.id} ${ch}:${vs ?? '-'}-${ecc}:${ve ?? '-'}`
  })

  const primary = mk(chapter, verseStart, ec, verseEnd, false)

  // Ambiguity: a spoken whole-chapter number could equally be a joined chapter:verse
  // -- "Mark 11" is chapter 11 but also 1:1; "Matthew twenty one" is chapter 21 but
  // also 20:1 (we can't hear the pause). Offer both, most-natural split as the
  // alternative, for the operator to decide. Skipped when "chapter" is said.
  if (verseStart == null && ec === chapter && !spec.hadChapterWord) {
    const alt = altReadings(chapter, struct)[0]
    if (alt) {
      primary.ambiguous = true
      const altCand = mk(alt.chapter, alt.verse, alt.chapter, null, true)
      altCand.confidence = 'medium' // a secondary reading, so the chapter stays primary
      return [primary, altCand]
    }
  }
  return [primary]
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
    for (const cand of buildCandidates(tokens.slice(p + match.length), match, p, bookIndex)) {
      if (!seen.has(cand.key)) {
        seen.add(cand.key)
        out.push(cand)
      }
    }
    p = advanceTo
  }

  // Rank by confidence, then position. Keep an ambiguity pair adjacent by putting
  // the whole-chapter reading just before its verse split (both are the same pos).
  const rank = { high: 0, medium: 1 }
  out.sort((a, b) => rank[a.confidence] - rank[b.confidence] || b.pos - a.pos)
  return out
}

// Continuation: a preacher announces a book once ("open to Romans 8"), then walks
// the passage as "verse 28", "verse 31", "chapter 9 verse 1" -- no book named.
// Given the most recent citation (last = { bookName, chapter }), rebuild a full
// reference string so the normal parser resolves it. Only triggers on an explicit
// "verse"/"chapter" keyword, so stray numbers in ordinary speech don't carry over.
// Returns the full string, or null if it isn't a continuation.
export function continuationText(text, last) {
  if (!last || !last.bookName || !text) return null
  const toks = tokenize(text)
  if (!toks.length) return null
  const hasChapter = toks.includes('chapter') || toks.includes('chapters')
  const hasVerse = toks.includes('verse') || toks.includes('verses')
  if (hasChapter) return `${last.bookName} ${text}`
  if (hasVerse && last.chapter != null) return `${last.bookName} ${last.chapter} ${text}`
  return null
}

// Choose the recognition alternative that yields a citation. Chrome returns
// several transcript guesses per result (maxAlternatives); its top guess often
// mangles an unusual book name while a lower-ranked one gets it right. Returns the
// first alternative that detects a reference, else the top (index 0).
export function pickBestTranscript(alternatives, bookIndex) {
  const alts = (alternatives || []).filter(Boolean)
  if (bookIndex) {
    for (const alt of alts) {
      if (detectRefs(alt, bookIndex).length) return alt
    }
  }
  return alts[0] || ''
}
