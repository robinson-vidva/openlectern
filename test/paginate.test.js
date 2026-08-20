import { describe, it, expect } from 'vitest'
import { paginate, pageOfVerse } from '../src/lib/paginate.js'

describe('paginate', () => {
  it('breaks on verse boundaries, filling to capacity', () => {
    // weights 4,4,4,4,4 with capacity 10 -> [4,4],[4,4],[4]
    const pages = paginate([4, 4, 4, 4, 4], 10)
    expect(pages).toEqual([
      [0, 1],
      [2, 3],
      [4]
    ])
  })

  it('never splits a verse and produces no empty pages', () => {
    const pages = paginate([3, 3, 3, 3], 6)
    expect(pages).toEqual([
      [0, 1],
      [2, 3]
    ])
    for (const p of pages) expect(p.length).toBeGreaterThan(0)
  })

  it('puts an over-capacity verse on its own page (never split)', () => {
    // a huge verse (20) with capacity 10, surrounded by small ones
    const pages = paginate([4, 20, 4], 10)
    expect(pages).toEqual([[0], [1], [2]])
  })

  it('handles all-huge verses (each alone)', () => {
    const pages = paginate([50, 60, 70], 10)
    expect(pages).toEqual([[0], [1], [2]])
  })

  it('single verse -> one page', () => {
    expect(paginate([5], 10)).toEqual([[0]])
    expect(paginate([500], 10)).toEqual([[0]])
  })

  it('empty passage -> no pages', () => {
    expect(paginate([], 10)).toEqual([])
  })

  it('fits everything on one page when under capacity', () => {
    expect(paginate([2, 2, 2], 100)).toEqual([[0, 1, 2]])
  })

  it('dual-language sync: combined weights drive the same page breaks', () => {
    // primary lens 5,5,5,5 + secondary 5,5,5,5 -> combined 10 each, capacity 20
    const primary = [5, 5, 5, 5]
    const secondary = [5, 5, 5, 5]
    const combined = primary.map((w, i) => w + secondary[i])
    const pages = paginate(combined, 20)
    // both languages page identically because they share these boundaries
    expect(pages).toEqual([
      [0, 1],
      [2, 3]
    ])
  })

  it('pageOfVerse finds the containing page', () => {
    const pages = [
      [0, 1],
      [2, 3],
      [4]
    ]
    expect(pageOfVerse(pages, 0)).toBe(0)
    expect(pageOfVerse(pages, 3)).toBe(1)
    expect(pageOfVerse(pages, 4)).toBe(2)
    expect(pageOfVerse(pages, 99)).toBe(0)
  })
})
