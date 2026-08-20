// Convert the WEB USFX XML into OpenLectern's per-book JSON.
// Usage: node scripts/convert-usfx.mjs
// Downloads the source if not already cached, strips <f>/<x> notes, and writes
// public/bibles/eng-web/<ID>.json plus index.json, then updates manifest.json.

import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { BOOK_BY_ID } from '../src/lib/books.js'
import { upsertManifest } from './manifest.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_URL = 'https://raw.githubusercontent.com/seven1m/open-bibles/master/eng-web.usfx.xml'
const CACHE = join(root, 'scripts/.cache/eng-web.usfx.xml')
const OUT_DIR = join(root, 'public/bibles/eng-web')

const VERSION = {
  id: 'eng-web',
  name: 'World English Bible',
  language: 'en',
  languageName: 'English',
  source: 'bundled'
}

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
}

function clean(parts) {
  return decode(parts.join('')).replace(/\s+/g, ' ').trim()
}

function parseUsfx(xml) {
  const books = []
  let book = null
  let chapter = null
  let verse = null
  let vnum = 0
  let inH = false
  let suppress = 0

  const finishVerse = () => {
    if (book && verse && vnum > 0) chapter[vnum - 1] = clean(verse)
    verse = null
  }

  const re = /<([^>]*)>/g
  let last = 0
  let m
  while ((m = re.exec(xml))) {
    const gap = xml.slice(last, m.index)
    last = re.lastIndex
    if (gap && suppress === 0) {
      if (inH && book) book.name += gap
      else if (verse) verse.push(gap)
    }

    const raw = m[1]
    const isClose = raw[0] === '/'
    const selfClose = raw[raw.length - 1] === '/'
    const name = raw.replace(/^\//, '').replace(/\/$/, '').trim().split(/\s+/)[0].toLowerCase()
    const idm = raw.match(/\bid="([^"]*)"/)
    const id = idm ? idm[1] : null

    if (isClose) {
      if (name === 'f' || name === 'x') suppress = Math.max(0, suppress - 1)
      else if (name === 'h') inH = false
      else if (name === 'book') {
        finishVerse()
        if (book && BOOK_BY_ID[book.id]) books.push(book)
        book = null
        chapter = null
      }
      continue
    }

    if (suppress > 0) {
      if ((name === 'f' || name === 'x') && !selfClose) suppress++
      continue
    }

    switch (name) {
      case 'book':
        finishVerse()
        book = { id, name: '', chapters: [] }
        chapter = null
        break
      case 'h':
        if (book && !selfClose) {
          inH = true
          book.name = ''
        }
        break
      case 'c':
        finishVerse()
        chapter = []
        if (book) book.chapters.push(chapter)
        break
      case 'v':
        finishVerse()
        vnum = parseInt(id, 10)
        verse = []
        break
      case 've':
        finishVerse()
        break
      case 'f':
      case 'x':
        if (!selfClose) suppress++
        break
      default:
        break
    }
  }
  return books
}

async function main() {
  if (!existsSync(CACHE)) {
    console.log('Downloading WEB USFX...')
    await mkdir(dirname(CACHE), { recursive: true })
    const res = await fetch(SRC_URL)
    if (!res.ok) throw new Error(`Download failed: ${res.status}`)
    await writeFile(CACHE, await res.text())
  }

  const xml = await readFile(CACHE, 'utf-8')
  const books = parseUsfx(xml)

  await mkdir(OUT_DIR, { recursive: true })
  const index = []
  for (const b of books) {
    b.name = b.name.trim()
    const out = { id: b.id, name: b.name, chapters: b.chapters }
    await writeFile(join(OUT_DIR, `${b.id}.json`), JSON.stringify(out))
    index.push({ id: b.id, name: b.name, chapters: b.chapters.length })
  }
  await writeFile(join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2))
  await upsertManifest(root, VERSION)

  verify(books)
  console.log(`Wrote ${books.length} books to public/bibles/eng-web`)
}

function verify(books) {
  const by = Object.fromEntries(books.map((b) => [b.id, b]))
  const gen = by.GEN?.chapters?.[0]?.[0] || ''
  const jhn = by.JHN?.chapters?.[2]?.[15] || ''
  const psa = by.PSA?.chapters?.length || 0
  const checks = [
    ['66 books', books.length === 66],
    ['GEN 1:1 present', /In the beginning/.test(gen)],
    ['JHN 3:16 present', /loved the world/.test(jhn)],
    ['PSA has 150 chapters', psa === 150]
  ]
  let ok = true
  for (const [label, pass] of checks) {
    console.log(`${pass ? 'ok ' : 'FAIL'}  ${label}`)
    if (!pass) ok = false
  }
  if (!ok) throw new Error('Verification failed.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
