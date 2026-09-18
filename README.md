# OpenLectern

**Show scripture on a screen. Control it from any phone.**

OpenLectern is a free, open-source bilingual Bible‑verse presenter for churches
and online prayer meetings. A fullscreen presenter displays scripture in up to
two languages while anyone in the room controls it live from a phone or laptop.

No accounts. No personal data. Sessions are anonymous and expire 24 hours after
they go idle. Runs on Cloudflare's free tier and never pauses on inactivity.

**Live demo:** https://openlectern.askdevotions.com

---

## How it works

Three roles share one live session, identified by a short code (like `K7PM4Q`):

The landing page offers three paths, all keyed to a short session code (like
`K7PM4Q`):

| Path | How you join | What it does |
| --- | --- | --- |
| **New session** | One tap — generates a PIN, creates the session, drops you into the console | The operator's console — search, queue, and drive the screen. Your code, QR, and PIN live behind the settings gear. |
| **Control a screen** | Enter the code + the 4‑digit PIN | Join an existing session as another operator. |
| **Watch a screen** | Enter the code only (or scan the QR) — no PIN | The big screen: large auto‑fitting serif type, fullscreen, no controls. |

A second controller can also join with a **one‑time invite code**, which hands off
the PIN under a fresh key agreement instead of sharing it in the clear.

## Features

- **Forgiving reference input** — type `John 3:16-18`, `1 Cor 13`, `Psalm 23:1-6`,
  or loosely as `john 3 16` / `john 3 16-18`. Cross‑chapter spans work too
  (`Matthew 5-7`, `Genesis 1:1-2:3`).
- **Intelligent type‑ahead** — start typing a book and pick from suggestions,
  then tap the chapter, then the verse; each list is validated against the real
  Bible structure, so `John → 3 → 16` needs no punctuation.
- **Named passages** — search by name: "the prodigal son", "the love chapter",
  "the armor of God" resolve to references.
- **Verse‑by‑verse or whole passage** — step through a passage one verse at a
  time, or show it whole with automatic, legible pagination. Choose how many
  verses appear per screen.
- **Two languages at once** — show a primary and optional secondary translation,
  switchable live mid‑service without losing your place.
- **Voice assist (Chrome/Edge)** — let the room's mic listen; a spoken reference
  ("John three sixteen", "verse twenty eight") becomes a tap‑to‑show suggestion.
  The known Bible structure disambiguates what's heard — "Matthew 77" resolves to
  Matthew 7:7, and a genuinely ambiguous "Mark 11" offers both Mark 11 and Mark
  1:1 for the operator to pick. Optional hands‑free **auto‑capture** puts a cited
  verse (or an announced chapter) straight on the screen, with a one‑tap **Undo**
  if it mishears. English and Tamil are both recognized (switch the recognition
  language live). A dedicated "listener mode" turns a spare phone into a pulpit
  mic. The mic only ever surfaces references someone actually states.
- **Related verses** — one tap surfaces cross‑references for the current verse.
- **Pinned list** — pin passages from search, related verses, or the activity
  feed into a running list you can reorder, step through live, and import/export
  as JSON.
- **Presenter themes** — light, sepia, dark, and high‑contrast, plus font size,
  synced live to the screen.
- **Live and multi‑operator** — every device stays in sync in real time and sees
  who else is connected. Remembered settings return on your next session.
- **Installable** — add the console to your phone's home screen and it launches
  fullscreen like a native app; the screen stays awake during a service.

## Quick start (self‑hosting)

OpenLectern runs on Cloudflare's free tier: **one Worker serves the built app
and the session API on a single origin**, with **one Durable Object per session**
for realtime. Nothing pauses on inactivity — a session code works whether it's
been minutes or months since the last service.

**Prerequisites:** Node.js 20+ and a free [Cloudflare](https://cloudflare.com)
account.

1. **Deploy the backend + app.** Follow [`cloudflare/README.md`](cloudflare/README.md).
   The quickest path is the included **GitHub Actions** workflow
   ([`.github/workflows/deploy-worker.yml`](.github/workflows/deploy-worker.yml)):
   add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repo secrets and push
   — it builds the app and `wrangler deploy`s the Worker. To deploy from your
   machine instead:

   ```bash
   VITE_API_BASE=same-origin npm ci && VITE_API_BASE=same-origin npm run build
   cd cloudflare && npm install && npx wrangler login && npx wrangler deploy
   ```

2. **Add a custom domain (optional).** In the dashboard: Workers & Pages → your
   Worker → Settings → Domains & Routes → Add → Custom Domain. Cloudflare handles
   DNS + HTTPS. The app is same‑origin, so it works on any hostname with no rebuild.

3. **Run locally.**

   ```bash
   npm install
   cp .env.example .env     # VITE_API_BASE=same-origin (or a deployed Worker URL)
   npm run dev              # the UI; /api is proxied to `npx wrangler dev` in cloudflare/ (port 8787)
   ```

Run the test suite with `npm test`.

## Bot protection (optional)

Creating a session and joining one with the PIN can be gated with
[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/), so scripts
can't mass‑create sessions or brute‑force a 4‑digit PIN. Watching a screen (code
only, read‑only) is never gated. It's off until you add the keys:

1. Dashboard → **Turnstile** → **Add widget** (hostname = your domain, mode
   *Managed*). Copy the site key and secret key.
2. In [`cloudflare/wrangler.toml`](cloudflare/wrangler.toml) set `[vars]`
   `TURNSTILE_SITE_KEY` to the **site key** and `TURNSTILE_HOSTNAMES` to the
   hostname(s) the app is served on (tokens solved anywhere else are refused).
   Then add the **secret key** as a GitHub repository secret named
   `TURNSTILE_SECRET` (Settings → Secrets and variables → Actions). The deploy
   workflow pushes it to the Worker as a Worker secret on every deploy. If you
   deploy by hand instead, set it directly:

   ```bash
   cd cloudflare && npx wrangler secret put TURNSTILE_SECRET
   ```

3. Deploy. The app reads the site key from `/api/config` at runtime (no rebuild),
   shows the check on the landing page and the join form, and the Worker verifies
   each token server‑side (success, the matching action `create-session` or
   `join-session`, and hostname) before acting. To turn it off, delete the Worker
   secret (dashboard → the Worker → Settings → Variables and Secrets) and remove
   the GitHub secret so a later deploy doesn't restore it.

For local development, Cloudflare's test keys always pass: site key
`1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.

## Monitoring

[`.github/workflows/uptime.yml`](.github/workflows/uptime.yml) checks the health
endpoint, the app shell, and that the Turnstile gate is still on every 15
minutes. A failed run emails the repository owner through GitHub's normal
workflow notifications, so no separate uptime service is needed. Run it by hand
from the Actions tab to test.

## Architecture

- **Frontend** — Vite + React 18, plain CSS, hash routing (`#/`, `#/present`,
  `#/control`). A static bundle, served by the Worker.
- **Backend** — a Cloudflare **Worker** ([`cloudflare/`](cloudflare/)) serves the
  app and routes `/api/*` (and the realtime WebSocket) to a **Durable Object** per
  session code. Each Durable Object holds that session's config and live state,
  verifies the 4‑digit PIN server‑side (PBKDF2 via Web Crypto), and fans state +
  presence + peer broadcasts out over one WebSocket — so updates reach every device
  instantly. A 24‑hour alarm expires the session (sliding: it extends while the
  session is in use), and creation is rate‑limited per IP. There is no database to
  provision and nothing pauses.
- **Verse text** — bundled as public‑domain JSON per book under
  `public/bibles/<versionId>/`, with the [HelloAO](https://bible.helloao.org) API
  as a runtime fallback for translations you haven't bundled.
- **Installable** — a web manifest + icons make the console installable to a phone
  home screen and launch fullscreen (standalone).

## Bible data

Three English public‑domain translations are bundled by default — the World
English Bible (WEB), King James Version (KJV), and American Standard Version
(ASV) — plus the Tamil IRV. Add more:

```bash
npm run convert:usfx                      # bundle the WEB (English)
npm run fetch:scrollmapper KJV kjv "King James Version"       # bundle the KJV
npm run fetch:scrollmapper ASV asv "American Standard Version" # bundle the ASV
npm run fetch:helloao list ta             # browse HelloAO translations
npm run fetch:helloao tam_irv             # bundle a translation (e.g. Tamil IRV)
```

Only public‑domain translations can be bundled or served; copyrighted texts
(NIV, ESV, …) are not distributable and are intentionally omitted.

Output lands in `public/bibles/<versionId>/` with a shared `manifest.json`.

## Related verses & named passages

- **Cross‑references** come from the [openbible.info](https://www.openbible.info/labs/cross-references/)
  dataset (**CC BY**, built on the public‑domain Treasury of Scripture
  Knowledge). Rebuild the bundled per‑book chunks:

  ```bash
  curl -sL https://a.openbible.info/data/cross-references.zip -o x.zip && unzip x.zip
  node scripts/build-xrefs.mjs cross_references.txt
  ```

- **Named‑passage aliases** live in [`src/data/aliases.json`](src/data/aliases.json).
  English coverage is first‑class; other languages are intentionally sparse and
  community‑growable (see the file's `contributing` note). Every alias reference
  is verified to parse by the test suite.

## Privacy & security

- **No personal data.** No accounts, no emails. Sessions are anonymous and expire
  after 24 hours.
- **PINs never leave the server in plaintext.** Only a salted PBKDF2 hash is
  stored and verified server‑side; the 4‑digit PIN is intentionally low‑security
  for short‑lived, in‑room sessions, and wrong‑PIN attempts are rate‑limited.
- **Second‑controller invites are end‑to‑end encrypted.** A one‑time invite code
  authenticates the joining device, and the PIN is handed off under a fresh
  per‑exchange key agreement (ECDH P‑256) — so a view‑only device watching the
  session channel can never recover it.
- **Voice is on‑device‑controlled.** Voice assist uses the browser's built‑in Web
  Speech API (Chrome/Edge), so transcription is performed by the browser vendor's
  service and needs an internet connection. OpenLectern never records, stores, or
  sends audio or transcripts to its own storage — only the chosen reference goes
  through the normal show path. The mic runs only on a controller, never on the
  presenter, and only while voice is on.

## Tech stack

React 18 · Vite · plain CSS · Cloudflare Workers + Durable Objects · Vitest.

## Contributing

Issues and pull requests are welcome — new translations, named‑passage aliases
(especially non‑English), bug fixes, and accessibility improvements especially.
Please run `npm test` and `npm run build` before opening a PR.

## License

MIT for the code and alias curation — see [LICENSE](LICENSE). Bundled scripture
is public domain (World English Bible, King James Version, American Standard
Version; the KJV/ASV text is from the public‑domain
[scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases)
project). Other translations load from the HelloAO API under their own terms.
Cross‑references are CC BY (openbible.info) and require the attribution shown in
the app's footer.
