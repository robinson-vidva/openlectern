# OpenLectern - project spec and working notes

Open-source bilingual bible verse presenter for churches and Zoom prayer
meetings. A fullscreen presenter page shows scripture in up to 2 languages; any
number of people control it live from phones or desktops. Zero setup for users,
no accounts, no installs. MIT license.

## Design law (never violate)

1. Usable by a non-technical church volunteer in under a minute. No setup.
2. No PII stored. No emails, no accounts in v1. Sessions are ephemeral.
3. Keep it simple; improve later with feedback. When in doubt, less.

## User flow

- Start page: "Start a session" -> pick 1 or 2 bible translations -> choose a
  4-digit PIN -> receive a short random session code (like K7PM4Q).
- Presenter page (church projector or a shared browser tab in Zoom): joined with
  code + PIN, shows the code on screen but NEVER the PIN. Fullscreen button.
  White/beige background, dark text, large auto-fitting serif type, reference
  shown above the verses, second language below a subtle divider.
- Controller page (mobile-first): join with code + PIN, optional display name.
  Type a reference ("John 3:16-18", "1 Cor 13", "Psalm 23:1-6" - forgiving
  parser), preview both languages, Show now, Add to queue, reorder/remove queue
  items, and a fixed bottom bar: Back / Blank / Next. Import/export the queue as
  a JSON file. Multiple admins on one session see the same live state and who
  else is connected.

## Architecture (settled - do not redesign)

- Static frontend: Vite + React, hash routing (#/, #/present, #/control).
  Deployed to GitHub Pages by a GitHub Actions workflow (Pages source = GitHub
  Actions). No server anywhere. `vite.config.js` base is `/openlectern/`.
- Supabase (free tier) is the only external service. One table:
  sessions(code text pk, pin_hash text, config jsonb, state jsonb, admins jsonb,
  created_at timestamptz, expires_at timestamptz).
  state = { current, queue, blank }. expires_at = created_at + 24h.
- The anon key ships in the static build, so the table allows NO direct
  insert/update/delete. All writes go through SECURITY DEFINER SQL functions
  (RPCs) that enforce the PIN server-side using pgcrypto crypt():
    create_session(pin, config) -> code
    join_session(code, pin) -> full row or error
    update_session(code, pin, patch jsonb) -> merged row
  Expired rows are rejected on join and cleaned up opportunistically. All SQL is
  in supabase/schema.sql (paste into the Supabase SQL editor). App reads
  VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from .env (gitignored,
  .env.example provided).
- Realtime: all devices subscribe to postgres_changes on their session row;
  every update fans out to presenter + all admins. Presence (who is online) via
  the same Supabase channel, never written to the table.
- Verse data: public-domain only, bundled as static JSON per book:
  public/bibles/<versionId>/<BOOKID>.json with { id, name, chapters:
  [["v1 text","v2 text",...], ...] }, plus index.json and a manifest.json listing
  bundled versions. English WEB comes from open-bibles USFX via
  scripts/convert-usfx.mjs (strips <f>/<x> notes). HelloAO translations via
  scripts/fetch-helloao.mjs (Tamil IRV = tam_irv). Runtime verse loading:
  bundled JSON first, HelloAO API as fallback.
- Never generate scripture text. Only from source files or APIs.

## Key files

- supabase/schema.sql - table, RLS, three RPCs, realtime.
- src/lib/parseRef.js, src/lib/books.js - forgiving reference parser (66 books).
- src/lib/bibleData.js - bundled-first verse loader with HelloAO fallback.
- src/lib/session.js - RPC wrappers + realtime/presence channel.
- src/pages/{Start,Present,Control}.jsx - the three screens.
- scripts/convert-usfx.mjs, scripts/fetch-helloao.mjs, scripts/manifest.mjs.

## Data shapes

- config = { versions: [{ id, name, language, helloaoId }] } (1 or 2 entries).
- state.current = { id, step, reference, primary, secondary }, where primary/
  secondary is { language, verses: [{ n, text }] }. In step mode `step` is true,
  `verses` holds a single verse, and `reference` includes the verse number
  (e.g. "Psalm 23:4"). The presenter renders `current` verbatim; it needs no
  knowledge of stepping.
- state.queue = [{ id, input, label, whole }]. `whole` false (default) = step
  verse-by-verse; true = show the whole passage as one screen.
- state.cursor = { queueId, verseIndex, adhoc?, savedPlan? } marks what is shown.
  queueId null = an ad-hoc show (Show now / voice). `adhoc` = { bookId, chapter,
  first, last, count } lets Back/Next keep stepping through the chapter from an
  ad-hoc verse; `savedPlan` = { queueId, verseIndex } preserves the plan position
  so "Back to plan" restores it. Older sessions may lack cursor/whole/step/adhoc;
  all readers default them safely.
- state.blank = boolean.
- state.history = [{ ref, at, source }] newest-first, capped 100, source one of
  manual|queue|voice|auto (pure appendHistory in src/lib/history.js, unit-tested).
  Ephemeral with the session; included in the queue export, ignored on import.
- state.display = { theme, fontScale } (theme light|sepia|dark|contrast; fontScale
  80-140). Synced live; presenter applies theme via `.present.theme-<t>` tokens
  and multiplies the auto-fit size by fontScale/100. Missing = light/100.
- Back/Next step verse-by-verse within an item, then cross item boundaries
  (Next past the last verse -> next item's start; Back before the first verse ->
  previous item's end). At the plan's ends they only flash a controller-only
  "End/Start of plan" hint and never change the presenter by surprise. From an
  ad-hoc verse they continue through the chapter (chapter-boundary hint).

## Notable decisions

- Presenter/viewer role is CODE-ONLY (no PIN): join_session_view(code) returns
  the public row (migration supabase/migrations/001; the app falls back to a
  direct RLS-guarded SELECT if the RPC is not installed). Presenters never write,
  and code-only reads were already possible via the realtime SELECT policy, so
  this is not a new exposure -- it just makes the presenter link freely shareable
  (e.g. a Zoom viewer). Control still needs code + PIN. Links carry ?s=CODE; the
  PIN is never in a URL.
- Controllers resolve verse text and write the fully-resolved `current` into
  state, so the presenter just renders (no version mismatch, small logic).
- update_session shallow-merges `state` (jsonb ||), so one controller updating
  `current` never clobbers another's `queue` edit.
- Fonts are chosen by block language (`[lang="ta"]` -> Noto Serif Tamil), not by
  position, so either language can be primary.
- pin_hash protection (verified live): client roles get a column-level SELECT
  grant on every column except pin_hash, so it never appears in REST reads or in
  realtime payloads. Realtime delivery needs REPLICA IDENTITY FULL so the RLS
  policy (expires_at > now()) can be evaluated; the column grant still filters
  pin_hash out of the broadcast. Direct insert/update/delete are denied (42501).
  A 4-digit PIN is intentionally low-security for ephemeral sessions.
- The three RPCs being anon-executable is flagged by the Supabase linter; that is
  by design (a no-auth, PIN-guarded public API). Internal helpers
  (cleanup_expired_sessions, session_public) have EXECUTE revoked from clients.

## Shipped after v1

- Verse-by-verse stepping inside a passage (STEP is the default; per-item
  "whole passage" toggle). Controller shows a "n / total" indicator and a
  tappable verse list to jump directly. Presenter shows the single current verse
  in both languages. See Data shapes (cursor) above.
- Continue stepping from an ad-hoc shown verse (Show now / voice): Back/Next keep
  moving through the chapter; a "Back to plan" button restores the queue position.
  PENDING QUESTION for Robinson: he asked for "a way to move a displayed verse up
  or down"; this was built as continue-stepping. Confirm he did NOT also mean
  physically nudging the text's position on the presenter screen -- if he did,
  that is a separate small follow-up (do not build unprompted).
- Sharing: session-ready screen opens the presenter in a new tab and offers
  Copy presenter/controller link buttons (?s=CODE, PIN never in a URL); presenter
  is view-only (see Notable decisions).
- History of shown verses (controller collapsible section, tap to re-show).
- Presenter themes (light/sepia/dark/high-contrast) + font size 80-140%, synced
  live from any controller.
- Voice mode on the controller (Web Speech API; Chrome/Edge only). CONFIRM is the
  default (detected refs become chips, tap to show); an AUTO toggle shows only
  high-confidence detections (exact book + verse validated in bounds) instantly,
  logging a chip so the operator can tap back. Mic runs only on the controller,
  never the presenter; no audio/transcript leaves the device. Core detection is a
  pure, unit-tested detectRefs(transcript, bookIndex) in src/lib/voice/ validated
  against per-chapter verse counts (public/bibles/<v>/structure.json); fixtures +
  vitest run in the Tests CI workflow. Single-verse detections carry verseEnd
  null and must be normalized to verseEnd=verseStart before getPassage (which
  treats null as "to end of chapter").

## Parked for later (do not build now)

- Themes (NEXT planned item: presenter background + type-size options synced
  from the controller).
- Named/saved service plans.
- Accounts via linking anonymous auth to email.
- Stage display.
- OBS overlay route.
- Offline Whisper.
- LAN mode.
- Org transfer of the repo.

## Working style

- Ask before deviating from anything above.
- No unicode emojis in any script or code.
- No long readme-style comment blocks inside scripts. Keep the README concise.
