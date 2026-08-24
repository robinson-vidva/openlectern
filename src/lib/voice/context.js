// Rolling transcript context for reference detection.
//
// Speech recognition finalizes text in segments, and it often splits a single
// spoken reference across a segment boundary -- "...look at John" arrives, then
// "three sixteen" arrives separately. Detected in isolation, each half yields
// nothing and the reference is lost. Keeping a short window of the most recent
// words and detecting across the whole window reassembles such references.
//
// The window is bounded to the last `maxWords` words so it can't grow without
// limit and so a reference from a minute ago doesn't keep re-matching.
export function growContext(prev, text, maxWords = 32) {
  const words = `${prev || ''} ${text || ''}`
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  return words.slice(-maxWords).join(' ')
}
