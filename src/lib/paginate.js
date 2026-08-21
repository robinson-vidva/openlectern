// Presenter legibility tuning. Both are deliberately easy to adjust.
// MIN_FONT_VMIN: the verse font never auto-shrinks below this (in vmin units),
//   chosen so scripture stays readable from the back of a hall.
// PAGE_CAPACITY: approximate combined characters (both languages) that fit one
//   page at the floor size. Lower = more pages / safer against overflow.
export const MIN_FONT_VMIN = 3.4
export const PAGE_CAPACITY = 1000

// Guardrail: the most verses one queue item / shown passage may span, so a
// range like "Genesis 1-50" is refused with a clear message instead of building
// a 1500-verse item. Tunable.
export const MAX_PASSAGE_VERSES = 400

// Greedy pagination on verse boundaries. weights[i] is a verse's size cost.
// Returns pages, each an array of verse indices. Never splits a verse, produces
// no empty pages, and puts a single over-capacity verse on its own page.
export function paginate(weights, capacity) {
  const pages = []
  let cur = []
  let sum = 0
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]
    if (cur.length && sum + w > capacity) {
      pages.push(cur)
      cur = []
      sum = 0
    }
    cur.push(i)
    sum += w
  }
  if (cur.length) pages.push(cur)
  return pages
}

// Which page holds a given verse index.
export function pageOfVerse(pages, verseIndex) {
  for (let p = 0; p < pages.length; p++) {
    if (pages[p].includes(verseIndex)) return p
  }
  return 0
}
