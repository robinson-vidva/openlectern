# OpenLectern on Cloudflare

One Cloudflare **Worker** serves the built React app **and** the session API on a
single origin, with one **Durable Object** per session code for realtime. This
replaces the Supabase table, its PIN‑guarded RPCs, and its realtime channel —
and, unlike the Supabase free tier, **nothing pauses on inactivity**. A Durable
Object simply goes dormant when idle and is recreated on the next request with
its storage intact.

The app is built with `VITE_API_BASE=same-origin`, so it talks to `/api` on
whatever host serves it — the `workers.dev` URL and any custom domain, with no
rebuild. `/api/*` (including the WebSocket) runs the Worker; everything else is
served from the built `dist/` with SPA fallback.

## What's here

- `src/index.js` — the Worker: routes `/api/session*`, generates session codes,
  adds CORS, forwards to the Durable Object.
- `src/session-do.js` — the `SessionDO` Durable Object: stores the session,
  verifies the 4‑digit PIN (PBKDF2 via Web Crypto), and fans state / presence /
  peer broadcasts out over WebSocket. A 24‑hour `alarm()` self‑deletes the session.
- `wrangler.toml` — Worker + Durable Object config (SQLite class, free‑tier friendly).

## Deploy

**Recommended — GitHub Actions** (`.github/workflows/deploy-worker.yml`): it builds
the app and runs `wrangler deploy` on every push to `main`. Add two repo secrets
(`CLOUDFLARE_API_TOKEN` from the "Edit Cloudflare Workers" template, and
`CLOUDFLARE_ACCOUNT_ID`) and push.

**Or locally:**

```bash
# from the repo root -- build the app first (the Worker serves dist/)
VITE_API_BASE=same-origin npm ci && VITE_API_BASE=same-origin npm run build
cd cloudflare
npm install
npx wrangler login          # once, opens a browser
npx wrangler deploy         # uploads the Worker + Durable Object + ../dist
```

The deploy prints a URL like `https://openlectern.<your-subdomain>.workers.dev`
serving the whole app.

## Custom domain

Because the app is same-origin, just map a hostname to the Worker — no rebuild:
in the dashboard, **Workers & Pages → openlectern → Settings → Domains & Routes →
Add → Custom Domain**, enter e.g. `openlectern.askdevotions.com`. Cloudflare
creates the DNS record and HTTPS certificate automatically (the domain must be a
zone on the same account).

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
