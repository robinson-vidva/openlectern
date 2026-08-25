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
      if (c.expect.endChapter !== undefined) expect(top.endChapter ?? null).toBe(c.expect.endChapter)
    })
  }
}

describe('detectRefs (English)', () => check(FIXTURES))
describe('detectRefs (Tamil)', () => check(TAMIL_FIXTURES))

describe('trailing filler words do not swallow a chapter reference', () => {
  // "oh"/"o"/"zero" are common speech fillers. Previously a bare one right after a
  // chapter number parsed as verse 0 and got the whole candidate rejected.
  const fillerCases = [
    ['Genesis 1 oh', { bookId: 'GEN', chapter: 1 }],
    ['Psalm 23 oh', { bookId: 'PSA', chapter: 23 }],
    ['Psalm 23 o', { bookId: 'PSA', chapter: 23 }],
    ['Matthew 5 zero', { bookId: 'MAT', chapter: 5 }]
  ]
  for (const [text, exp] of fillerCases) {
    it(text, () => {
      const res = detectRefs(text, bookIndex)
      expect(res.length, 'expected a detection').toBeGreaterThan(0)
      expect(res[0].bookId).toBe(exp.bookId)
      expect(res[0].chapter).toBe(exp.chapter)
      expect(res[0].verseStart ?? null).toBe(null)
    })
  }
  it('still spells out digit sequences that legitimately contain zero', () => {
    // "one oh five" -> 105 must keep working (zero-word inside digit-spelling).
    const res = detectRefs('Psalm one oh five', bookIndex)
    expect(res.length).toBeGreaterThan(0)
    expect(res[0]).toMatchObject({ bookId: 'PSA', chapter: 105 })
  })
})

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

describe('ambiguity: offer both readings of a joined number', () => {
  it('"Mark 11" -> both Mark 11 (primary) and Mark 1:1, flagged ambiguous, none auto', () => {
    const res = detectRefs('Mark 11', bookIndex)
    const refs = res.map((c) => c.ref)
    expect(refs).toContain('Mark 11')
    expect(refs).toContain('Mark 1:1')
    // Whole-chapter reading stays primary (top-ranked).
    expect(res[0].ref).toBe('Mark 11')
    // Both are flagged ambiguous so auto-capture skips them.
    expect(res.every((c) => c.ambiguous)).toBe(true)
  })
  it('an explicit "chapter" keyword is unambiguous (no split)', () => {
    const res = detectRefs('Mark chapter 11', bookIndex)
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ bookId: 'MRK', chapter: 11, verseStart: null, ambiguous: false })
  })
  it('an explicit verse is unambiguous', () => {
    const res = detectRefs('Mark 11 verse 5', bookIndex)
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ bookId: 'MRK', chapter: 11, verseStart: 5 })
  })
  it('a spoken tens+ones number offers the natural split ("twenty one" -> 20:1)', () => {
    for (const text of ['Matthew 21', 'Matthew twenty one']) {
      const refs = detectRefs(text, bookIndex).map((c) => c.ref)
      expect(refs, text).toContain('Matthew 21') // primary (whole chapter)
      expect(refs, text).toContain('Matthew 20:1') // 20:1, not the digit split 2:1
      expect(refs, text).not.toContain('Matthew 2:1')
    }
  })
  it('an invalid chapter recovers via the natural split ("Matthew 29" -> 20:9)', () => {
    expect(detectRefs('Matthew 29', bookIndex)[0]).toMatchObject({ bookId: 'MAT', chapter: 20, verseStart: 9 })
  })
})
