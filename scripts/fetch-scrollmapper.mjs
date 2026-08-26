// Download a public-domain translation from the scrollmapper/bible_databases
// project into OpenLectern's per-book JSON format.
//
//   node scripts/fetch-scrollmapper.mjs KJV kjv "King James Version"
//   node scripts/fetch-scrollmapper.mjs ASV asv "American Standard Version"
//
// Arguments: <sourceFile> <outId> <displayName>
//   sourceFile  - the file stem under formats/json (e.g. KJV, ASV)
//   outId       - the directory + manifest id to write (e.g. kjv, asv)
//   displayName - the human-readable version name for the manifest
//
// The source lists all 66 Protestant-canon books in the standard order, so we
// map each book by position onto OpenLectern's canonical BOOKS array (which is
// the same order) and adopt the app's own book names for consistent labels.

import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { BOOKS } from '../src/lib/books.js'
import { upsertManifest } from './manifest.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json'

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`)
  return res.json()
}

function clean(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function download(sourceFile, outId, displayName) {
  const url = `${BASE}/${sourceFile}.json`
  console.log(`Downloading ${url} ...`)
  const data = await getJson(url)
  const books = data.books || []
  if (books.length !== BOOKS.length) {
    throw new Error(`Expected ${BOOKS.length} books, source has ${books.length}`)
  }

  const outDir = join(root, 'public/bibles', outId)
  await mkdir(outDir, { recursive: true })

  const index = []
  const structure = {}
  for (let i = 0; i < books.length; i++) {
    const src = books[i]
    const { id, name } = BOOKS[i] // canonical position -> app id + name
    const chapters = []
    for (const ch of src.chapters || []) {
      const verses = []
      for (const v of ch.verses || []) verses[v.verse - 1] = clean(v.text)
      chapters[ch.chapter - 1] = Array.from(verses, (t) => t || '')
    }
    await writeFile(join(outDir, `${id}.json`), JSON.stringify({ id, name, chapters }))
    index.push({ id, name, chapters: chapters.length })
    structure[id] = chapters.map((c) => c.length)
  }
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index, null, 2))
  await writeFile(join(outDir, 'structure.json'), JSON.stringify(structure))

  await upsertManifest(root, {
    id: outId,
    name: displayName,
    language: 'en',
    languageName: 'English',
    source: 'bundled'
  })
  console.log(`Wrote ${index.length} books to public/bibles/${outId}`)
}

async function main() {
  const [sourceFile, outId, displayName] = process.argv.slice(2)
  if (!sourceFile || !outId || !displayName) {
    console.error('Usage: node scripts/fetch-scrollmapper.mjs <sourceFile> <outId> <displayName>')
    process.exit(1)
  }
  return download(sourceFile, outId, displayName)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
