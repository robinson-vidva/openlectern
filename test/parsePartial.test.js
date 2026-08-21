import { describe, it, expect } from 'vitest'
import { parsePartialRef } from '../src/lib/parseRef.js'

const p = (s) => {
  const r = parsePartialRef(s)
  return r && { book: r.book.id, chapter: r.chapter, colon: r.hasColon, verse: r.verse }
}

describe('parsePartialRef (chapter/verse type-ahead)', () => {
  it('book only', () => {
    expect(p('John')).toEqual({ book: 'JHN', chapter: null, colon: false, verse: null })
    expect(p('Song of Solomon')).toEqual({ book: 'SNG', chapter: null, colon: false, verse: null })
  })
  it('book + chapter', () => {
    expect(p('John 3')).toEqual({ book: 'JHN', chapter: 3, colon: false, verse: null })
    expect(p('1 John 3')).toEqual({ book: '1JN', chapter: 3, colon: false, verse: null })
  })
  it('book + chapter + colon (verse stage)', () => {
    expect(p('John 3:')).toEqual({ book: 'JHN', chapter: 3, colon: true, verse: null })
  })
  it('full', () => {
    expect(p('John 3:16')).toEqual({ book: 'JHN', chapter: 3, colon: true, verse: 16 })
  })
  it('ordinal words', () => {
    expect(p('first corinthians 13')).toEqual({ book: '1CO', chapter: 13, colon: false, verse: null })
  })
  it('unknown / empty', () => {
    expect(p('')).toBeNull()
    expect(p('Hesperus 3')).toBeNull()
  })
})
