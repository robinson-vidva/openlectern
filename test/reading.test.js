import { describe, it, expect } from 'vitest'
import { roleFor, rolesForPassage, roleForStep, cycleRole, normalizeReading, verseKey } from '../src/lib/reading.js'

const verses = (n) => Array.from({ length: n }, (_, i) => ({ n: i + 1, text: 'v' }))
const ref = { bookId: 'PSA', chapter: 23 }

describe('responsive reading roles', () => {
  it('is off by default and for unknown patterns', () => {
    expect(roleFor(undefined, { index: 0, total: 6 })).toBeNull()
    expect(roleFor({ pattern: 'bogus' }, { index: 0, total: 6 })).toBeNull()
    expect(normalizeReading({ pattern: 'bogus', roles: { a: 'nope' } })).toEqual({ pattern: 'off', roles: {} })
  })
  it('alternates leader and people by verse position', () => {
    const r = { pattern: 'alternate' }
    expect(rolesForPassage(r, ref, verses(5))).toEqual(['leader', 'people', 'leader', 'people', 'leader'])
  })
  it('reads the last verse together in the all-at-end pattern', () => {
    const r = { pattern: 'alternate-all' }
    expect(rolesForPassage(r, ref, verses(6))).toEqual(['leader', 'people', 'leader', 'people', 'leader', 'all'])
    expect(rolesForPassage(r, ref, verses(1))).toEqual(['leader']) // a lone verse is not "all at end"
  })
  it('a per-verse override wins over the pattern, keyed by the verse itself', () => {
    const r = { pattern: 'alternate', roles: { [verseKey('PSA', 23, 2)]: 'all' } }
    expect(rolesForPassage(r, ref, verses(3))).toEqual(['leader', 'all', 'leader'])
    // Across a chapter boundary the verse's own chapter is used.
    const cross = [{ n: 31, c: 1 }, { n: 1, c: 2 }]
    const r2 = { pattern: 'alternate', roles: { [verseKey('GEN', 2, 1)]: 'all' } }
    expect(rolesForPassage(r2, { bookId: 'GEN', chapter: 1 }, cross)).toEqual(['leader', 'all'])
  })
  it('step mode uses the verse position within the chosen passage', () => {
    const r = { pattern: 'alternate-all' }
    const step = (i, total) => roleForStep(r, { step: true, ref: { bookId: 'PSA', chapter: 23, verseStart: i + 1 }, verseIndex: i, verseTotal: total })
    expect(step(0, 6)).toBe('leader')
    expect(step(1, 6)).toBe('people')
    expect(step(5, 6)).toBe('all')
    expect(roleForStep(r, { step: false })).toBeNull()
  })
  it('cycles a verse through auto, leader, people, all and back to auto', () => {
    const k = verseKey('PSA', 23, 1)
    let r = { pattern: 'alternate', roles: {} }
    const seen = []
    for (let i = 0; i < 4; i++) {
      r = cycleRole(r, k)
      seen.push(r.roles[k] || 'auto')
    }
    expect(seen).toEqual(['leader', 'people', 'all', 'auto'])
    expect(r.roles).toEqual({})
  })
})
