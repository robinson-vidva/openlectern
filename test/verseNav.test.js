import { describe, it, expect } from 'vitest'
import { nextVerse, prevVerse } from '../src/lib/verseNav.js'

// A tiny three-chapter book: ch1 has 3 verses, ch2 has 2, ch3 has 4.
const BOOK = [3, 2, 4]

describe('nextVerse', () => {
  it('steps within a chapter', () => {
    expect(nextVerse(BOOK, 1, 1)).toEqual({ chapter: 1, verse: 2 })
    expect(nextVerse(BOOK, 3, 2)).toEqual({ chapter: 3, verse: 3 })
  })
  it('crosses into the next chapter at a chapter end', () => {
    expect(nextVerse(BOOK, 1, 3)).toEqual({ chapter: 2, verse: 1 })
    expect(nextVerse(BOOK, 2, 2)).toEqual({ chapter: 3, verse: 1 })
  })
  it('returns null at the last verse of the book (book end)', () => {
    expect(nextVerse(BOOK, 3, 4)).toBeNull()
  })
  it('skips empty chapters when crossing', () => {
    expect(nextVerse([3, 0, 5], 1, 3)).toEqual({ chapter: 3, verse: 1 })
  })
  it('is null-safe for missing structure', () => {
    expect(nextVerse(null, 1, 1)).toBeNull()
    expect(nextVerse([], 1, 1)).toBeNull()
  })
})

describe('prevVerse', () => {
  it('steps back within a chapter', () => {
    expect(prevVerse(BOOK, 1, 3)).toEqual({ chapter: 1, verse: 2 })
    expect(prevVerse(BOOK, 3, 4)).toEqual({ chapter: 3, verse: 3 })
  })
  it('crosses to the previous chapter last verse at a chapter start', () => {
    expect(prevVerse(BOOK, 2, 1)).toEqual({ chapter: 1, verse: 3 })
    expect(prevVerse(BOOK, 3, 1)).toEqual({ chapter: 2, verse: 2 })
  })
  it('returns null at the first verse of the book (book start)', () => {
    expect(prevVerse(BOOK, 1, 1)).toBeNull()
  })
  it('skips empty chapters when crossing back', () => {
    expect(prevVerse([3, 0, 5], 3, 1)).toEqual({ chapter: 1, verse: 3 })
  })
  it('is null-safe for missing structure', () => {
    expect(prevVerse(null, 2, 1)).toBeNull()
    expect(prevVerse([], 2, 1)).toBeNull()
  })
})
