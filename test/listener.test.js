import { describe, it, expect } from 'vitest'
import { activeListeners, listenerDrops } from '../src/lib/listener.js'

describe('listener helpers', () => {
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
