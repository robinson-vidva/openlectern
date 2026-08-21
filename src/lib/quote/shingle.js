// Shared text -> shingle primitives for quotation detection. Used identically by
// the build script (scripts/build-quote-index.mjs) and the runtime worker, so
// index and query normalize the same way. Pure, no DOM.

// Common English function words. A 4-gram made entirely of these carries no
// quotation signal, so it is skipped (both when building and when querying).
// Tamil has no stopword list here, so Tamil shingles are always kept.
export const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'to', 'in', 'is', 'it', 'its', 'that', 'this', 'for', 'on', 'with',
  'as', 'at', 'by', 'be', 'am', 'are', 'was', 'were', 'been', 'he', 'she', 'they', 'we', 'you', 'i',
  'him', 'her', 'them', 'us', 'his', 'hers', 'our', 'their', 'your', 'my', 'me', 'but', 'or', 'nor',
  'not', 'so', 'if', 'then', 'than', 'unto', 'shall', 'will', 'would', 'should', 'may', 'thou', 'thee',
  'thy', 'thine', 'ye', 'o', 'up', 'out', 'into', 'from', 'which', 'who', 'whom', 'whose', 'all', 'no',
  'yea', 'also', 'when', 'where', 'there', 'here', 'unto', 'let', 'do', 'did', 'done', 'have', 'has',
  'had', 'he', 'unto'
])

export const SHINGLE_K = 4

// Lowercase, keep ASCII letters/digits and the Tamil block, split on runs of
// anything else. Matches how a transcript is normalized at query time.
export function normalizeTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9஀-௿]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

// FNV-1a 32-bit hash of a string.
export function hash32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// k-word shingles as { h: hash, i: start-token-index }. Shingles that are all
// stopwords are dropped.
export function shinglesOf(tokens, k = SHINGLE_K) {
  const out = []
  for (let i = 0; i + k <= tokens.length; i++) {
    let allStop = true
    for (let j = 0; j < k; j++) {
      if (!STOPWORDS.has(tokens[i + j])) {
        allStop = false
        break
      }
    }
    if (allStop) continue
    out.push({ h: hash32(tokens.slice(i, i + k).join(' ')), i })
  }
  return out
}
