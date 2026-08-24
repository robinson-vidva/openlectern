import { supabase } from './supabase.js'
import {
  hmacKey,
  signMsg,
  verifyMsg,
  generateEcdhKeyPair,
  exportPublicKey,
  deriveSharedAesKey,
  encryptString,
  decryptString
} from './crypto.js'

// The requester authenticates with an HMAC over the exchange (nonce + its
// ephemeral public key), keyed by the invite code -- rather than publishing a
// brute-forceable hash of the code. The invite code never keys the encryption, so
// even if an eavesdropper later cracks it from the HMAC it gains nothing, and the
// invite is single-use and expires in a minute.
function macMessage(nonce, pub) {
  return `${nonce}:${pub}`
}

// Inviting controller: verify the requester's HMAC, then encrypt the PIN under a
// fresh ECDH shared secret. Returns the response payload, or null when the proof
// is invalid (the caller then sends a denial).
export async function buildInviteResponse(inviteCode, pin, req) {
  const { nonce, pub, mac } = req || {}
  if (!nonce || !pub || !mac) return null
  const authed = await verifyMsg(await hmacKey(inviteCode), macMessage(nonce, pub), mac)
  if (!authed) return null
  const pair = await generateEcdhKeyPair()
  const key = await deriveSharedAesKey(pair.privateKey, pub)
  const payload = await encryptString(key, pin)
  return { nonce, pub: await exportPublicKey(pair.publicKey), ...payload }
}

// New device: broadcast an invite request on the session channel and wait for the
// encrypted PIN. Resolves with the PIN or throws. Never touches the table.
export async function requestPinViaInvite(code, inviteCode, name, timeoutMs = 15000) {
  const c = code.trim().toUpperCase()
  const invite = inviteCode.trim()
  const nonce = crypto.randomUUID()
  const pair = await generateEcdhKeyPair()
  const pub = await exportPublicKey(pair.publicKey)
  const mac = await signMsg(await hmacKey(invite), macMessage(nonce, pub))
  const channel = supabase.channel(`session:${c}`, { config: { broadcast: { self: false } } })
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(
      () => finish(reject, new Error('No response. Is a controller open and the code correct?')),
      timeoutMs
    )
    function finish(fn, arg) {
      if (done) return
      done = true
      clearTimeout(timer)
      channel.unsubscribe()
      fn(arg)
    }
    channel.on('broadcast', { event: 'invite-res' }, async ({ payload }) => {
      if (!payload || payload.nonce !== nonce) return
      if (payload.denied || !payload.pub) return finish(reject, new Error('Invite code was rejected or expired.'))
      try {
        const key = await deriveSharedAesKey(pair.privateKey, payload.pub)
        finish(resolve, await decryptString(key, payload))
      } catch {
        finish(reject, new Error('Could not decrypt the PIN.'))
      }
    })
    channel.subscribe((st) => {
      if (st === 'SUBSCRIBED') {
        channel.send({ type: 'broadcast', event: 'invite-req', payload: { nonce, pub, mac, name: name || '' } })
      } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
        finish(reject, new Error('Could not reach the session channel.'))
      }
    })
  })
}
