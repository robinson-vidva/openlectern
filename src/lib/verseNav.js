// Literal verse navigation within a single book.
//
// `chapters` is the structure array for a book: verse counts per chapter, index
// 0 = chapter 1 (e.g. Genesis -> [31, 25, 24, ...]). Both helpers step exactly
// one verse and cross chapter boundaries, but never leave the book: at the very
// last verse `nextVerse` returns null (book end) and at the very first verse
// `prevVerse` returns null (book start). Chapters with a zero count (missing in
// this translation) are skipped so stepping never lands on an empty chapter.

export function nextVerse(chapters, chapter, verse) {
  if (!Array.isArray(chapters) || !chapters.length) return null
  const vCount = chapters[chapter - 1] || 0
  if (verse < vCount) return { chapter, verse: verse + 1 }
  for (let ch = chapter + 1; ch <= chapters.length; ch++) {
    if ((chapters[ch - 1] || 0) > 0) return { chapter: ch, verse: 1 }
  }
  return null // book end
}

export function prevVerse(chapters, chapter, verse) {
  if (!Array.isArray(chapters) || !chapters.length) return null
  if (verse > 1) return { chapter, verse: verse - 1 }
  for (let ch = chapter - 1; ch >= 1; ch--) {
    const vc = chapters[ch - 1] || 0
    if (vc > 0) return { chapter: ch, verse: vc }
  }
  return null // book start
}
