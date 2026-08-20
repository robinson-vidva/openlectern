import { describe, it, expect } from 'vitest'
import { deriveAesKey, encryptString, decryptString, sha256Hex, isInviteValid, hmacKey, signMsg, verifyMsg } from '../src/lib/crypto.js'

describe('invite crypto', () => {
  it('derive/encrypt/decrypt roundtrip with the shared secret', async () => {
    const inviteCode = '482913'
    const nonce = 'abc123nonce'
    const secret = `${inviteCode}:${nonce}`
    const keyA = await deriveAesKey(secret, nonce) // inviting controller
    const keyB = await deriveAesKey(secret, nonce) // new device
    const payload = await encryptString(keyA, '1234')
    expect(await decryptString(keyB, payload)).toBe('1234')
  })

  it('wrong invite code cannot decrypt', async () => {
    const nonce = 'nonce-xyz'
    const good = await deriveAesKey(`482913:${nonce}`, nonce)
    const bad = await deriveAesKey(`000000:${nonce}`, nonce)
    const payload = await encryptString(good, '1234')
    await expect(decryptString(bad, payload)).rejects.toBeDefined()
  })

  it('proof hash matches only for the right invite code', async () => {
    const nonce = 'n1'
    const proof = await sha256Hex(`482913:${nonce}`)
    expect(await sha256Hex(`482913:${nonce}`)).toBe(proof)
    expect(await sha256Hex(`999999:${nonce}`)).not.toBe(proof)
  })

  it('isInviteValid enforces single-use and expiry', () => {
    const now = 1000
    expect(isInviteValid({ used: false, expiresAt: 2000 }, now)).toBe(true)
    expect(isInviteValid({ used: true, expiresAt: 2000 }, now)).toBe(false) // used
    expect(isInviteValid({ used: false, expiresAt: 500 }, now)).toBe(false) // expired
    expect(isInviteValid(null, now)).toBe(false)
  })

  it('HMAC signing proves a PIN-holder authored a message', async () => {
    const key = await hmacKey('pin:1234')
    const msg = JSON.stringify({ ref: 'John 3:16', from: 'listener' })
    const sig = await signMsg(key, msg)
    expect(await verifyMsg(key, msg, sig)).toBe(true)
    expect(await verifyMsg(key, msg + 'x', sig)).toBe(false)
    const other = await hmacKey('pin:0000')
    expect(await verifyMsg(other, msg, sig)).toBe(false)
  })
})
