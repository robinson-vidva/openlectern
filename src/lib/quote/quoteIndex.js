// Compact shingle-hash index for quotation detection, and the pure scan that
// runs against it. Binary layout (little-endian), matching build-quote-index.mjs:
//   [u32 keyCount][u32 locCount]
//   [keys:    u32 * keyCount]        sorted unique shingle hashes
//   [offsets: u32 * (keyCount+1)]    slice bounds into locs per key
//   [locs:    u32 * locCount]        packed verse locations, grouped by key
// A location packs (bookIdx << 16) | (chapter << 8) | verse.
import { shinglesOf, SHINGLE_K } from './shingle.js'

// A candidate needs a run of ~6 consecutive-ish matched words (3 back-to-back
// 4-grams), so liturgical commonplaces and short echoes never fire. Tunable.
export const MIN_MATCH_WORDS = 6
// Rolling window of recent transcript words (quotes cross segment boundaries).
export const WINDOW_WORDS = 20

export function packLoc(bookIdx, chapter, verse) {
  return ((bookIdx & 0xff) << 16) | ((chapter & 0xff) << 8) | (verse & 0xff)
}
export function unpackLoc(loc) {
  return { bookIdx: (loc >> 16) & 0xff, chapter: (loc >> 8) & 0xff, verse: loc & 0xff }
}

export function decodeIndex(buffer, meta) {
  const dv = new DataView(buffer)
  const keyCount = dv.getUint32(0, true)
  const locCount = dv.getUint32(4, true)
  let o = 8
  const keys = new Uint32Array(buffer, o, keyCount)
  o += keyCount * 4
  const offsets = new Uint32Array(buffer, o, keyCount + 1)
  o += (keyCount + 1) * 4
  const locs = new Uint32Array(buffer, o, locCount)
  return { keys, offsets, locs, books: meta.books, k: meta.k || SHINGLE_K }
}

// Locations for one hash, or null. Binary search over the sorted keys.
function lookup(index, h) {
  const { keys, offsets, locs } = index
  let lo = 0
  let hi = keys.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const v = keys[mid]
    if (v === h) return locs.subarray(offsets[mid], offsets[mid + 1])
    if (v < h) lo = mid + 1
    else hi = mid - 1
  }
  return null
}

// Longest run of covered word-indices, allowing a single one-word gap (a changed
// or dropped word leaves exactly one uncovered index). Returns the word span.
function longestRun(sorted) {
  if (!sorted.length) return 0
  let best = 1
  let start = sorted[0]
  let prev = sorted[0]
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k] - prev <= 2) {
      prev = sorted[k]
    } else {
      best = Math.max(best, prev - start + 1)
      start = sorted[k]
      prev = sorted[k]
    }
  }
  return Math.max(best, prev - start + 1)
}

// Scan a window of transcript tokens against the index. Returns verses whose
// matched-word run reaches MIN_MATCH_WORDS, strongest first:
// [{ bookId, chapter, verse, score }].
export function scanWindow(index, tokens) {
  const shs = shinglesOf(tokens, index.k)
  if (!shs.length) return []
  const covered = new Map() // loc -> Set(word index)
  for (const { h, i } of shs) {
    const locs = lookup(index, h)
    if (!locs) continue
    for (let li = 0; li < locs.length; li++) {
      const loc = locs[li]
      let set = covered.get(loc)
      if (!set) {
        set = new Set()
        covered.set(loc, set)
      }
      for (let w = i; w < i + index.k; w++) set.add(w)
    }
  }
  const results = []
  for (const [loc, set] of covered) {
    const span = longestRun([...set].sort((a, b) => a - b))
    if (span >= MIN_MATCH_WORDS) {
      const { bookIdx, chapter, verse } = unpackLoc(loc)
      results.push({ bookId: index.books[bookIdx], chapter, verse, score: span })
    }
  }
  results.sort((a, b) => b.score - a.score)
  return results
}
