import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeIndex, scanWindow } from '../../src/lib/quote/quoteIndex.js'
import { normalizeTokens } from '../../src/lib/quote/shingle.js'

const ROOT = process.cwd()
function loadIndex(versionId) {
  const meta = JSON.parse(readFileSync(join(ROOT, 'public', 'quoteidx', `${versionId}.json`), 'utf8'))
  const buf = readFileSync(join(ROOT, 'public', 'quoteidx', `${versionId}.bin`))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return decodeIndex(ab, meta)
}
function loadBook(versionId, bookId) {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'bibles', versionId, `${bookId}.json`), 'utf8'))
}

let web, tam
const bookCache = new Map()
function verse(versionId, bookId, ch, v) {
  const key = `${versionId}/${bookId}`
  if (!bookCache.has(key)) bookCache.set(key, loadBook(versionId, bookId))
  return bookCache.get(key).chapters[ch - 1][v - 1]
}
beforeAll(() => {
  web = loadIndex('eng-web')
  tam = loadIndex('tam_irv')
})

const scan = (index, text) => scanWindow(index, normalizeTokens(text))
const top = (index, text) => {
  const r = scan(index, text)
  return r[0] ? `${r[0].bookId} ${r[0].chapter}:${r[0].verse}` : null
}

// Verbatim WEB verses (both testaments) that should each detect themselves.
const VERBATIM = [
  ['JHN', 3, 16], ['GEN', 1, 1], ['PSA', 23, 1], ['PSA', 23, 4], ['ROM', 8, 28],
  ['PHP', 4, 13], ['JHN', 11, 25], ['MAT', 5, 9], ['PRO', 3, 5], ['ISA', 40, 31],
  ['ACT', 2, 38], ['JHN', 14, 6]
]

describe('quote detection - verbatim', () => {
  for (const [b, c, v] of VERBATIM) {
    it(`${b} ${c}:${v} verbatim`, () => {
      expect(top(web, verse('eng-web', b, c, v))).toBe(`${b} ${c}:${v}`)
    })
  }
})

describe('quote detection - near-verbatim', () => {
  it('one word changed still matches', () => {
    const t = verse('eng-web', 'JHN', 3, 16).replace('world', 'earth')
    expect(top(web, t)).toBe('JHN 3:16')
  })
  it('one word dropped still matches', () => {
    const words = normalizeTokens(verse('eng-web', 'ROM', 8, 28))
    words.splice(5, 1) // drop a middle word
    expect(top(web, words.join(' '))).toBe('ROM 8:28')
  })
  it('leading filler before the quote still matches', () => {
    expect(top(web, 'you know as paul reminds us ' + verse('eng-web', 'PHP', 4, 13))).toBe('PHP 4:13')
  })
})

describe('quote detection - crossing a segment boundary', () => {
  it('neither half fires alone; the joined window does', () => {
    const text = verse('eng-web', 'JHN', 3, 16)
    const words = normalizeTokens(text)
    const first = words.slice(0, 4).join(' ')
    const second = words.slice(4).join(' ')
    expect(scan(web, first)).toHaveLength(0) // 4 words = 1 shingle, below threshold
    // rolling window = both segments joined
    expect(top(web, first + ' ' + second)).toBe('JHN 3:16')
  })
})

describe('quote detection - Tamil verbatim', () => {
  // Tamil is agglutinative, so a verse has fewer whitespace tokens than its
  // English counterpart; very short verses (e.g. Genesis 1:1) cannot reach the
  // word-count threshold. These are long enough to detect.
  const TAMIL = [
    ['JHN', 3, 16], ['PSA', 23, 1], ['ISA', 40, 31], ['ROM', 8, 28], ['PHP', 4, 13]
  ]
  for (const [b, c, v] of TAMIL) {
    it(`${b} ${c}:${v} Tamil verbatim`, () => {
      expect(top(tam, verse('tam_irv', b, c, v))).toBe(`${b} ${c}:${v}`)
    })
  }
})

describe('quote detection - negatives (must not fire)', () => {
  const NEG = [
    'in the beginning', // 3 words, no shingle
    'do not be afraid', // common short phrase alone
    'let us pray together this morning for our church family',
    'turn with me in your bibles to the book we are studying',
    'good morning everyone it is wonderful to see you all here today',
    'the weather has been lovely this week and i hope you are well',
    'i want to share three points from my heart with you this evening',
    'and so we come to the end of our time together today'
  ]
  for (const t of NEG) {
    it(JSON.stringify(t.slice(0, 30)), () => {
      expect(scan(web, t)).toHaveLength(0)
    })
  }
})

describe('quote detection - performance', () => {
  it('lookup per window is well under 50ms', () => {
    const text = 'as the psalmist writes ' + verse('eng-web', 'PSA', 23, 1) + ' ' + verse('eng-web', 'PSA', 23, 2)
    const tokens = normalizeTokens(text).slice(-20)
    const N = 200
    const t0 = performance.now()
    for (let i = 0; i < N; i++) scanWindow(web, tokens)
    const per = (performance.now() - t0) / N
    // eslint-disable-next-line no-console
    console.log(`quote scan: ${per.toFixed(3)} ms/window (avg of ${N})`)
    expect(per).toBeLessThan(50)
  })
})
