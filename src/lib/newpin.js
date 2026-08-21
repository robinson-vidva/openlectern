// Auto-generated session PIN. Random 4 digits, but reject weak/ambiguous
// patterns (all same digit, or a straight ascending/descending run) so a
// creator never lands on 0000 / 1111 / 1234 / 4321.
export function isWeakPin(p) {
  if (!/^\d{4}$/.test(p)) return true
  const d = p.split('').map(Number)
  if (d.every((x) => x === d[0])) return true
  if (d.every((x, i) => i === 0 || x === d[i - 1] + 1)) return true
  if (d.every((x, i) => i === 0 || x === d[i - 1] - 1)) return true
  return false
}

// rand() returns an integer in [0, 10000). Injectable for tests; defaults to a
// crypto-backed source in the browser.
export function generatePin(rand) {
  const r =
    rand ||
    (() => {
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        return crypto.getRandomValues(new Uint32Array(1))[0] % 10000
      }
      return Math.floor(Math.random() * 10000)
    })
  let p
  let guard = 0
  do {
    p = String(r() % 10000).padStart(4, '0')
  } while (isWeakPin(p) && guard++ < 100)
  return p
}
