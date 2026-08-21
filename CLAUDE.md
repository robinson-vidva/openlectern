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

- Landing page: exactly two actions. "Start" (one tap: generates a non-ambiguous
  4-digit PIN, creates the session with default/remembered config, and lands the
  creator DIRECTLY in the live controller -- no interstitial, no decisions) and a
  "Join" area with a single code field: "Watch" opens the view-only presenter
  (code only); a quiet "I have a PIN" expander reveals the PIN field + "Control"
  and the "Join with an invite code instead" path. Translations are NOT chosen at
  creation -- they are switchable in-session (Display tab). See "Start/join flow"
  under Shipped for remembered-config + handoff details.
- Presenter page (church projector or a shared browser tab in Zoom): joined with
  code only (view-only), shows the code on screen but NEVER the PIN. A ?s=CODE URL
  opens it directly (no click). Fullscreen button.
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
- src/components/useVoice.js + VoiceControls.jsx + VoiceChips.jsx - the voice
  engine (a hook) and its two presentational pieces, split so the chips can live
  in a persistent slot while the controls live in a tab.
- scripts/convert-usfx.mjs, scripts/fetch-helloao.mjs, scripts/manifest.mjs.

## Controller information architecture (dashboard layout)

The controller is a dashboard (`.console`), not a single mobile column. Zones:
- TOP BAR (full width): wordmark + code + connection dot; the VOICE control is
  pinned here (a pulsing "Listening" pill with Start/Stop, Auto toggle, and the
  recognition-language select) so mic state is always visible; then admin count,
  a Listener-mode button, and a gear that opens the settings modal.
- LEFT ACTIVITY RAIL (`.activity` / `.feed`): ONE live feed replacing the old chip
  slot + History tab. Newest first: a listening/transcript line, then detection
  cards (voice, cross-device shared, quote/auto badges, source device name),
  listener-health notices, then a "Shown earlier" history list -- every card taps
  to show. Ends with the quote-catch honest-limitation note.
- MAIN column (`.console-main`): the NOW card (reference, first line, position +
  mode pill, verse-jump, live per-screen stepper, Related, Back-to-plan, Blank
  state), then a "Find a passage" card (fast book search + preview + Show/Add) and
  a "Plan" card (queue with per-item notes + paste-a-plan + import/export).
- SETTINGS MODAL (gear, `.settings-sheet`): a card grid -- a Share card (code, QR
  tap-to-enlarge, copy watch/control links, Show PIN, Invite device, open screen),
  Translations, Presenter theme, Font size, Verses-per-screen, and an In-this-
  session card (admins, Reset remembered, Leave). This replaced the old dropdown.
- TRANSPORT (bottom row of the console): Back / Blank / Next.
- Responsive: >=900px is a two-column [rail | main] grid with independent scroll;
  below 900px the rail stacks above the Now card (capped height, own scroll) and
  the voice bar wraps full-width under the top row. Light palette only (presenter
  themes are separate, in state.display). The old tabbed layout (GO/PLAN/HISTORY/
  DISPLAY) and floating chip slot are gone; VoiceControls/VoiceChips components are
  unused by the console (voice + chips are rendered inline).

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
  ("Move a displayed verse up/down" = this continue-stepping. Robinson confirmed
  no on-screen text-position nudging; only revisit if real usage shows text
  sitting awkwardly.)
- Sharing: session-ready screen opens the presenter in a new tab and offers
  Copy presenter/controller link buttons (?s=CODE, PIN never in a URL); presenter
  is view-only (see Notable decisions).
- History of shown verses (controller collapsible section, tap to re-show).
- Presenter themes (light/sepia/dark/high-contrast) + font size 80-140%, synced
  live from any controller.
- Discreet session code on the presenter: once content is showing, the code
  becomes a small info dot (reveals code + join hint on hover/focus/tap, auto-
  dismiss, never the PIN); the idle screen still shows it prominently.
- Legibility floor + pagination (src/lib/paginate.js, MIN_FONT_VMIN + PAGE_CAPACITY
  tunable, unit-tested). Auto-fit shrinks only to the floor; long whole passages
  paginate on verse boundaries instead (both languages page together via combined
  per-verse weights). wholeCurrent carries { page, pageCount }; presenter shows a
  corner "p/N" marker; Back/Next page before leaving the passage; the Now-card
  shows the page position and the verse-jump row jumps to a verse's page. Step
  mode / single verses never paginate.
- Start/join use the same light identity as the controller (weighted CTA, gold
  code badge). The controller stays LIGHT (Robinson's preference); presenter
  themes are the only dark surface.
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
- Live translation switching (Display tab): Primary + Secondary pickers (Secondary
  has "None"). Bundled versions are instant; HelloAO-only versions are marked
  "Online (needs internet)". Changing them writes config via the normal
  update_session path (no schema change) and fans out to every client, which
  re-resolves the SHOWN reference against the new translations in place: same verse
  in step mode, same page in whole mode (repaginate, then map the current verse to
  its new page). Secondary -> None reflows to single language. `current` stores a
  structured `ref` { bookId, chapter, verseStart, verseEnd } so re-resolution never
  depends on parsing a possibly-non-English `reference` string. Voice detection
  follows the active translations (book-index rebuilds on version change; Tamil
  names from the translation index); if a switched-to version has no local
  structure it degrades to bundled WEB structure, never the wrong version silently.
- PIN reveal + one-time invite (session panel). The server only ever stores a
  bcrypt hash and can never return the PIN, so recovery only flows FROM a device
  that already knows it. "Show session PIN" reads the PIN from sessionStorage (no
  network). "Invite device" mints a single-use 6-digit code (60s countdown); the
  new device chooses "Join with an invite code", enters session code + invite code,
  and an ephemeral realtime handshake delivers the PIN: requester broadcasts a
  proof = sha256(inviteCode:nonce) + nonce; the inviting controller verifies the
  proof against its live invite, then returns the PIN AES-GCM-encrypted under a key
  derived (PBKDF2) from inviteCode + nonce; the requester decrypts and joins as a
  normal controller. Threat model: the invite code is the shared secret and never
  travels in the clear; the PIN is never broadcast in plaintext and never in a URL;
  the invite is single-use, expires in 60s, and any attempt (right or wrong) burns
  it. All crypto is Web Crypto in src/lib/crypto.js (+ src/lib/invite.js), unit-
  tested (derive/encrypt/decrypt roundtrip, wrong-code failure, expiry). No schema
  change: the handshake rides the existing broadcast channel.
- Listener mode (split voice roles). A "Listener mode" toggle turns a controller
  into a dedicated listener: mic on, wake lock, a simplified near-fullscreen view
  (big mic status, live transcript, plug-in reminder, exit button) meant to sit
  face-up at the pulpit. Detected suggestions from ANY listening device broadcast
  as ephemeral SIGNED events on the session channel (HMAC key = 'pin:' + PIN, so
  only PIN holders can forge/verify; never written to the table). Every controller
  renders the shared chip in the existing chip slot, labeled with the source
  device's name; cross-device dedupe collapses the same ref within ~10s to one
  chip (recentRef map). Tapping shows via the normal path (logged to history).
  Listener health is first-class: a `listening` flag in presence metadata lets
  other controllers show "Listening: <name>" and a banner when a listener drops.
  Auto mode on a listener behaves exactly like local auto. Pure parts (cross-device
  chip dedupe, presence -> health mapping in src/lib/listener.js) are unit-tested.
  No schema change: broadcast + presence only.
- Tamil recognition-language fix: switching the voice recognition language while
  the mic was running recreated SpeechRecognition before the old session released,
  so Chrome threw on .start() and the swallowed error silently killed transcription.
  Now the new recognition starts only after the old session's onend fires, and a
  language-not-supported error surfaces as a clear operator message instead of a
  dead mic. AWAITS real-mic verification on Chrome (headless mic could not
  reproduce the exact field failure).
- Named-passage aliases ("show the prodigal son"). src/data/aliases.json is a
  curated, community-growable table (145 entries: parables, events, famous
  passages) mapping canonical names + alternate phrasings to references (a single
  ref, or 2-3 where accounts differ, e.g. the Lord's Prayer in Matthew and Luke).
  Every ref is within a SINGLE chapter because the parser does not span chapters;
  multi-chapter narratives point at a representative chapter/range. Tamil aliases
  are intentionally sparse (only confident proper-noun transliterations sourced
  from the bundled Tamil vocabulary); the file's contributing note explains how to
  grow it. matchAliases in src/lib/aliases.js is pure and unit-tested: case/
  punctuation-insensitive, anchors on each phrase's most distinctive word so a bare
  generic word ("chapter") never matches. Two integration points: (1) typed input
  offers alias suggestions when a reference fails to parse (tap fills the ref;
  never auto-picks among ambiguous hits); (2) voice runs alias matching on FINAL
  segments with no detected citation, producing chip-only suggestions labeled
  "name -> ref" (confidence 'alias', never auto-shown even in AUTO mode).
- Related verses (cross-references). Dataset: openbible.info cross-reference set
  (CC BY, built on the public-domain Treasury of Scripture Knowledge); attribution
  is in the Start-page footer and the README. scripts/build-xrefs.mjs (npm run
  build:xrefs) converts the openbible TSV to public/xrefs/<BOOKID>.json =
  { "chapter:verse": ["Display Ref", ...] }, capped to the ~10 strongest per verse
  by vote; OSIS codes map to our BOOKIDs, cross-chapter target ranges clamp to the
  start verse so every ref parses. 66 chunks, ~3.9 MB total, committed and lazy-
  loaded per book only when the Related panel opens (src/lib/xrefs.js, cached).
  Runtime: the Now card gets a small collapsed-by-default "Related" toggle; opening
  it shows up to 10 cross-references as ref chips with a one-line primary-
  translation preview; tap -> normal show path, logged to history with source
  "related". It remembers nothing (collapses + clears whenever the shown verse
  changes). DECISION: the anchor verse is current.ref.verseStart, which is the
  current verse in step mode and the passage's FIRST verse in whole mode. Pure
  lookup + capping and a John 3:16 sanity check are unit-tested.

- Cross-chapter references. The ref model gained endChapter (=== chapter for the
  common single-chapter case), so the parser accepts "Matthew 5-7", "Genesis
  1:1-2:3", "Matt 5:3-7:29", "Psalm 22-24" (formatRange in parseRef.js renders
  them back). getPassage gathers verses across the span; each verse carries its
  chapter c and a label (bare "n" in the first chapter, "c:n" after a boundary) so
  the congregation always knows the position. Step mode and pagination walk across
  boundaries via the flat verse list; step-mode reference uses the verse's own
  chapter (Matthew 6:9) and secondary alignment matches on chapter+verse. Voice
  gains "chapters five through seven" / "chapter one verse one through chapter two
  verse three", validating BOTH endpoints against structure. Guardrail:
  MAX_PASSAGE_VERSES (400, in paginate.js) refuses an over-long span (e.g. Genesis
  1-50) with a clear message. Aliases upgraded to true ranges (Sermon on the Mount
  -> Matthew 5-7, Creation -> Genesis 1:1-2:3, the Flood -> Genesis 6-9, Job 1-2).
- Quotation detection, stage 1 (exact / near-verbatim, phrase-matching only). A
  build script scripts/build-quote-index.mjs (npm run build:quoteidx) turns each
  bundled translation into public/quoteidx/<versionId>.{bin,json}: normalized text
  (Tamil script kept), 4-word shingles hashed to 32-bit (all-stopword shingles
  skipped), packed as sorted keys + offsets + packed verse locations (loc =
  bookIdx<<16 | chapter<<8 | verse). Sizes: eng-web ~6.6 MB (~4.1 MB gzip),
  tam_irv ~4.0 MB (~2.5 MB gzip). At runtime a Web Worker (src/workers/
  quoteWorker.js) lazy-loads the indexes for the ACTIVE translations when voice
  starts (reloads on translation switch) and scans a rolling ~20-word window
  (WINDOW_WORDS) on each final segment, off the main thread. scanWindow scores each
  verse by the longest run of consecutive-ish matched words, tolerating one small
  gap (a changed/dropped word leaves exactly one uncovered index), and fires only
  at MIN_MATCH_WORDS = 6 (three back-to-back 4-grams) so commonplaces never match.
  Tuning constants live in src/lib/quote/quoteIndex.js. Top hits become chips with
  a distinct "quote" badge + matched-verse preview; QUOTE CHIPS NEVER AUTO-SHOW
  regardless of the auto toggle (confidence 'quote' is not 'high'), and otherwise
  flow through the existing chip slot, dedupe, listener-mode sharing, and history
  unchanged. HONEST LIMITATION (surfaced in the voice UI copy): matching is against
  the LOADED translations' wording -- a pastor quoting a different remembered
  wording (e.g. KJV while the session runs WEB) may not match; that gap is what the
  future semantic stage is for. Very short verses (esp. agglutinative Tamil, e.g.
  Genesis 1:1 at ~4 whitespace tokens) cannot reach the 6-word threshold. Pure
  parts unit-tested with 30+ fixtures (verbatim both testaments, near-verbatim,
  cross-segment, Tamil verbatim, negatives); measured scan ~0.01 ms/window.
- Start/join flow redesign (fewest decisions before a session is live). Landing =
  two actions (see User flow). "Start" is one tap: generatePin() (src/lib/newpin.js,
  rejects all-same and straight runs like 0000/1234, unit-tested) + createSession
  with default (eng-web) or REMEMBERED config, then hands the fresh row+creds to
  the controller route via an in-memory handoff (src/lib/handoff.js; survives the
  hash nav, taken once, no re-join) and navigates -- the creator never sees a PIN
  prompt or interstitial (the old "session ready" screen is deleted). Per-tab creds
  are also cached in sessionStorage so a controller reload silently rejoins and
  "Show PIN" still works; a shared control link (new tab, no cache) still shows the
  PIN form. Remembered config (src/lib/prefs.js, localStorage 'ol-prefs'): the
  Display tab's translation changes and theme/font are persisted whenever they
  change in-session and reused silently at the next Start (translations feed
  create_session's config; the creator applies remembered theme/font via one
  patchState on mount). "Reset remembered settings" in the session panel clears it.
  One-time first-run hint on the controller points at the session panel (localStorage
  'ol-hint-seen'). Join: "Watch" -> #/present?s=CODE which auto-joins view (Present
  no longer needs a click when the code is in the URL); "Control" joins inline with
  code+PIN then hands off; invite path delegates to JoinForm via ?invite=1. Session
  panel now carries the code, a client-side QR of the presenter link (src/components/
  Qr.jsx via qrcode-generator, no network; tap to enlarge for cross-room scanning),
  Show PIN, Open the screen, Copy presenter/controller links, and Reset. NO schema
  change: create_session already took config; everything else is client state.

- Operator UX pass (search, pagination control, plan input) + light visual polish.
  (1) Fast reference search: three-stage type-ahead in the Go input -- book, then
  chapter, then verse. searchBooks (parseRef.js) offers book chips; once a book is
  settled (a chapter digit, or a trailing space after a recognized book)
  parsePartialRef drives chapter chips, then verse chips, each validated against
  the primary version's structure.json (WEB fallback), so tapping Book -> N -> V
  builds "Book N:V" with no number typing. Both pure + unit-tested; Enter shows
  immediately. (2) Manual verses-per-
  screen: display.versesPerScreen (0 = auto by weight) overrides pagination for
  whole passages; paginateVerses in paginate.js groups exactly N verses/page even
  if a page then hits the legibility floor (the operator's explicit choice).
  Adjustable from the Display tab (Auto/2/4/6/8/10/12) AND a live -/+ stepper on
  the NOW card; changing it remaps the current page to keep the shown verse
  visible and fans out to the presenter, which re-pages. passagePages/pageOfVerse
  now take a perPage arg threaded through every pagination site (Present, Back/
  Next, verse-jump, translation re-resolve). (3) Plan input: each queue item gains
  an operator-only note (never shown on the big screen; included in export/import),
  and a "Paste a plan" box extracts every reference from a pastor's free-text note
  (extractReferences in planText.js, pure + unit-tested: splits on list separators
  + scans prose, dedupes, keeps order) and adds them in one action. (4) Visual
  polish: warmer landing backdrop + wordmark rule, softer first-run hint,
  consistent section labels. No schema change (versesPerScreen rides state.display;
  notes ride state.queue items).

## AI roadmap

- Session B stage 2 (NEXT, PARKED - do not build now): semantic quotation matching
  (embeddings / paraphrase tolerance) so a verse quoted in a wording other than the
  loaded translation still surfaces. Stage 1 (exact/near-verbatim) shipped above.

## Parked for later (do not build now)

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
