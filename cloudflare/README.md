# OpenLectern on Cloudflare

The session backend as a Cloudflare **Worker** plus one **Durable Object** per
session code. This replaces the Supabase table, its PIN‑guarded RPCs, and its
realtime channel — and, unlike the Supabase free tier, **nothing pauses on
inactivity**. A Durable Object simply goes dormant when idle and is recreated on
the next request with its storage intact.

## What's here

- `src/index.js` — the Worker: routes `/api/session*`, generates session codes,
  adds CORS, forwards to the Durable Object.
- `src/session-do.js` — the `SessionDO` Durable Object: stores the session,
  verifies the 4‑digit PIN (PBKDF2 via Web Crypto), and fans state / presence /
  peer broadcasts out over WebSocket. A 24‑hour `alarm()` self‑deletes the session.
- `wrangler.toml` — Worker + Durable Object config (SQLite class, free‑tier friendly).

## Deploy

```bash
cd cloudflare
npm install
npx wrangler login          # once, opens a browser
npx wrangler deploy         # prints your Worker URL
```

The deploy prints a URL like `https://openlectern-api.<your-subdomain>.workers.dev`.
That is your `VITE_API_BASE`.

Then point the frontend at it and rebuild:

```bash
# from the repo root
echo "VITE_API_BASE=https://openlectern-api.<your-subdomain>.workers.dev" > .env
npm run build
```

Deploy `dist/` to any static host. For an all‑Cloudflare setup, connect the repo
to **Cloudflare Pages** (build command `npm run build`, output `dist`) and set
`VITE_API_BASE` in the Pages build environment.

## Locking down CORS (optional)

By default the Worker allows any origin (the endpoints are public and PIN‑gated
for writes). To restrict it to your site, set `ALLOWED_ORIGIN`:

```bash
npx wrangler deploy --var ALLOWED_ORIGIN:https://your-site.pages.dev
```

## API

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/api/session` | `{ pin, config }` | new session row (unique code) |
| POST | `/api/session/:code/join` | `{ pin }` | session row, or 401 |
| GET | `/api/session/:code/view` | — | session row (read‑only, no PIN) |
| PATCH | `/api/session/:code` | `{ pin, patch }` | merged row; pushes to all clients |
| GET | `/api/session/:code/ws` | — | WebSocket (state / presence / broadcast) |

`patch` may contain `state` (shallow‑merged), `config`, or `admins` (replaced) —
the same contract as the old `update_session` RPC.

## Notes

- **PIN security.** The PIN is hashed with PBKDF2 (100k iterations, random salt)
  and only ever verified server‑side, never returned. The Durable Object also
  rate‑limits wrong‑PIN attempts (short lockout after 5 failures) — a small
  improvement over the Supabase version.
- **Expiry.** Sessions expire 24h after creation via a Durable Object alarm that
  deletes the storage and closes sockets. There is no cron to run.
- **Cost.** Workers and SQLite‑backed Durable Objects are available on the free
  plan; confirm current limits for your account.
