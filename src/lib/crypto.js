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

export async function sha256Hex(str) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(str))
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// AES-GCM key derived from a shared secret (invite code + requester nonce).
export async function deriveAesKey(secret, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
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
