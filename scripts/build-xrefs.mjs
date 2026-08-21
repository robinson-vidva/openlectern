// Convert the openbible.info cross-reference set (CC-BY) into per-book chunks
// public/xrefs/<BOOKID>.json = { "chapter:verse": ["Display Ref", ...] }, capped
// to the ~10 strongest references per verse by vote. Get the source file with:
//   curl -sL https://a.openbible.info/data/cross-references.zip -o x.zip && unzip x.zip
// Run: node scripts/build-xrefs.mjs [path/to/cross_references.txt]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOOKS } from '../src/lib/books.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = process.argv[2] || join(ROOT, 'cross_references.txt')
const OUT = join(ROOT, 'public', 'xrefs')
const CAP = 10

if (!existsSync(SRC)) {
  console.error(`Missing ${SRC}. Download it:\n  curl -sL https://a.openbible.info/data/cross-references.zip -o x.zip && unzip x.zip`)
  process.exit(1)
}

const OSIS = {
  Gen: 'GEN', Exod: 'EXO', Lev: 'LEV', Num: 'NUM', Deut: 'DEU', Josh: 'JOS', Judg: 'JDG', Ruth: 'RUT',
  '1Sam': '1SA', '2Sam': '2SA', '1Kgs': '1KI', '2Kgs': '2KI', '1Chr': '1CH', '2Chr': '2CH', Ezra: 'EZR',
  Neh: 'NEH', Esth: 'EST', Job: 'JOB', Ps: 'PSA', Prov: 'PRO', Eccl: 'ECC', Song: 'SNG', Isa: 'ISA',
  Jer: 'JER', Lam: 'LAM', Ezek: 'EZK', Dan: 'DAN', Hos: 'HOS', Joel: 'JOL', Amos: 'AMO', Obad: 'OBA',
  Jonah: 'JON', Mic: 'MIC', Nah: 'NAM', Hab: 'HAB', Zeph: 'ZEP', Hag: 'HAG', Zech: 'ZEC', Mal: 'MAL',
  Matt: 'MAT', Mark: 'MRK', Luke: 'LUK', John: 'JHN', Acts: 'ACT', Rom: 'ROM', '1Cor': '1CO', '2Cor': '2CO',
  Gal: 'GAL', Eph: 'EPH', Phil: 'PHP', Col: 'COL', '1Thess': '1TH', '2Thess': '2TH', '1Tim': '1TI',
  '2Tim': '2TI', Titus: 'TIT', Phlm: 'PHM', Heb: 'HEB', Jas: 'JAS', '1Pet': '1PE', '2Pet': '2PE',
  '1John': '1JN', '2John': '2JN', '3John': '3JN', Jude: 'JUD', Rev: 'REV'
}
const NAME = Object.fromEntries(BOOKS.map((b) => [b.id, b.name]))

// "John.3.16" -> { id, ch, v }; null if the book is outside the 66.
function point(osis) {
  const m = osis.match(/^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$/)
  if (!m) return null
  const id = OSIS[m[1]]
  return id ? { id, ch: +m[2], v: +m[3] } : null
}

// A "To Verse" is a single point or a start-end range. Render a display ref the
// app's parser accepts; cross-chapter ranges clamp to the start verse.
function toDisplay(to) {
  const [a, b] = to.split('-')
  const s = point(a)
  if (!s) return null
  const name = NAME[s.id]
  const e = b ? point(b) : null
  if (e && e.id === s.id && e.ch === s.ch && e.v > s.v) return `${name} ${s.ch}:${s.v}-${e.v}`
  return `${name} ${s.ch}:${s.v}`
}

const src = readFileSync(SRC, 'utf8').split('\n')
const bySource = new Map() // bookId -> Map("ch:v" -> [{ref, votes}])
let rows = 0
for (let i = 1; i < src.length; i++) {
  const line = src[i]
  if (!line || line[0] === '#') continue
  const [from, to, votesRaw] = line.split('\t')
  if (!from || !to) continue
  const f = point(from)
  if (!f) continue
  const ref = toDisplay(to)
  if (!ref) continue
  const votes = parseInt(votesRaw, 10) || 0
  if (!bySource.has(f.id)) bySource.set(f.id, new Map())
  const chunk = bySource.get(f.id)
  const key = `${f.ch}:${f.v}`
  if (!chunk.has(key)) chunk.set(key, [])
  chunk.get(key).push({ ref, votes })
  rows++
}

mkdirSync(OUT, { recursive: true })
let files = 0
let totalRefs = 0
for (const [id, chunk] of bySource) {
  const obj = {}
  for (const [key, list] of chunk) {
    list.sort((x, y) => y.votes - x.votes)
    const seen = new Set()
    const top = []
    for (const item of list) {
      if (seen.has(item.ref)) continue
      seen.add(item.ref)
      top.push(item.ref)
      if (top.length >= CAP) break
    }
    obj[key] = top
    totalRefs += top.length
  }
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify(obj))
  files++
}
console.log(`rows kept: ${rows}, books: ${files}, refs after cap: ${totalRefs}`)
