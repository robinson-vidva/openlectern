// List or download translations from the HelloAO Free Use Bible API into
// OpenLectern's per-book JSON format.
//   node scripts/fetch-helloao.mjs list [filter]
//   node scripts/fetch-helloao.mjs <translationId>   e.g. tam_irv
// Endpoint shapes were verified against the live API (Aug 2026).

import { writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { BOOK_BY_ID } from '../src/lib/books.js'
import { upsertManifest } from './manifest.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://bible.helloao.org/api'

async function getJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`)
  return res.json()
}

function verseText(content) {
  return (content || [])
    .map((c) => (typeof c === 'string' ? c : c?.text || ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function list(filter) {
  const data = await getJson(`${API}/available_translations.json`)
  const rows = (data.translations || []).filter((t) => {
    if (!filter) return true
    return JSON.stringify(t).toLowerCase().includes(filter.toLowerCase())
  })
  for (const t of rows) {
    console.log(`${t.id.padEnd(12)} ${String(t.numberOfBooks).padStart(2)} books  ${t.languageEnglishName.padEnd(12)} ${t.englishName}`)
  }
  console.log(`\n${rows.length} translation(s).`)
}

async function download(id) {
  console.log(`Downloading ${id} (complete.json)...`)
  const data = await getJson(`${API}/${id}/complete.json`)
  const meta = data.translation || {}
  const outDir = join(root, 'public/bibles', id)
  await mkdir(outDir, { recursive: true })

  const index = []
  for (const book of data.books || []) {
    if (!BOOK_BY_ID[book.id]) continue
    const chapters = []
    for (const entry of book.chapters || []) {
      const ch = entry.chapter || entry
      const verses = []
      for (const item of ch.content || []) {
        if (item.type !== 'verse') continue
        verses[item.number - 1] = verseText(item.content)
      }
      chapters[ch.number - 1] = Array.from(verses, (v) => v || '')
    }
    const name = book.commonName || book.name || book.id
    await writeFile(join(outDir, `${book.id}.json`), JSON.stringify({ id: book.id, name, chapters }))
    index.push({ id: book.id, name, chapters: chapters.length })
  }
  await writeFile(join(outDir, 'index.json'), JSON.stringify(index, null, 2))

  const version = {
    id,
    name: meta.englishName || meta.name || id,
    language: (meta.language || 'xx').slice(0, 2),
    languageName: meta.languageEnglishName || meta.languageName || meta.language || '',
    source: 'bundled',
    helloaoId: id
  }
  await upsertManifest(root, version)
  console.log(`Wrote ${index.length} books to public/bibles/${id}`)
}

async function main() {
  const [cmd, arg] = process.argv.slice(2)
  if (!cmd || cmd === 'list') return list(arg)
  return download(cmd)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
