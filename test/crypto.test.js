import { describe, it, expect } from 'vitest'
import {
  isInviteValid,
  hmacKey,
  signMsg,
  verifyMsg,
  generateEcdhKeyPair,
  exportPublicKey,
  deriveSharedAesKey,
  decryptString
} from '../src/lib/crypto.js'
import { buildInviteResponse } from '../src/lib/invite.js'

// Stand in for the requester side of requestPinViaInvite (which itself needs a
// live Supabase channel): build the request, then decrypt the built response.
async function makeRequest(inviteCode, nonce) {
  const pair = await generateEcdhKeyPair()
  const pub = await exportPublicKey(pair.publicKey)
  const mac = await signMsg(await hmacKey(inviteCode), `${nonce}:${pub}`)
  return { pair, req: { nonce, pub, mac } }
}

describe('invite crypto (ECDH key exchange)', () => {
  it('requester and inviter derive the same key; the PIN roundtrips', async () => {
    const { pair, req } = await makeRequest('482913', 'abc123nonce')
    const res = await buildInviteResponse('482913', '1234', req)
    expect(res).toBeTruthy()
    expect(res.nonce).toBe('abc123nonce')
    const key = await deriveSharedAesKey(pair.privateKey, res.pub)
    expect(await decryptString(key, res)).toBe('1234')
  })

  it('a wrong invite code fails authentication (no response is built)', async () => {
    const nonce = 'nonce-xyz'
    const pair = await generateEcdhKeyPair()
    const pub = await exportPublicKey(pair.publicKey)
    // Requester signs with the wrong code.
    const mac = await signMsg(await hmacKey('000000'), `${nonce}:${pub}`)
    const res = await buildInviteResponse('482913', '1234', { nonce, pub, mac })
    expect(res).toBe(null)
  })

  it('a tampered public key fails authentication', async () => {
    const { req } = await makeRequest('482913', 'n2')
    // Attacker swaps in their own public key but cannot re-sign the HMAC.
    const evil = await generateEcdhKeyPair()
    req.pub = await exportPublicKey(evil.publicKey)
    const res = await buildInviteResponse('482913', '1234', req)
    expect(res).toBe(null)
  })

  it('an eavesdropper holding only the public keys cannot decrypt the PIN', async () => {
    const { req } = await makeRequest('482913', 'n3')
    const res = await buildInviteResponse('482913', '1234', req)
    // The eavesdropper has both public keys but no private key -> a different
    // ECDH result -> AES-GCM authentication fails.
    const attacker = await generateEcdhKeyPair()
    const wrongKey = await deriveSharedAesKey(attacker.privateKey, res.pub)
    await expect(decryptString(wrongKey, res)).rejects.toBeDefined()
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
