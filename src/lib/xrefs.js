// Cross-references (openbible.info, CC-BY). Per-book chunks are built by
// scripts/build-xrefs.mjs into public/xrefs/<BOOKID>.json = { "chapter:verse":
// ["Display Ref", ...] }, capped to the ~10 strongest per verse. Loaded lazily
// per book, only when the operator opens the Related panel.
const BASE = import.meta.env.BASE_URL || '/'

export function xrefKey(chapter, verse) {
  return `${chapter}:${verse}`
}

// Pure lookup: the (already vote-capped) reference strings for one verse.
export function lookupXrefs(chunk, chapter, verse) {
  if (!chunk) return []
  return chunk[xrefKey(chapter, verse)] || []
}

const cache = new Map()

export async function loadXrefBook(bookId) {
  if (!bookId) return null
  if (cache.has(bookId)) return cache.get(bookId)
  const p = (async () => {
    try {
      const res = await fetch(`${BASE}xrefs/${bookId}.json`)
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  })()
  cache.set(bookId, p)
  // Don't let a transient failure poison the cache for the whole session: once a
  // fetch resolves to null (offline, not-yet-deployed), drop it so a later open of
  // the Related panel retries. Successful loads stay cached.
  p.then((r) => {
    if (r == null) cache.delete(bookId)
  })
  return p
}
