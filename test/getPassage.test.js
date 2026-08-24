import { describe, it, expect, vi, afterEach } from 'vitest'
import { getPassage } from '../src/lib/bibleData.js'
import { parseReference } from '../src/lib/parseRef.js'

// An online-only (HelloAO) version: no bundled files, chapters fetched per-request.
const version = { id: 'test_online', name: 'Test Online', language: 'en', helloaoId: 'test_online' }

// Minimal HelloAO chapter body with `n` verses.
function chapterBody(n) {
  const content = Array.from({ length: n }, (_, i) => ({
    type: 'verse',
    number: i + 1,
    content: [`verse ${i + 1} text`]
  }))
  return { chapter: { content } }
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const notFound = () => ({ ok: false, status: 404, json: async () => ({}) })

afterEach(() => vi.unstubAllGlobals())

describe('getPassage cross-chapter loading over HelloAO', () => {
  it('surfaces a transient mid-span failure instead of silently truncating', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (url.includes('/bibles/')) return notFound() // not bundled
        if (url.endsWith('/MAT/5.json')) return ok(chapterBody(3))
        if (url.endsWith('/MAT/6.json')) throw new Error('network down') // transient
        return ok(chapterBody(3))
      })
    )
    const ref = parseReference('Matthew 5-7')
    await expect(getPassage(version, ref)).rejects.toThrow(/Could not load Matthew 6/)
  })

  it('a real 404 past the last chapter ends the span cleanly (no throw)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (url.includes('/bibles/')) return notFound()
        if (url.endsWith('/MAT/5.json')) return ok(chapterBody(3))
        if (url.endsWith('/MAT/6.json')) return notFound() // "no such chapter" = end
        return notFound()
      })
    )
    const ref = parseReference('Matthew 5-7')
    const res = await getPassage(version, ref)
    expect(res.verses.length).toBe(3) // only chapter 5's verses, no error
    expect(res.verses.every((v) => v.c === 5)).toBe(true)
  })
})
