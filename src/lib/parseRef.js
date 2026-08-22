import { BOOKS, BOOK_BY_ID } from './books.js'

// Build a normalized lookup: canonical name + every alias -> book.
function norm(s) {
  return s
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const LOOKUP = (() => {
  const map = new Map()
  for (const b of BOOKS) {
    const keys = new Set([norm(b.name), norm(b.name).replace(/\s+/g, ''), ...b.aliases.map(norm)])
    for (const k of keys) map.set(k, b)
  }
  return map
})()

// Turn leading ordinals into a digit so "first john" / "i john" -> "1 john".
function normalizeOrdinals(token) {
  return token
    .replace(/^\s*iii\s+/i, '3 ')
    .replace(/^\s*ii\s+/i, '2 ')
    .replace(/^\s*i\s+/i, '1 ')
    .replace(/^\s*first\s+/i, '1 ')
    .replace(/^\s*second\s+/i, '2 ')
    .replace(/^\s*third\s+/i, '3 ')
}

// Fast type-ahead book search for the reference input. Returns matching books
// (canonical order within each relevance tier): exact, name-prefix, alias-prefix,
// then substring. Ordinal words/numerals are honored ("1 co" -> 1 Corinthians).
export function searchBooks(query, limit = 6) {
  const n = norm(normalizeOrdinals(query || ''))
  if (!n) return []
  const collapsed = n.replace(/\s+/g, '')
  const scoreOf = (b) => {
    const bnc = norm(b.name).replace(/\s+/g, '')
    if (bnc === collapsed) return 0
    if (bnc.startsWith(collapsed)) return 1
    if (b.aliases.some((a) => norm(a).replace(/\s+/g, '').startsWith(collapsed))) return 2
    if (norm(b.name).includes(n)) return 3
    return -1
  }
  const tiers = [[], [], [], []]
  for (const b of BOOKS) {
    const s = scoreOf(b)
    if (s >= 0) tiers[s].push(b)
  }
  return tiers.flat().slice(0, limit)
}

// Parse an in-progress reference for type-ahead: identify the book plus whatever
// chapter/verse has been typed so far, even when it is not yet a valid reference.
// Returns { book, chapter, hasColon, verse } or null. book is the book object.
export function parsePartialRef(input) {
  if (!input) return null
  const cleaned = input.trim().replace(/[‒–—―]/g, '-')
  if (!cleaned) return null
  // Leading book token (may start with an ordinal), then optional "C[:V]".
  const m = cleaned.match(/^((?:[1-3]|iii|ii|i|first|second|third)?\.?\s*[a-z][a-z.\s]*?)\s*(\d+)?\s*(:)?\s*(\d+)?\s*$/i)
  if (!m) return null
  const book = findBook(m[1].trim())
  if (!book) return null
  return {
    book,
    chapter: m[2] != null ? parseInt(m[2], 10) : null,
    hasColon: !!m[3],
    verse: m[4] != null ? parseInt(m[4], 10) : null
  }
}

function findBook(rawToken) {
  const token = normalizeOrdinals(rawToken)
  const n = norm(token)
  if (LOOKUP.has(n)) return LOOKUP.get(n)
  const collapsed = n.replace(/\s+/g, '')
  if (LOOKUP.has(collapsed)) return LOOKUP.get(collapsed)
  // Fall back to prefix match on canonical names ("philipp" -> Philippians).
  if (n.length >= 2) {
    for (const b of BOOKS) {
      if (norm(b.name).replace(/\s+/g, '').startsWith(collapsed)) return b
    }
  }
  return null
}

// Normalize + package a parsed reference. The model spans an optional end
// chapter: { bookId, bookName, chapter, verseStart, endChapter, verseEnd }.
// chapter/verseStart are the start; endChapter/verseEnd the end. endChapter ===
// chapter for a single-chapter reference (the common case). null verseStart/
// verseEnd mean "whole chapter" at that end.
function build(book, chapter, verseStart, endChapter, verseEnd) {
  if (endChapter == null || endChapter < chapter) endChapter = chapter
  if (endChapter === chapter) {
    if (verseStart != null && verseEnd != null && verseEnd < verseStart) verseEnd = verseStart
    if (verseStart != null && verseEnd == null) verseEnd = verseStart
  }
  return {
    bookId: book.id,
    bookName: book.name,
    chapter,
    verseStart: verseStart ?? null,
    endChapter,
    verseEnd: verseEnd ?? null
  }
}

// Parse a forgiving reference. Single chapter: "John 3:16-18", "1 Cor 13",
// "Psalm 23:1-6". Cross-chapter: "Matthew 5-7", "Genesis 1:1-2:3",
// "Matt 5:3-7:29", "Psalm 22-24". Returns a ref object (see build) or null.
export function parseReference(input) {
  if (!input) return null
  const cleaned = input.trim().replace(/[‒–—―]/g, '-')

  // book  startChapter [(:| )startVerse]  [ - endA [:endB] ]
  // A space between chapter and verse works like a colon ("John 3 16" = 3:16),
  // matching the forgiving voice grammar; a dash marks a range ("John 3 3-5",
  // "Matthew 5-7"). The cross-chapter end verse still uses a colon ("1:1-2:3").
  const m = cleaned.match(/^(.*?)[\s.]*(\d+)(?:(?:\s*:\s*|\s+)(\d+))?(?:\s*-\s*(\d+)(?:\s*:\s*(\d+))?)?\s*$/)
  if (!m) return null

  const bookToken = m[1].trim()
  if (!bookToken) return null
  const book = findBook(bookToken)
  if (!book) return null

  const rawStartCh = parseInt(m[2], 10)
  const rawStartV = m[3] != null ? parseInt(m[3], 10) : null
  const endA = m[4] != null ? parseInt(m[4], 10) : null
  const endB = m[5] != null ? parseInt(m[5], 10) : null

  // Single-chapter books have no chapter numbers: every number is a verse in the
  // sole chapter ("Jude 5" -> v5, "Jude 3-5" -> v3-5).
  if (book.singleChapter) {
    const vs = rawStartV != null ? rawStartV : rawStartCh
    const ve = endB != null ? endB : endA != null ? endA : vs
    return build(book, 1, vs, 1, Math.max(vs, ve))
  }

  const chapter = rawStartCh
  const verseStart = rawStartV
  let endChapter
  let verseEnd
  if (endB != null) {
    // "-C:V" -> explicit cross-chapter end.
    endChapter = endA
    verseEnd = endB
  } else if (endA != null) {
    if (verseStart != null) {
      // "C:V-V2" -> a verse range within the start chapter.
      endChapter = chapter
      verseEnd = endA
    } else {
      // "C-C2" -> a whole-chapter range.
      endChapter = endA
      verseEnd = null
    }
  } else {
    endChapter = chapter
    verseEnd = verseStart
  }
  return build(book, chapter, verseStart, endChapter, verseEnd)
}

// English label for a parsed reference, e.g. "John 3:16-18", "Matthew 5-7",
// "Genesis 1:1-2:3". Shared by the presenter/controller and getPassage.
export function formatRange(bookName, ref) {
  const { chapter, verseStart } = ref
  const endChapter = ref.endChapter ?? chapter
  const verseEnd = ref.verseEnd ?? null
  // Single-chapter books are cited without the chapter ("Jude 5", not "Jude 1:5").
  if (BOOK_BY_ID[ref.bookId]?.singleChapter) {
    if (verseStart == null) return bookName
    if (verseEnd == null || verseEnd === verseStart) return `${bookName} ${verseStart}`
    return `${bookName} ${verseStart}-${verseEnd}`
  }
  if (endChapter === chapter) {
    if (verseStart == null) return `${bookName} ${chapter}`
    if (verseEnd == null || verseEnd === verseStart) return `${bookName} ${chapter}:${verseStart}`
    return `${bookName} ${chapter}:${verseStart}-${verseEnd}`
  }
  const startPart = verseStart == null ? `${chapter}` : `${chapter}:${verseStart}`
  const endPart = verseEnd == null ? `${endChapter}` : `${endChapter}:${verseEnd}`
  return `${bookName} ${startPart}-${endPart}`
}

export function formatLabel(parsed) {
  if (!parsed) return ''
  return formatRange(parsed.bookName, parsed)
}

// English label for a structured ref (bookId-based), for pinning/exports where
// only the structured ref is on hand and the display string may be localized.
export function labelFromRef(ref) {
  if (!ref || !ref.bookId) return ''
  const book = BOOK_BY_ID[ref.bookId]
  if (!book) return ''
  return formatRange(book.name, ref)
}
