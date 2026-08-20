import { describe, it, expect } from 'vitest'
import { appendHistory } from '../src/lib/history.js'

describe('appendHistory', () => {
  it('appends to an empty/undefined history', () => {
    const h = appendHistory(undefined, { ref: 'John 3:16', at: 1, source: 'manual' })
    expect(h).toEqual([{ ref: 'John 3:16', at: 1, source: 'manual' }])
  })

  it('prepends newest-first', () => {
    let h = appendHistory([], { ref: 'John 3:16', at: 1, source: 'manual' })
    h = appendHistory(h, { ref: 'Psalm 23', at: 2, source: 'queue' })
    expect(h.map((e) => e.ref)).toEqual(['Psalm 23', 'John 3:16'])
  })

  it('dedupes a consecutive repeat by refreshing the top entry', () => {
    let h = appendHistory([], { ref: 'John 3:16', at: 1, source: 'voice' })
    h = appendHistory(h, { ref: 'John 3:16', at: 5, source: 'manual' })
    expect(h).toHaveLength(1)
    expect(h[0]).toEqual({ ref: 'John 3:16', at: 5, source: 'manual' })
  })

  it('does not dedupe a non-consecutive repeat', () => {
    let h = appendHistory([], { ref: 'John 3:16', at: 1, source: 'manual' })
    h = appendHistory(h, { ref: 'Psalm 23', at: 2, source: 'manual' })
    h = appendHistory(h, { ref: 'John 3:16', at: 3, source: 'manual' })
    expect(h.map((e) => e.ref)).toEqual(['John 3:16', 'Psalm 23', 'John 3:16'])
  })

  it('caps at the most recent N entries', () => {
    let h = []
    for (let i = 0; i < 130; i++) h = appendHistory(h, { ref: `Ref ${i}`, at: i, source: 'manual' }, 100)
    expect(h).toHaveLength(100)
    expect(h[0].ref).toBe('Ref 129')
    expect(h[99].ref).toBe('Ref 30')
  })
})
