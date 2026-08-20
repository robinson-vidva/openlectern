import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectRefs, buildBookIndex } from '../../src/lib/voice/detectRefs.js'
import { FIXTURES, TAMIL_FIXTURES } from './fixtures.js'

const structure = JSON.parse(readFileSync('public/bibles/eng-web/structure.json', 'utf-8'))
const tamilIdx = JSON.parse(readFileSync('public/bibles/tam_irv/index.json', 'utf-8'))
const tamilNames = Object.fromEntries(tamilIdx.map((b) => [b.id, b.name]))
const bookIndex = buildBookIndex(structure, tamilNames)

function check(cases) {
  for (const c of cases) {
    it(`${c.text}`, () => {
      const res = detectRefs(c.text, bookIndex)
      if (c.expect === null) {
        expect(res, `expected no detection, got ${JSON.stringify(res[0])}`).toHaveLength(0)
        return
      }
      expect(res.length, 'expected a detection').toBeGreaterThan(0)
      const top = res[0]
      expect(top.bookId).toBe(c.expect.bookId)
      expect(top.chapter).toBe(c.expect.chapter)
      expect(top.verseStart ?? null).toBe(c.expect.verseStart)
      expect(top.verseEnd ?? null).toBe(c.expect.verseEnd)
    })
  }
}

describe('detectRefs (English)', () => check(FIXTURES))
describe('detectRefs (Tamil)', () => check(TAMIL_FIXTURES))

describe('confidence tiers for AUTO mode', () => {
  it('exact book + valid verse is high confidence', () => {
    expect(detectRefs('John 3 16', bookIndex)[0].confidence).toBe('high')
  })
  it('chapter-only is not high confidence', () => {
    expect(detectRefs('Psalm 23', bookIndex)[0].confidence).toBe('medium')
  })
  it('homophone book is not high confidence', () => {
    expect(detectRefs('revelations 22 21', bookIndex)[0].confidence).toBe('medium')
  })
})
