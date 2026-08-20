// Shared helper: upsert a version entry into public/bibles/manifest.json.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

export async function upsertManifest(root, version) {
  const path = join(root, 'public/bibles/manifest.json')
  await mkdir(dirname(path), { recursive: true })
  let manifest = { versions: [] }
  if (existsSync(path)) {
    try {
      manifest = JSON.parse(await readFile(path, 'utf-8'))
    } catch {
      manifest = { versions: [] }
    }
  }
  const versions = manifest.versions || []
  const i = versions.findIndex((v) => v.id === version.id)
  if (i >= 0) versions[i] = version
  else versions.push(version)
  manifest.versions = versions
  await writeFile(path, JSON.stringify(manifest, null, 2))
  return manifest
}
