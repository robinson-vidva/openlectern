import { describe, it, expect } from 'vitest'
import { xrefKey, lookupXrefs } from '../src/lib/xrefs.js'
import { parseReference } from '../src/lib/parseRef.js'
import john from '../public/xrefs/JHN.json'
import gen from '../public/xrefs/GEN.json'

describe('xref lookup (pure)', () => {
  const chunk = { '3:16': ['Romans 5:8', 'John 3:36'], '1:1': ['Genesis 1:1'] }

  it('keys chapter:verse', () => {
    expect(xrefKey(3, 16)).toBe('3:16')
  })

  it('returns the list for a present verse', () => {
    expect(lookupXrefs(chunk, 3, 16)).toEqual(['Romans 5:8', 'John 3:36'])
  })

  it('returns [] for a missing verse or chunk', () => {
    expect(lookupXrefs(chunk, 9, 9)).toEqual([])
    expect(lookupXrefs(null, 3, 16)).toEqual([])
  })
})

describe('generated chunks', () => {
  it('caps every verse at 10 references', () => {
    for (const list of Object.values(john)) expect(list.length).toBeLessThanOrEqual(10)
    for (const list of Object.values(gen)) expect(list.length).toBeLessThanOrEqual(10)
  })

  it('John 3:16 has plausible, parseable cross-references', () => {
    const refs = lookupXrefs(john, 3, 16)
    expect(refs.length).toBeGreaterThan(3)
    expect(refs).toContain('Romans 5:8')
    for (const r of refs) expect(parseReference(r), r).not.toBeNull()
  })

  it('Genesis 1:1 references are all parseable', () => {
    const refs = lookupXrefs(gen, 1, 1)
    expect(refs.length).toBeGreaterThan(0)
    for (const r of refs) expect(parseReference(r), r).not.toBeNull()
  })
})
