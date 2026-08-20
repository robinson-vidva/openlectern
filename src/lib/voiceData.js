import { getPassage } from './bibleData.js'

// A short preview of the first verse (primary translation) for a voice chip.
export async function resolvePreviewText(versions, cand) {
  const ref = { ...cand, verseEnd: cand.verseStart != null && cand.verseEnd == null ? cand.verseStart : cand.verseEnd }
  try {
    const p = await getPassage(versions[0], ref)
    const first = p.verses[0]?.text || ''
    return first.length > 60 ? first.slice(0, 60).trim() + '...' : first
  } catch {
    return ''
  }
}
