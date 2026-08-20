import { getPassage } from './bibleData.js'
import { paginate, PAGE_CAPACITY } from './paginate.js'

// Per-verse size cost = combined length across both languages (kept aligned by
// index so both languages page together on the same verse boundaries).
export function verseWeights(current) {
  const p = current?.primary?.verses || []
  const s = current?.secondary?.verses || []
  return p.map((v, i) => (v?.text?.length || 0) + (s[i]?.text?.length || 0))
}

export function passagePages(current) {
  return paginate(verseWeights(current), PAGE_CAPACITY)
}

// Resolve a parsed reference across all versions. Returns per-version results:
// [{ version, bookName, reference, verses: [{ n, text }] }]. Index 0 is primary.
export async function resolveItem(versions, parsed) {
  const results = []
  for (const v of versions) {
    const p = await getPassage(v, parsed)
    results.push({ version: v, bookName: p.bookName, reference: p.reference, verses: p.verses })
  }
  return results
}

export function verseCount(results) {
  return results[0]?.verses.length || 0
}

// Structured reference stored on `current` so shown text can be re-resolved
// against new translations without parsing a (possibly non-English) display ref.
function refOf(parsed) {
  if (!parsed) return undefined
  return {
    bookId: parsed.bookId,
    chapter: parsed.chapter,
    verseStart: parsed.verseStart ?? null,
    verseEnd: parsed.verseEnd ?? null
  }
}

// Whole-passage display object for the presenter, with pagination metadata so
// long passages page instead of shrinking past the legibility floor.
export function wholeCurrent(results, parsed) {
  const p = results[0]
  const s = results[1] || null
  const cur = {
    id: crypto.randomUUID(),
    step: false,
    reference: p.reference,
    ref: refOf(parsed),
    primary: { language: p.version.language, verses: p.verses },
    secondary: s ? { language: s.version.language, verses: s.verses } : null
  }
  cur.pageCount = passagePages(cur).length || 1
  cur.page = 0
  return cur
}

// Single-verse display object (step mode). verseIndex indexes the primary list.
// Secondary is matched by verse number so mismatched versions stay aligned.
export function stepCurrent(results, parsed, verseIndex) {
  const p = results[0]
  const s = results[1] || null
  const pv = p.verses[verseIndex]
  if (!pv) return wholeCurrent(results)
  const sv = s ? s.verses.find((x) => x.n === pv.n) : null
  return {
    id: crypto.randomUUID(),
    step: true,
    verseIndex,
    verseNumber: pv.n,
    reference: `${p.bookName} ${parsed.chapter}:${pv.n}`,
    ref: { bookId: parsed.bookId, chapter: parsed.chapter, verseStart: pv.n, verseEnd: pv.n },
    primary: { language: p.version.language, verses: [pv] },
    secondary: s ? { language: s.version.language, verses: sv ? [sv] : [] } : null
  }
}

// Whole-passage current, used by the controller live preview.
export async function resolveCurrent(versions, parsed) {
  const results = await resolveItem(versions, parsed)
  return wholeCurrent(results, parsed)
}
