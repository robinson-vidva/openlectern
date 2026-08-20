# OpenLectern

Open-source bilingual bible verse presenter for churches and Zoom prayer
meetings. A fullscreen presenter shows scripture in up to two languages while
anyone controls it live from a phone or laptop. No accounts, no installs, no PII.

- **Start** a session: pick one or two translations, choose a 4-digit PIN, get a
  short code (like `K7PM4Q`).
- **Present** (`#/present`): join with the code + PIN on the projector or a shared
  Zoom tab. Large auto-fitting serif type, fullscreen, code shown but never the PIN.
- **Control** (`#/control`): join from any phone. Type a reference
  (`John 3:16-18`, `1 Cor 13`, `Psalm 23:1-6`), preview, show, queue, reorder,
  import/export, and a fixed Back / Blank / Next bar. Multiple controllers stay in
  sync and see who else is connected.
- **Voice** (on the controller): let the phone's mic listen to the speaker;
  detected references appear as chips you tap to show, or auto-show strong
  matches. Confirm mode by default.

## Voice mode and privacy

Voice mode uses the browser's built-in Web Speech API (Chrome or Edge). Speech
recognition is performed by the browser vendor's own service, so voice mode needs
an internet connection and the audio is transcribed off-device by that vendor.
OpenLectern never records, stores, or sends any audio or transcript to its own
storage; detection runs entirely in the page and only the chosen reference (never
the audio) goes through the normal show path. The mic runs only on the controller,
never on the presenter, and only while you have voice mode on.

## Stack

Static Vite + React frontend on GitHub Pages. Supabase (one table, PIN-guarded
`SECURITY DEFINER` RPCs, realtime) is the only backend. Verse text is bundled as
public-domain JSON (World English Bible) with the HelloAO API as a fallback.

## Develop

```bash
npm install
cp .env.example .env   # fill in your Supabase URL and anon key
npm run dev
```

Run `supabase/schema.sql` once in the Supabase SQL editor.

## Bible data

```bash
npm run convert:usfx           # bundle the WEB (English)
npm run fetch:helloao list ta  # browse HelloAO translations
npm run fetch:helloao tam_irv  # bundle Tamil IRV
```

Output lands in `public/bibles/<versionId>/` with a shared `manifest.json`.

## License

MIT.
