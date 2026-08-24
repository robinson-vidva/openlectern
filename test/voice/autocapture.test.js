import { describe, it, expect } from 'vitest'
import { shouldAutoShow, nextAutoMode, normalizeAutoMode, AUTO_MODES } from '../../src/lib/voice/autocapture.js'

const high = { confidence: 'high', exactBook: true, verseStart: 16 }
const exactChapter = { confidence: 'medium', exactBook: true, verseStart: null }
const fuzzyChapter = { confidence: 'medium', exactBook: false, verseStart: null }
const alias = { confidence: 'alias' }
const quote = { confidence: 'quote' }

describe('auto-capture policy', () => {
  it('off never auto-shows anything', () => {
    for (const c of [high, exactChapter, fuzzyChapter, alias, quote]) {
      expect(shouldAutoShow(c, 'off')).toBe(false)
    }
  })

  it('verse mode shows high-confidence citations only', () => {
    expect(shouldAutoShow(high, 'verse')).toBe(true)
    expect(shouldAutoShow(exactChapter, 'verse')).toBe(false) // chapter-only stays tap-only
    expect(shouldAutoShow(fuzzyChapter, 'verse')).toBe(false)
  })

  it('chapter mode also shows an announced whole chapter from an exact book', () => {
    expect(shouldAutoShow(high, 'chapter')).toBe(true)
    expect(shouldAutoShow(exactChapter, 'chapter')).toBe(true)
    expect(shouldAutoShow(fuzzyChapter, 'chapter')).toBe(false) // homophone book never auto
  })

  it('quotes and aliases never auto-show via this policy', () => {
    expect(shouldAutoShow(alias, 'verse')).toBe(false)
    expect(shouldAutoShow(alias, 'chapter')).toBe(false)
    expect(shouldAutoShow(quote, 'chapter')).toBe(false)
  })

  it('nextAutoMode cycles off -> verse -> chapter -> off', () => {
    expect(nextAutoMode('off')).toBe('verse')
    expect(nextAutoMode('verse')).toBe('chapter')
    expect(nextAutoMode('chapter')).toBe('off')
  })

  it('normalizeAutoMode coerces unknown values to off', () => {
    expect(normalizeAutoMode('nonsense')).toBe('off')
    expect(normalizeAutoMode(undefined)).toBe('off')
    for (const m of AUTO_MODES) expect(normalizeAutoMode(m)).toBe(m)
  })

  it('guards against a null candidate', () => {
    expect(shouldAutoShow(null, 'chapter')).toBe(false)
  })
})
