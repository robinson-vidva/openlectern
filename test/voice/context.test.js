import { describe, it, expect } from 'vitest'
import { growContext } from '../../src/lib/voice/context.js'
import { detectRefs, buildBookIndex } from '../../src/lib/voice/detectRefs.js'
import { readFileSync } from 'node:fs'

const idx = buildBookIndex(JSON.parse(readFileSync('public/bibles/eng-web/structure.json', 'utf-8')), null)
const refs = (t) => detectRefs(t, idx).map((c) => c.ref)

describe('growContext', () => {
  it('appends and normalizes whitespace', () => {
    expect(growContext('look at John', 'three sixteen')).toBe('look at John three sixteen')
    expect(growContext('', '  Psalm   23 ')).toBe('Psalm 23')
    expect(growContext('a', '')).toBe('a')
  })
  it('keeps only the last maxWords words', () => {
    const many = Array.from({ length: 50 }, (_, i) => `w${i}`).join(' ')
    const out = growContext('', many, 32)
    expect(out.split(' ')).toHaveLength(32)
    expect(out.endsWith('w49')).toBe(true)
  })
})

describe('a reference split across recognition segments is recovered by the window', () => {
  it('"...John" then "three sixteen"', () => {
    // Each isolated segment detects nothing...
    expect(refs('let us look at John')).toEqual([])
    expect(refs('three sixteen')).toEqual([])
    // ...but the grown window sees the whole reference.
    const ctx = growContext('let us look at John', 'three sixteen')
    expect(refs(ctx)).toContain('John 3:16')
  })
  it('"Psalm ninety" then "one verse four" -> Psalm 91:4', () => {
    const ctx = growContext('Psalm ninety', 'one verse four')
    expect(refs(ctx)).toContain('Psalms 91:4')
  })
})

describe('multiple references in one utterance are all detected', () => {
  it('John 3:16 and Romans 8:28', () => {
    const got = refs('turn to John 3 16 and Romans 8 28')
    expect(got).toContain('John 3:16')
    expect(got).toContain('Romans 8:28')
  })
})
