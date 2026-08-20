import { BOOKS } from './books.js'

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

// Parse a forgiving reference like "John 3:16-18", "1 Cor 13", "Psalm 23:1-6".
// Returns { bookId, bookName, chapter, verseStart, verseEnd } or null.
// verseStart/verseEnd are null when a whole chapter is requested.
export function parseReference(input) {
  if (!input) return null
  const cleaned = input.trim().replace(/[‒–—―]/g, '-')

  // Trailing "chapter[:verse[-verse]]" or "chapter-chapter" is not supported;
  // we match the final chapter with an optional verse range.
  const m = cleaned.match(/^(.*?)[\s.]*(\d+)\s*(?::\s*(\d+)\s*(?:-\s*(\d+))?)?\s*$/)
  if (!m) return null

  const bookToken = m[1].trim()
  if (!bookToken) return null

  const book = findBook(bookToken)
  if (!book) return null

  let chapter = parseInt(m[2], 10)
  let verseStart = m[3] != null ? parseInt(m[3], 10) : null
  let verseEnd = m[4] != null ? parseInt(m[4], 10) : null

  // For single-chapter books, "Jude 5" means chapter 1, verse 5.
  if (book.singleChapter && verseStart == null) {
    verseStart = chapter
    chapter = 1
  }

  if (verseEnd != null && verseEnd < verseStart) verseEnd = verseStart
  if (verseStart != null && verseEnd == null) verseEnd = verseStart

  return { bookId: book.id, bookName: book.name, chapter, verseStart, verseEnd }
}
