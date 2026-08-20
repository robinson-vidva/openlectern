import { getPassage } from './bibleData.js'

// Resolve a parsed reference into per-version blocks of verse text, then shape
// the `current` object that gets written to state and rendered by the presenter.
export async function resolveCurrent(versions, parsed, index = -1) {
  const blocks = []
  for (const v of versions) {
    const p = await getPassage(v, parsed)
    blocks.push({
      versionId: v.id,
      language: v.language,
      reference: p.reference,
      verses: p.verses
    })
  }
  return {
    id: crypto.randomUUID(),
    index,
    reference: blocks[0]?.reference || '',
    primary: blocks[0] || null,
    secondary: blocks[1] || null
  }
}
