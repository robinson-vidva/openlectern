// Web Crypto helpers for the invite flow and signed channel messages. The PIN
// itself is never sent in plaintext and never appears in a URL; recovery only
// ever flows from a device that already knows the PIN.
const enc = new TextEncoder()
const dec = new TextDecoder()

function b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}
function unb64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

// ---- Ephemeral ECDH key exchange for the invite flow ----
// The PIN is encrypted under a fresh, per-exchange ECDH shared secret -- NOT under
// the invite code. A passive eavesdropper on the public session channel sees both
// ephemeral public keys but cannot derive the shared secret (ECDH hardness), so
// the PIN's confidentiality no longer depends on the low-entropy invite code. The
// invite code's only job is to authenticate the requester (via the HMAC in
// invite.js); even if it were later cracked, it keys nothing and the invite is
// single-use and short-lived.
const ECDH = { name: 'ECDH', namedCurve: 'P-256' }

export async function generateEcdhKeyPair() {
  return crypto.subtle.generateKey(ECDH, true, ['deriveKey'])
}

export async function exportPublicKey(key) {
  return b64(await crypto.subtle.exportKey('raw', key))
}

async function importPublicKey(b64str) {
  return crypto.subtle.importKey('raw', unb64(b64str), ECDH, false, [])
}

// AES-GCM key from my private key + the peer's exported public key. Both parties
// compute the identical key; nobody merely watching the channel can.
export async function deriveSharedAesKey(privateKey, peerPublicB64) {
  const peer = await importPublicKey(peerPublicB64)
  return crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, privateKey, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt'
  ])
}

export async function encryptString(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext))
  return { iv: b64(iv), data: b64(ct) }
}

export async function decryptString(key, payload) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(payload.iv) }, key, unb64(payload.data))
  return dec.decode(pt)
}

// HMAC signing so a channel message can be proven to come from a PIN holder
// (view-only devices cannot forge one).
export async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signMsg(key, msg) {
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(msg)))
}

export async function verifyMsg(key, msg, sig) {
  try {
    return await crypto.subtle.verify('HMAC', key, unb64(sig), enc.encode(msg))
  } catch {
    return false
  }
}

// Pure validity check for a one-time invite (single-use, 60s expiry).
export function isInviteValid(invite, now) {
  return !!invite && !invite.used && typeof invite.expiresAt === 'number' && now < invite.expiresAt
}

export function makeInviteCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000
  return String(n).padStart(6, '0')
}
