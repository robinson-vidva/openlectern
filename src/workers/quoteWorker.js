// Quotation-detection worker. Loads the shingle index for the active
// translations and scans a rolling transcript window off the main thread so the
// controller never janks. Messages:
//   { type:'load', base, versionIds }  -> { type:'loaded', versionIds }
//   { type:'scan', seq, tokens }       -> { type:'result', seq, hits }
import { decodeIndex, scanWindow } from '../lib/quote/quoteIndex.js'

const indexes = new Map() // versionId -> decoded index

async function loadOne(base, versionId) {
  if (indexes.has(versionId)) return
  const metaRes = await fetch(`${base}quoteidx/${versionId}.json`)
  if (!metaRes.ok) return
  const meta = await metaRes.json()
  const binRes = await fetch(`${base}quoteidx/${versionId}.bin`)
  if (!binRes.ok) return
  const buf = await binRes.arrayBuffer()
  indexes.set(versionId, decodeIndex(buf, meta))
}

self.onmessage = async (e) => {
  const msg = e.data
  if (msg.type === 'load') {
    for (const id of [...indexes.keys()]) {
      if (!msg.versionIds.includes(id)) indexes.delete(id)
    }
    for (const id of msg.versionIds) {
      try {
        await loadOne(msg.base, id)
      } catch {
        /* a version without a bundled index just contributes nothing */
      }
    }
    self.postMessage({ type: 'loaded', versionIds: [...indexes.keys()] })
  } else if (msg.type === 'scan') {
    const hits = []
    for (const idx of indexes.values()) {
      for (const h of scanWindow(idx, msg.tokens)) hits.push(h)
    }
    hits.sort((a, b) => b.score - a.score)
    self.postMessage({ type: 'result', seq: msg.seq, hits: hits.slice(0, 2) })
  }
}
