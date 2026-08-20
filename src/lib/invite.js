import { supabase } from './supabase.js'
import { sha256Hex, deriveAesKey, encryptString, decryptString } from './crypto.js'

const SALT = 'openlectern-invite'

// A requester proves it knows the invite code without revealing it in the clear.
export async function inviteProof(inviteCode, nonce) {
  return sha256Hex(`${inviteCode}:${nonce}`)
}
export async function checkInviteProof(inviteCode, nonce, proof) {
  return proof === (await sha256Hex(`${inviteCode}:${nonce}`))
}

// Inviting controller: encrypt the PIN for a verified requester.
export async function buildInviteResponse(inviteCode, pin, nonce) {
  const key = await deriveAesKey(`${inviteCode}:${nonce}`, SALT)
  const payload = await encryptString(key, pin)
  return { nonce, ...payload }
}

// New device: broadcast an invite request on the session channel and wait for
// the encrypted PIN. Resolves with the PIN or throws. Never touches the table.
export async function requestPinViaInvite(code, inviteCode, name, timeoutMs = 15000) {
  const c = code.trim().toUpperCase()
  const invite = inviteCode.trim()
  const nonce = crypto.randomUUID()
  const proof = await inviteProof(invite, nonce)
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
      if (payload.denied) return finish(reject, new Error('Invite code was rejected or expired.'))
      try {
        const key = await deriveAesKey(`${invite}:${nonce}`, SALT)
        finish(resolve, await decryptString(key, payload))
      } catch {
        finish(reject, new Error('Could not decrypt the PIN.'))
      }
    })
    channel.subscribe((st) => {
      if (st === 'SUBSCRIBED') {
        channel.send({ type: 'broadcast', event: 'invite-req', payload: { nonce, proof, name: name || '' } })
      } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
        finish(reject, new Error('Could not reach the session channel.'))
      }
    })
  })
}
