import { describe, it, expect } from 'vitest'
import { isWeakPin, generatePin } from '../src/lib/newpin.js'

describe('isWeakPin', () => {
  it('rejects all-same and straight runs', () => {
    for (const p of ['0000', '1111', '9999', '1234', '2345', '4321', '9876', '0123']) {
      expect(isWeakPin(p), p).toBe(true)
    }
  })
  it('accepts ordinary pins', () => {
    for (const p of ['1837', '5091', '2748', '9042', '1357']) {
      expect(isWeakPin(p), p).toBe(false)
    }
  })
  it('rejects malformed', () => {
    expect(isWeakPin('12')).toBe(true)
    expect(isWeakPin('abcd')).toBe(true)
  })
})

describe('generatePin', () => {
  it('always returns a strong 4-digit pin', () => {
    // Drive it with a sequence that starts on weak values to prove it skips them.
    const seq = [1234, 1111, 4321, 5872, 42, 42, 42]
    let i = 0
    const p = generatePin(() => seq[Math.min(i++, seq.length - 1)])
    expect(p).toMatch(/^\d{4}$/)
    expect(isWeakPin(p)).toBe(false)
    expect(p).toBe('5872')
  })
  it('default source produces strong pins', () => {
    for (let i = 0; i < 50; i++) expect(isWeakPin(generatePin())).toBe(false)
  })
})
