// Verse loading. Bundled static JSON first; HelloAO API as a runtime fallback.
// Bundled shape: public/bibles/<versionId>/<BOOKID>.json =
//   { id, name, chapters: [ ["v1 text", "v2 text", ...], ... ] }

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

async function loadBundledBook(versionId, bookId) {
  const res = await fetch(`${BASE}bibles/${versionId}/${bookId}.json`)
  if (!res.ok) return null
  return res.json()
}

// Per-chapter verse counts for a bundled version (voice detection validation).
export async function loadStructure(versionId) {
  const res = await fetch(`${BASE}bibles/${versionId}/structure.json`)
  if (!res.ok) return null
  return res.json()
}

// Book list for a bundled version: [{ id, name, chapters }]. Used for the
// localized (e.g. Tamil) book names the voice matcher needs.
export async function loadIndex(versionId) {
  const res = await fetch(`${BASE}bibles/${versionId}/index.json`)
  if (!res.ok) return null
  return res.json()
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
// { bookName, reference, verses: [{ n, text }] } or throws with a clear message.
export async function getPassage(version, ref) {
  const book = await getBook(version, ref.bookId)
  if (!book) throw new Error(`${version.name} does not include that book.`)

  const chapterVerses = await getChapterVerses(version, book, ref.bookId, ref.chapter)
  if (!chapterVerses || chapterVerses.length === 0) {
    throw new Error(`${book.name || ref.bookName} has no chapter ${ref.chapter}.`)
  }

  const total = chapterVerses.length
  let start = ref.verseStart ?? 1
  let end = ref.verseEnd ?? total
  start = Math.max(1, Math.min(start, total))
  end = Math.max(start, Math.min(end, total))

  const verses = []
  for (let n = start; n <= end; n++) {
    const text = chapterVerses[n - 1]
    if (text != null && text !== '') verses.push({ n, text })
  }

  const bookName = book.name || ref.bookName
  const wholeChapter = ref.verseStart == null
  const reference = wholeChapter
    ? `${bookName} ${ref.chapter}`
    : start === end
      ? `${bookName} ${ref.chapter}:${start}`
      : `${bookName} ${ref.chapter}:${start}-${end}`

  return { bookName, reference, verses }
}
