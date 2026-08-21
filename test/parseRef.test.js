import { describe, it, expect } from 'vitest'
import { parseReference, formatLabel } from '../src/lib/parseRef.js'

const r = (s) => parseReference(s)

describe('parseReference - single chapter (unchanged forms)', () => {
  it('single verse', () => {
    expect(r('John 3:16')).toMatchObject({ bookId: 'JHN', chapter: 3, verseStart: 16, endChapter: 3, verseEnd: 16 })
  })
  it('verse range in one chapter', () => {
    expect(r('John 3:16-18')).toMatchObject({ chapter: 3, verseStart: 16, endChapter: 3, verseEnd: 18 })
  })
  it('whole chapter', () => {
    expect(r('1 Cor 13')).toMatchObject({ bookId: '1CO', chapter: 13, verseStart: null, endChapter: 13, verseEnd: null })
  })
  it('abbreviations and ordinals', () => {
    expect(r('Psalm 23:1-6')).toMatchObject({ bookId: 'PSA', chapter: 23, verseStart: 1, verseEnd: 6 })
    expect(r('i john 4')).toMatchObject({ bookId: '1JN', chapter: 4 })
  })
  it('single-chapter books treat numbers as verses', () => {
    expect(r('Jude 5')).toMatchObject({ bookId: 'JUD', chapter: 1, verseStart: 5, endChapter: 1, verseEnd: 5 })
    expect(r('Jude 3-5')).toMatchObject({ chapter: 1, verseStart: 3, endChapter: 1, verseEnd: 5 })
  })
})

describe('parseReference - cross chapter', () => {
  it('whole-chapter range "Matthew 5-7"', () => {
    expect(r('Matthew 5-7')).toMatchObject({ bookId: 'MAT', chapter: 5, verseStart: null, endChapter: 7, verseEnd: null })
  })
  it('verse-to-verse across chapters "Genesis 1:1-2:3"', () => {
    expect(r('Genesis 1:1-2:3')).toMatchObject({ bookId: 'GEN', chapter: 1, verseStart: 1, endChapter: 2, verseEnd: 3 })
  })
  it('start verse to end chapter:verse "Matt 5:3-7:29"', () => {
    expect(r('Matt 5:3-7:29')).toMatchObject({ chapter: 5, verseStart: 3, endChapter: 7, verseEnd: 29 })
  })
  it('psalm chapter range "Psalm 22-24"', () => {
    expect(r('Psalm 22-24')).toMatchObject({ bookId: 'PSA', chapter: 22, verseStart: null, endChapter: 24, verseEnd: null })
  })
  it('backwards end chapter clamps to start', () => {
    expect(r('Psalm 24-22')).toMatchObject({ chapter: 24, endChapter: 24 })
  })
})

describe('parseReference - negatives', () => {
  it('no chapter number', () => {
    expect(r('Genesis')).toBeNull()
    expect(r('the prodigal son')).toBeNull()
  })
  it('unknown book', () => {
    expect(r('Hesitations 3:1')).toBeNull()
  })
  it('empty', () => {
    expect(r('')).toBeNull()
  })
})

describe('formatLabel round-trips', () => {
  const cases = ['John 3:16', 'John 3:16-18', 'Matthew 5-7', 'Genesis 1:1-2:3', 'Psalms 22-24']
  for (const c of cases) {
    it(c, () => {
      expect(formatLabel(r(c))).toBe(c)
    })
  }
  it('whole chapter and single-chapter book', () => {
    expect(formatLabel(r('1 Corinthians 13'))).toBe('1 Corinthians 13')
    expect(formatLabel(r('Jude 3-5'))).toBe('Jude 1:3-5')
  })
})
