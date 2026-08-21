import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseReference } from '../src/lib/parseRef.js'
import { getPassage } from '../src/lib/bibleData.js'
import { wholeCurrent, passagePages } from '../src/lib/resolve.js'

// Serve bundled JSON from public/ so getPassage's fetch works in node.
const ROOT = process.cwd()
let realFetch
beforeAll(() => {
  realFetch = global.fetch
  global.fetch = async (url) => {
    const s = String(url)
    const i = s.indexOf('/bibles/')
    if (i === -1) return { ok: false, status: 404 }
    const rel = s.slice(i + 1) // "bibles/eng-web/MAT.json"
    try {
      const data = JSON.parse(readFileSync(join(ROOT, 'public', rel), 'utf8'))
      return { ok: true, status: 200, json: async () => data }
    } catch {
      return { ok: false, status: 404 }
    }
  }
})
afterAll(() => {
  global.fetch = realFetch
})

const WEB = { id: 'eng-web', name: 'World English Bible', language: 'en' }

describe('getPassage across chapter boundaries', () => {
  it('gathers verses across chapters with chapter-aware labels', async () => {
    const p = await getPassage(WEB, parseReference('Matthew 5-7'))
    expect(p.reference).toBe('Matthew 5-7')
    expect(p.startChapter).toBe(5)
    // first chapter verses are bare numbers, later chapters are "c:n"
    expect(p.verses[0]).toMatchObject({ c: 5, n: 1, label: '1' })
    const ch6 = p.verses.find((v) => v.c === 6 && v.n === 1)
    expect(ch6.label).toBe('6:1')
    const ch7 = p.verses.find((v) => v.c === 7)
    expect(ch7).toBeTruthy()
    // Matthew 5 (48) + 6 (34) + 7 (29) = 111 verses
    expect(p.verses.length).toBe(111)
  })

  it('handles verse-to-verse across a boundary "Genesis 1:1-2:3"', async () => {
    const p = await getPassage(WEB, parseReference('Genesis 1:1-2:3'))
    expect(p.reference).toBe('Genesis 1:1-2:3')
    expect(p.verses[0]).toMatchObject({ c: 1, n: 1 })
    const last = p.verses[p.verses.length - 1]
    expect(last).toMatchObject({ c: 2, n: 3, label: '2:3' })
    // Genesis 1 (31) + Genesis 2:1-3 (3) = 34
    expect(p.verses.length).toBe(34)
  })

  it('paginates across chapters (long span makes multiple pages)', async () => {
    const p = await getPassage(WEB, parseReference('Matthew 5-7'))
    const cur = wholeCurrent([{ version: WEB, bookName: p.bookName, reference: p.reference, verses: p.verses }], parseReference('Matthew 5-7'))
    const pages = passagePages(cur)
    expect(pages.length).toBeGreaterThan(1)
    // pages cover every verse index in order, no gaps
    const flat = pages.flat()
    expect(flat).toEqual(flat.slice().sort((a, b) => a - b))
    expect(flat.length).toBe(p.verses.length)
  })

  it('refuses an over-long span (guardrail)', async () => {
    await expect(getPassage(WEB, parseReference('Genesis 1-50'))).rejects.toThrow(/too long/)
  })
})
