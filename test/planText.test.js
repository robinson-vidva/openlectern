import { describe, it, expect } from 'vitest'
import { extractReferences } from '../src/lib/planText.js'

const labels = (t) => extractReferences(t).map((r) => r.label)

describe('extractReferences', () => {
  it('comma-separated list', () => {
    expect(labels('Psalm 100, John 3:16-21, Romans 8:28-30')).toEqual([
      'Psalms 100',
      'John 3:16-21',
      'Romans 8:28-30'
    ])
  })
  it('one per line with labels', () => {
    const note = `Call to worship: Psalm 95\nSermon: John 3:16-21\nClosing: Revelation 22`
    expect(labels(note)).toEqual(['Psalms 95', 'John 3:16-21', 'Revelation 22'])
  })
  it('prose with "and" / "then"', () => {
    expect(labels('turn to John 3:16 and then Psalm 23')).toEqual(['John 3:16', 'Psalms 23'])
  })
  it('cross-chapter and ordinal books', () => {
    expect(labels('Matthew 5-7; 1 Corinthians 13; 2 Timothy 2:1-7')).toEqual([
      'Matthew 5-7',
      '1 Corinthians 13',
      '2 Timothy 2:1-7'
    ])
  })
  it('multi-word book names', () => {
    expect(labels('Song of Solomon 2:1, Acts 2:38')).toEqual(['Song of Songs 2:1', 'Acts 2:38'])
  })
  it('dedupes repeats', () => {
    expect(labels('John 3:16, John 3:16')).toEqual(['John 3:16'])
  })
  it('ignores non-references', () => {
    expect(labels('Welcome everyone, let us pray, offering time')).toEqual([])
    expect(labels('')).toEqual([])
  })
})
