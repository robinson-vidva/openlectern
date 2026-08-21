import { describe, it, expect } from 'vitest'
import { searchBooks } from '../src/lib/parseRef.js'

const ids = (q) => searchBooks(q).map((b) => b.id)

describe('searchBooks type-ahead', () => {
  it('prefix on canonical name, canonical order within tier', () => {
    const r = ids('jo')
    expect(r).toContain('JHN')
    expect(r).toContain('JON')
    expect(r).toContain('JOS')
    // Joshua (canonical 6th) comes before John (43rd) within the prefix tier
    expect(r.indexOf('JOS')).toBeLessThan(r.indexOf('JHN'))
  })
  it('exact name wins first slot', () => {
    expect(searchBooks('John')[0].id).toBe('JHN')
  })
  it('ordinal books via numeral or word', () => {
    expect(ids('1 co')[0]).toBe('1CO')
    expect(ids('first co')[0]).toBe('1CO')
    expect(ids('2 ti')[0]).toBe('2TI')
  })
  it('alias prefix matches', () => {
    expect(ids('philipp')).toContain('PHP')
    expect(ids('rev')).toContain('REV')
  })
  it('empty and unknown', () => {
    expect(searchBooks('')).toEqual([])
    expect(searchBooks('   ')).toEqual([])
    expect(ids('zzzz')).toEqual([])
  })
  it('respects the limit', () => {
    expect(searchBooks('a', 3).length).toBeLessThanOrEqual(3)
  })
})
