import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { detectRefs, buildBookIndex, continuationText, pickBestTranscript } from '../../src/lib/voice/detectRefs.js'

const idx = buildBookIndex(JSON.parse(readFileSync('public/bibles/eng-web/structure.json', 'utf-8')), null)
const top = (t) => detectRefs(t, idx)[0]

describe('continuationText (book carried from the last citation)', () => {
  const last = { bookName: 'John', chapter: 3 }
  it('bookless "verse N" continues the last book + chapter', () => {
    expect(continuationText('verse 16', last)).toBe('John 3 verse 16')
    expect(top(continuationText('verse 16', last))).toMatchObject({ bookId: 'JHN', chapter: 3, verseStart: 16 })
    expect(top(continuationText('verses 4 to 8', last))).toMatchObject({ bookId: 'JHN', chapter: 3, verseStart: 4, verseEnd: 8 })
  })
  it('"chapter N verse M" continues the book with a new chapter', () => {
    expect(continuationText('chapter 9 verse 1', last)).toBe('John chapter 9 verse 1')
    expect(top(continuationText('chapter 9 verse 1', last))).toMatchObject({ bookId: 'JHN', chapter: 9, verseStart: 1 })
  })
  it('does not continue without a verse/chapter keyword, or with no prior', () => {
    expect(continuationText('the door was open', last)).toBe(null)
    expect(continuationText('sixteen', last)).toBe(null)
    expect(continuationText('verse 16', null)).toBe(null)
  })
})

describe('pickBestTranscript (choose the alternative that parses)', () => {
  it('picks the alternative that yields a reference over a mangled top guess', () => {
    expect(pickBestTranscript(['have a cook 2 4', 'habakkuk 2 4'], idx)).toBe('habakkuk 2 4')
  })
  it('falls back to the top alternative when none parse', () => {
    expect(pickBestTranscript(['just talking', 'nothing here'], idx)).toBe('just talking')
  })
  it('is safe with a missing index or empty input', () => {
    expect(pickBestTranscript(['a', 'b'], null)).toBe('a')
    expect(pickBestTranscript([], idx)).toBe('')
  })
})

describe('spoken filler/connector patterns', () => {
  it('"and verse", "from verse ... to verse"', () => {
    expect(top('John chapter 3 and verse 16')).toMatchObject({ bookId: 'JHN', chapter: 3, verseStart: 16, verseEnd: null })
    expect(top('from John 3 verse 4 to verse 8')).toMatchObject({ bookId: 'JHN', chapter: 3, verseStart: 4, verseEnd: 8 })
    expect(top('John 3 from verse 4 to 8')).toMatchObject({ bookId: 'JHN', chapter: 3, verseStart: 4, verseEnd: 8 })
  })
})
