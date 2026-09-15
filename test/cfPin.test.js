import { describe, it, expect } from 'vitest'
import { hashPin, verifyPin } from '../cloudflare/src/session-do.js'

// The Cloudflare backend hashes the 4-digit PIN with PBKDF2 (Web Crypto) instead
// of bcrypt, since bcrypt isn't available in Workers. These guard the format and
// the verify path -- the security-critical piece of the migration.
describe('PIN hashing (PBKDF2, Workers-compatible)', () => {
  it('verifies the correct PIN', async () => {
    const stored = await hashPin('1234')
    expect(stored.startsWith('pbkdf2$100000$')).toBe(true)
    expect(await verifyPin('1234', stored)).toBe(true)
  })
  it('rejects the wrong PIN', async () => {
    const stored = await hashPin('1234')
    expect(await verifyPin('1235', stored)).toBe(false)
    expect(await verifyPin('', stored)).toBe(false)
  })
  it('uses a random salt (same PIN -> different stored hash)', async () => {
    const a = await hashPin('0000')
    const b = await hashPin('0000')
    expect(a).not.toBe(b)
    expect(await verifyPin('0000', a)).toBe(true)
    expect(await verifyPin('0000', b)).toBe(true)
  })
  it('rejects a malformed stored value without throwing', async () => {
    expect(await verifyPin('1234', 'garbage')).toBe(false)
    expect(await verifyPin('1234', '')).toBe(false)
  })
})
