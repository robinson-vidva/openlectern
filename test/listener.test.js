import { describe, it, expect } from 'vitest'
import { isRecent, activeListeners, listenerDrops } from '../src/lib/listener.js'

describe('listener helpers', () => {
  it('isRecent dedupes within the window', () => {
    expect(isRecent(1000, 5000, 10000)).toBe(true) // 4s apart
    expect(isRecent(1000, 20000, 10000)).toBe(false) // 19s apart
    expect(isRecent(null, 5000, 10000)).toBe(false) // never seen
  })

  it('activeListeners maps presence to listening device names', () => {
    const entries = [
      { name: 'Pulpit', listening: true },
      { name: 'Op', listening: false },
      { name: 'Pew', listening: true }
    ]
    expect(activeListeners(entries)).toEqual(['Pulpit', 'Pew'])
    expect(activeListeners([])).toEqual([])
    expect(activeListeners(undefined)).toEqual([])
  })

  it('listenerDrops reports listeners that went away', () => {
    expect(listenerDrops(['Pulpit', 'Pew'], ['Pew'])).toEqual(['Pulpit'])
    expect(listenerDrops(['Pulpit'], ['Pulpit'])).toEqual([])
    expect(listenerDrops(['Pulpit'], [])).toEqual(['Pulpit'])
    expect(listenerDrops([], ['Pulpit'])).toEqual([])
  })
})
