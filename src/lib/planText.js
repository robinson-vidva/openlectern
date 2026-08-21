import { parseReference, formatLabel } from './parseRef.js'

// Pull every scripture reference out of a free-text plan (a pastor's note like
// "Call to worship: Psalm 100. Sermon John 3:16-21, then Romans 8:28-30").
// Splits on list separators and tries each chunk whole; for prose chunks it also
// scans for embedded references. Returns deduped [{ input, label }] in order.
const SEP = /[\n\r;,•·|/]+|\s+(?:and then|then|and)\s+/gi
const EMBEDDED = /((?:[1-3]\s+)?[A-Za-z][A-Za-z]+(?:\s+of\s+[A-Za-z]+)?\.?\s+\d+(?::\d+)?(?:\s*-\s*\d+(?::\d+)?)?)/g

export function extractReferences(text) {
  if (!text) return []
  const out = []
  const seen = new Set()
  const add = (parsed, input) => {
    if (!parsed) return
    const label = formatLabel(parsed)
    if (seen.has(label)) return
    seen.add(label)
    out.push({ input: input.trim(), label })
  }
  for (const raw of String(text).split(SEP)) {
    const chunk = raw.trim()
    if (!chunk) continue
    const whole = parseReference(chunk)
    if (whole) {
      add(whole, chunk)
      continue
    }
    // Prose chunk: scan for reference-like substrings and keep the ones that parse.
    EMBEDDED.lastIndex = 0
    let m
    while ((m = EMBEDDED.exec(chunk))) add(parseReference(m[1]), m[1])
  }
  return out
}
