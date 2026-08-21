// Build a shingle-hash quotation index per bundled translation into
// public/quoteidx/<versionId>.bin (+ .json meta). See src/lib/quote/quoteIndex.js
// for the binary layout. Run: node scripts/build-quote-index.mjs [versionId ...]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeTokens, shinglesOf, SHINGLE_K } from '../src/lib/quote/shingle.js'
import { packLoc } from '../src/lib/quote/quoteIndex.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIBLES = join(ROOT, 'public', 'bibles')
const OUT = join(ROOT, 'public', 'quoteidx')

function versionList() {
  if (process.argv.length > 2) return process.argv.slice(2)
  return readdirSync(BIBLES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(BIBLES, d.name, 'index.json')))
    .map((d) => d.name)
}

function buildVersion(versionId) {
  const dir = join(BIBLES, versionId)
  const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))
  const books = index.map((b) => b.id)
  const map = new Map() // hash -> Set(loc)
  let verses = 0
  for (let bookIdx = 0; bookIdx < books.length; bookIdx++) {
    const path = join(dir, `${books[bookIdx]}.json`)
    if (!existsSync(path)) continue
    const book = JSON.parse(readFileSync(path, 'utf8'))
    const chapters = book.chapters || []
    for (let ci = 0; ci < chapters.length; ci++) {
      const chapter = ci + 1
      const chVerses = chapters[ci] || []
      for (let vi = 0; vi < chVerses.length; vi++) {
        const verse = vi + 1
        const text = chVerses[vi]
        if (!text) continue
        verses++
        if (chapter > 255 || verse > 255) continue // out of packing range (never happens)
        const loc = packLoc(bookIdx, chapter, verse)
        for (const { h } of shinglesOf(normalizeTokens(text), SHINGLE_K)) {
          let set = map.get(h)
          if (!set) {
            set = new Set()
            map.set(h, set)
          }
          set.add(loc)
        }
      }
    }
  }

  const keys = Uint32Array.from([...map.keys()].sort((a, b) => a - b))
  const offsets = new Uint32Array(keys.length + 1)
  const locList = []
  for (let i = 0; i < keys.length; i++) {
    offsets[i] = locList.length
    const locs = [...map.get(keys[i])].sort((a, b) => a - b)
    for (const l of locs) locList.push(l)
  }
  offsets[keys.length] = locList.length
  const locs = Uint32Array.from(locList)

  const header = Buffer.alloc(8)
  header.writeUInt32LE(keys.length, 0)
  header.writeUInt32LE(locs.length, 4)
  const bin = Buffer.concat([
    header,
    Buffer.from(keys.buffer, keys.byteOffset, keys.byteLength),
    Buffer.from(offsets.buffer, offsets.byteOffset, offsets.byteLength),
    Buffer.from(locs.buffer, locs.byteOffset, locs.byteLength)
  ])

  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, `${versionId}.bin`), bin)
  writeFileSync(
    join(OUT, `${versionId}.json`),
    JSON.stringify({ version: versionId, k: SHINGLE_K, books, keyCount: keys.length, locCount: locs.length, verses })
  )
  return { versionId, verses, keys: keys.length, locs: locs.length, bytes: bin.length }
}

for (const v of versionList()) {
  const r = buildVersion(v)
  console.log(`${r.versionId}: ${r.verses} verses, ${r.keys} shingle-hashes, ${r.locs} locations, ${(r.bytes / 1e6).toFixed(2)} MB`)
}
