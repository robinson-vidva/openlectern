// Verse loading. Bundled static JSON first; HelloAO API as a runtime fallback.
// Bundled shape: public/bibles/<versionId>/<BOOKID>.json =
//   { id, name, chapters: [ ["v1 text", "v2 text", ...], ... ] }

import { formatRange } from './parseRef.js'
import { MAX_PASSAGE_VERSES } from './paginate.js'

const BASE = import.meta.env.BASE_URL || '/'
const HELLOAO = 'https://bible.helloao.org/api'

const manifestCache = { value: null }
const bookCache = new Map() // key: versionId/bookId -> book object

export async function loadManifest() {
  if (manifestCache.value) return manifestCache.value
  const res = await fetch(`${BASE}bibles/manifest.json`)
  if (!res.ok) throw new Error('Could not load bible manifest.')
  const data = await res.json()
  manifestCache.value = data
  return data
}

// Fetch + parse a bundled JSON asset, treating any failure (network error, non-ok
// response, or a soft-404 that rewrites to index.html and fails to parse) as
// "not bundled" -> null. Returning null (never throwing) is what lets getBook fall
// through to the HelloAO fallback for online-only versions.
async function fetchBundledJson(path) {
  try {
    const res = await fetch(path)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function loadBundledBook(versionId, bookId) {
  return fetchBundledJson(`${BASE}bibles/${versionId}/${bookId}.json`)
}

// Per-chapter verse counts for a bundled version (voice detection validation).
export async function loadStructure(versionId) {
  return fetchBundledJson(`${BASE}bibles/${versionId}/structure.json`)
}

// Book list for a bundled version: [{ id, name, chapters }]. Used for the
// localized (e.g. Tamil) book names the voice matcher needs.
export async function loadIndex(versionId) {
  return fetchBundledJson(`${BASE}bibles/${versionId}/index.json`)
}

// Translations available only via the HelloAO API (network-dependent). Marked
// online so the picker can flag them.
export async function loadHelloaoList() {
  try {
    const res = await fetch(`${HELLOAO}/available_translations.json`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.translations || []).map((t) => ({
      id: t.id,
      name: t.englishName || t.name || t.id,
      language: (t.language || 'xx').slice(0, 2),
      languageName: t.languageEnglishName || '',
      helloaoId: t.id,
      online: true
    }))
  } catch {
    return []
  }
}

// Fallback: fetch one chapter from HelloAO and adapt it to our shape.
// HelloAO chapter endpoint returns { chapter: { content: [ { type:'verse', number, content:[...] }, ... ] } }.
async function loadHelloaoChapter(helloaoId, bookId, chapter) {
  const res = await fetch(`${HELLOAO}/${helloaoId}/${bookId}/${chapter}.json`)
  if (!res.ok) return null
  const data = await res.json()
  const items = data?.chapter?.content || []
  const verses = []
  for (const item of items) {
    if (item.type !== 'verse') continue
    const text = (item.content || [])
      .map((c) => (typeof c === 'string' ? c : c?.text || ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    verses[item.number - 1] = text
  }
  return verses
}

// Return the book object { id, name, chapters } for a version, or null.
async function getBook(version, bookId) {
  const key = `${version.id}/${bookId}`
  if (bookCache.has(key)) return bookCache.get(key)
  let book = await loadBundledBook(version.id, bookId)
  if (book) {
    bookCache.set(key, book)
    return book
  }
  if (version.helloaoId) {
    // Lazy per-chapter book: chapters filled on demand.
    book = { id: bookId, name: bookId, chapters: [], helloaoId: version.helloaoId }
    bookCache.set(key, book)
    return book
  }
  return null
}

async function getChapterVerses(version, book, bookId, chapter) {
  const bundled = book.chapters?.[chapter - 1]
  if (bundled) return bundled
  if (book.helloaoId) {
    const verses = await loadHelloaoChapter(book.helloaoId, bookId, chapter)
    if (verses) book.chapters[chapter - 1] = verses
    return verses
  }
  return null
}

// Given a parsed reference and a version, return
// { bookName, reference, startChapter, verses: [{ n, text, c, label }] } or throws
// with a clear message. Verses are gathered across the chapter span; each carries
// its chapter `c` and a `label` (bare "n" in the first chapter, "c:n" after a
// boundary) so the congregation always knows where they are.
export async function getPassage(version, ref) {
  const book = await getBook(version, ref.bookId)
  if (!book) throw new Error(`${version.name} does not include that book.`)

  const bookName = book.name || ref.bookName
  const startChapter = ref.chapter
  const endChapter = ref.endChapter && ref.endChapter >= startChapter ? ref.endChapter : startChapter

  const verses = []
  for (let c = startChapter; c <= endChapter; c++) {
    const chapterVerses = await getChapterVerses(version, book, ref.bookId, c)
    if (!chapterVerses || chapterVerses.length === 0) {
      // A missing start chapter is an error; running past the book's last chapter
      // just ends the span.
      if (c === startChapter) throw new Error(`${bookName} has no chapter ${c}.`)
      break
    }
    const total = chapterVerses.length
    let start = c === startChapter ? (ref.verseStart ?? 1) : 1
    let end = c === endChapter ? (ref.verseEnd ?? total) : total
    start = Math.max(1, Math.min(start, total))
    end = Math.max(start, Math.min(end, total))
    for (let n = start; n <= end; n++) {
      const text = chapterVerses[n - 1]
      if (text != null && text !== '') {
        verses.push({ n, text, c, label: c === startChapter ? String(n) : `${c}:${n}` })
      }
    }
    if (verses.length > MAX_PASSAGE_VERSES) {
      throw new Error(`That range is too long to show as one passage (over ${MAX_PASSAGE_VERSES} verses). Split it into smaller pieces.`)
    }
  }

  const reference = formatRange(bookName, {
    bookId: ref.bookId,
    chapter: startChapter,
    verseStart: ref.verseStart ?? null,
    endChapter,
    verseEnd: ref.verseEnd ?? null
  })

  return { bookName, reference, startChapter, verses }
}
