import { describe, it, expect } from 'vitest'
import { BUILTIN_LITURGY, searchLiturgy, parseLiturgyText, liturgyToText, liturgyCurrent, liturgyById, isResponsive } from '../src/lib/liturgy.js'

describe('built-in liturgy', () => {
  it('has the core items with unique ids and non-empty lines', () => {
    const ids = BUILTIN_LITURGY.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const want of ['lords-prayer', 'apostles-creed', 'nicene-creed', 'gloria-patri', 'doxology', 'kyrie']) expect(ids).toContain(want)
    for (const it of BUILTIN_LITURGY) {
      expect(it.title).toBeTruthy()
      expect(it.lines.length).toBeGreaterThan(0)
      for (const l of it.lines) expect(l.text.trim()).toBe(l.text)
    }
  })
  it('finds items by title words and keywords', () => {
    expect(searchLiturgy([], 'nicene')[0].id).toBe('nicene-creed')
    expect(searchLiturgy([], 'creed').map((i) => i.id)).toEqual(expect.arrayContaining(['apostles-creed', 'nicene-creed']))
    expect(searchLiturgy([], 'our father')[0].id).toBe('lords-prayer')
    expect(searchLiturgy([], 'xyzzy')).toEqual([])
  })
  it('custom items come first and win a lookup by id', () => {
    const custom = [{ id: 'custom-1', title: 'Our Creed', lines: [{ text: 'x' }] }]
    expect(liturgyById(custom, 'custom-1').custom).toBe(true)
    expect(searchLiturgy(custom, 'creed')[0].id).toBe('custom-1')
  })
})

describe('typed liturgy text', () => {
  it('parses role prefixes and skips blank lines', () => {
    const lines = parseLiturgyText('L: The Lord be with you.\n\nP: And also with you.\nAll: Amen.\nplain line\nCongregation: response')
    expect(lines).toEqual([
      { text: 'The Lord be with you.', role: 'leader' },
      { text: 'And also with you.', role: 'people' },
      { text: 'Amen.', role: 'all' },
      { text: 'plain line' },
      { text: 'response', role: 'people' }
    ])
    expect(liturgyToText(lines)).toBe('L: The Lord be with you.\nP: And also with you.\nAmen.\nplain line\nP: response')
  })
})

describe('liturgy on screen', () => {
  it('builds a unison display object with no verse numbers', () => {
    const cur = liturgyCurrent(liturgyById([], 'lords-prayer'))
    expect(cur.liturgy).toBe('lords-prayer')
    expect(cur.reference).toBe("The Lord's Prayer")
    expect(cur.ref).toBeNull()
    expect(cur.unison).toBe(true)
    expect(cur.primary.verses[0].label).toBe('')
    expect(cur.pageCount).toBeGreaterThanOrEqual(1)
    expect(cur.secondary).toBeNull()
  })
  it('keeps leader/people roles for a responsive text and a second language', () => {
    const kyrie = liturgyById([], 'kyrie')
    expect(isResponsive(kyrie)).toBe(true)
    const cur = liturgyCurrent({ ...kyrie, lines2: kyrie.lines.map((l) => ({ text: 'த' })), lang2: 'ta' })
    expect(cur.unison).toBe(false)
    expect(cur.roles).toEqual(['leader', 'people', 'leader', 'people', 'leader', 'people'])
    expect(cur.secondary.language).toBe('ta')
    expect(cur.secondary.verses).toHaveLength(6)
  })
})
