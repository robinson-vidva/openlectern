// Tests and `wrangler dev` import cloudflare/src/shell.generated.js, which
// `npm run build` writes. Create a placeholder when it is missing so the Worker
// module loads before the first build.
import { existsSync, writeFileSync } from 'node:fs'
const target = new URL('../cloudflare/src/shell.generated.js', import.meta.url)
if (!existsSync(target)) {
  writeFileSync(
    target,
    `// PLACEHOLDER -- run \`npm run build\` to generate the real shell.\nexport const SHELL = '<!doctype html><title>OpenLectern</title><p>Build the app first: npm run build</p>'\n`
  )
}
