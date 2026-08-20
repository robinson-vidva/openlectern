import { describe, it, expect } from 'vitest'
import { matchAliases, aliasData } from '../src/lib/aliases.js'
import { parseReference } from '../src/lib/parseRef.js'

const top = (q) => matchAliases(q)[0]?.name

describe('alias matching', () => {
  it('matches an exact canonical name', () => {
    expect(top('The Good Samaritan')).toBe('The Good Samaritan')
  })

  it('matches an exact alias phrasing', () => {
    expect(top('armor of god')).toBe('The Armor of God')
    expect(top('love chapter')).toBe('The Love Chapter')
  })

  it('matches inside a spoken sentence', () => {
    expect(top('show me the prodigal son')).toBe('The Prodigal Son')
    expect(top('can you pull up the fruit of the spirit')).toBe('The Fruit of the Spirit')
  })

  it('matches a distinctive partial word', () => {
    expect(top('prodigal')).toBe('The Prodigal Son')
    expect(top('gethsemane')).toBe('Gethsemane')
  })

  it('returns multiple hits for an ambiguous word, best-scored first', () => {
    const hits = matchAliases('samaritan')
    const names = hits.map((h) => h.name)
    expect(names.length).toBeGreaterThanOrEqual(2)
    expect(names).toContain('The Good Samaritan')
    expect(names).toContain('The Woman at the Well')
    // sorted by score descending
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score)
  })

  it('does not match generic or off-topic phrases', () => {
    expect(matchAliases('show the slides')).toEqual([])
    expect(matchAliases('the chapter i mentioned')).toEqual([])
    expect(matchAliases('next verse please')).toEqual([])
    expect(matchAliases('')).toEqual([])
  })

  it('carries resolvable references (single or multi)', () => {
    const lords = matchAliases('the lords prayer')[0]
    expect(lords.refs.length).toBeGreaterThanOrEqual(2)
    for (const r of lords.refs) expect(parseReference(r)).not.toBeNull()
  })

  it('respects the limit', () => {
    expect(matchAliases('the', aliasData, 3).length).toBeLessThanOrEqual(3)
  })
})

describe('alias data integrity', () => {
  it('has 100+ entries and every ref parses within a single chapter', () => {
    expect(aliasData.entries.length).toBeGreaterThanOrEqual(100)
    for (const e of aliasData.entries) {
      const refs = Array.isArray(e.ref) ? e.ref : [e.ref]
      expect(refs.length).toBeGreaterThan(0)
      for (const r of refs) expect(parseReference(r), `${e.name} -> ${r}`).not.toBeNull()
    }
  })

  it('has unique canonical names', () => {
    const names = aliasData.entries.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
