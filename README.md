# OpenLectern

**Show scripture on a screen. Control it from any phone.**

OpenLectern is a free, open-source bilingual Bible‑verse presenter for churches
and online prayer meetings. A fullscreen presenter displays scripture in up to
two languages while anyone in the room controls it live from a phone or laptop.

No accounts. No installs. No personal data. Sessions are ephemeral and expire
after 24 hours.

**Live demo:** https://robinsonvidva.com/openlectern/

---

## How it works

Three roles share one live session, identified by a short code (like `K7PM4Q`):

| Role | How you join | What it does |
| --- | --- | --- |
| **Start / Control** | One tap on the landing page, or join with the code + a 4‑digit PIN | The operator's console — search, queue, and drive the screen. |
| **Watch (Presenter)** | Open the shared link, or scan the QR — code only, no PIN | The big screen: large auto‑fitting serif type, fullscreen, no controls. |
| **Invite** | A second controller joins with a one‑time invite code | Add another operator without sharing the PIN in the clear. |

Starting a session is a single tap: OpenLectern generates a PIN, creates the
session, and drops you straight into the console. Your code, QR, and PIN live
behind the settings gear, ready to share.

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
- **Voice assist (Chrome/Edge)** — let the room's mic listen; spoken references
  become tap‑to‑show suggestions, and OpenLectern even catches scripture the
  speaker **quotes without citing**. Optional hands‑free **auto‑capture** puts a
  cited verse (or an announced chapter) straight on the screen, with a one‑tap
  **Undo** if it mishears. An optional **on‑device AI engine** (Whisper via
  WebGPU) transcribes mixed languages — e.g. English and Tamil in one service —
  entirely in the browser; the model downloads once and no audio leaves the
  device. A dedicated "listener mode" turns a spare phone into a pulpit mic.
- **Related verses** — one tap surfaces cross‑references for the current verse.
- **Pinned list** — pin passages from search, related verses, or the activity
  feed into a running list you can reorder, step through live, and import/export
  as JSON.
- **Presenter themes** — light, sepia, dark, and high‑contrast, plus font size,
  synced live to the screen.
- **Live and multi‑operator** — every device stays in sync in real time and sees
  who else is connected. Remembered settings return on your next session.

## Quick start (self‑hosting)

OpenLectern is a static site plus one Supabase project. You can run the whole
thing on free tiers.

**Prerequisites:** Node.js 20+, and a free [Supabase](https://supabase.com)
project.

1. **Set up the database.** In the Supabase SQL editor, run
   [`supabase/schema.sql`](supabase/schema.sql), then each file in
   [`supabase/migrations/`](supabase/migrations) in order. This creates the
   single `sessions` table and the PIN‑guarded functions; clients can never write
   to the table directly.

2. **Configure and run.**

   ```bash
   npm install
   cp .env.example .env     # add your Supabase URL and anon (publishable) key
   npm run dev
   ```

3. **Build and deploy.** `npm run build` produces a static `dist/`. Any static
   host works. This repo ships a GitHub Pages workflow
   ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)); set the Pages
   source to "GitHub Actions" and add `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
   as repository secrets. If you host under a subpath, update `base` in
   [`vite.config.js`](vite.config.js) to match.

Run the test suite with `npm test`.

## Architecture

- **Frontend** — Vite + React 18, plain CSS, hash routing (`#/`, `#/present`,
  `#/control`). Fully static; there is no application server.
- **Backend** — one Supabase project. A single `sessions` table holds each
  session's config and live state. The shipped anon key is public, so the table
  allows **no** direct writes: all changes go through `SECURITY DEFINER` SQL
  functions that verify the 4‑digit PIN server‑side with `pgcrypto`. Every device
  subscribes to its session row over Supabase Realtime, so updates fan out
  instantly; presence (who's online) rides the same channel and is never stored.
- **Verse text** — bundled as public‑domain JSON per book under
  `public/bibles/<versionId>/`, with the [HelloAO](https://bible.helloao.org) API
  as a runtime fallback for translations you haven't bundled.

## Bible data

The World English Bible (English, public domain) is bundled by default. Add more:

```bash
npm run convert:usfx           # bundle the WEB (English)
npm run fetch:helloao list ta  # browse HelloAO translations for a language
npm run fetch:helloao tam_irv  # bundle a translation (e.g. Tamil IRV)
```

Output lands in `public/bibles/<versionId>/` with a shared `manifest.json`.
The voice quote‑detection index is generated per bundled translation with
`npm run build:quoteidx`.

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
- **PINs never leave the server in plaintext.** Only a bcrypt hash is stored; the
  4‑digit PIN is intentionally low‑security for short‑lived, in‑room sessions.
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

React 18 · Vite · plain CSS · Supabase (Postgres + Realtime) · Vitest ·
GitHub Pages.

## Contributing

Issues and pull requests are welcome — new translations, named‑passage aliases
(especially non‑English), bug fixes, and accessibility improvements especially.
Please run `npm test` and `npm run build` before opening a PR.

## License

MIT for the code and alias curation — see [LICENSE](LICENSE). Bundled scripture
is public domain (World English Bible); other translations load from the HelloAO
API under their own terms. Cross‑references are CC BY (openbible.info) and require
the attribution shown in the app's footer.
