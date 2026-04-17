# Dou Di Zhu

Multiplayer [Dou Di Zhu](https://en.wikipedia.org/wiki/Dou_dizhu) (斗地主) with an authoritative
Node.js server and a vanilla JS/HTML client.

- `backend/` — Node.js (v20+) WebSocket server. Owns the deck, combination rules, turn order,
  landlord nomination, scoring, and per-seat projection. Never sends another player's hand to
  anyone else.
- `frontend/` — Vanilla JS/HTML/CSS client. Connects via WebSocket, renders state pushed by the
  server, sends actions over the same socket. No build step.
- `poker/` — Original single-device poker reference (host-authoritative, with bots). Kept
  purely for reference; **not used by the deployed app**.

**Modes.** 3 players → single deck (17 + 17 + 17 + 3 kitty). 4 players → double deck
(25 + 25 + 25 + 25 + 8 kitty). Landlord nomination: first to claim wins; if all decline, the table
is redealt. Scoring: 3P landlord ±2 / farmers ∓1; 4P landlord ±3 / farmers ∓1. Scores persist in
the room across hands.

**Transport.** WebSocket (JSON messages). Schema version: `1`. Persistence: in-memory.

---

## Run locally

### 1. Start the server

```bash
cd backend
npm install
npm start
```

Default bind: `0.0.0.0:8787`. Override with env vars:

```bash
PORT=9000 HOST=127.0.0.1 npm start
```

Health check: `http://localhost:8787/health` → `{ "ok": true, "schemaVersion": 1 }`.

### 2. Serve the frontend

The frontend is static files only, no build step:

```bash
cd frontend
# any of these — pick one
python3 -m http.server 5173
npx --yes serve -l 5173 .
npx --yes http-server -p 5173 .
```

Then open `http://localhost:5173` in your browser.

> Opening `index.html` via `file://` **will not work** — service workers and ES modules require an
> HTTP origin.

### 3. Play

1. On the landing page, enter a name, confirm the WS URL (default
   `wss://dou-di-zhu-backend.onrender.com`; paste `ws://localhost:8787` instead for local dev), and click
   **Create table**. You land directly in the room at seat 0.
2. Copy the link from the **share bar** at the top of the table page and send it to 2 – 3 more
   players. Each guest enters their name in the prompt, then takes a seat.
3. When 3 or 4 seats are all **Ready**, the hand is dealt and bidding begins. First player to click
   **Be Landlord** takes the kitty. If everyone declines, the table is redealt.
4. Select one or more cards and click **Play** (enabled only when the selection is a valid
   combination that beats the table). Click **Pass** when you can't or won't play.
5. When a player empties their hand, scores are awarded. Click **Ready** again to deal the next
   hand — scores accumulate across the match.

### 4. Run the test suite

```bash
cd backend
npm test
```

53 tests covering combination detection/comparison, engine state transitions, scoring,
Table lifecycle, per-seat projection (no-leak invariant), and full WebSocket integration.

---

## Deploy for free

**Backend → Render** (free Node hosting with WebSocket support).
**Frontend → Cloudflare Pages** (free static hosting).

Total setup: ~15 minutes, no credit card, no local sysadmin work. Both services are free forever
at the tier this project needs. The only tradeoff is that Render's free instance sleeps after ~15
minutes of inactivity, so the first connection after a quiet period takes 30 – 50 seconds to wake
up.

### Prerequisites

Push this repo to GitHub (or GitLab / Bitbucket). Render and Cloudflare Pages both deploy directly
from a git repo.

### Step 1 — deploy the backend to Render

1. Go to <https://render.com> and sign up with your GitHub account.
2. **New → Web Service**. Connect the repo containing this project.
3. Fill in the settings:
   - **Name:** anything, e.g. `dou-di-ju-server`
   - **Branch:** `main` (or whichever branch holds the code)
   - **Root Directory:** `backend`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
4. Click **Create Web Service**. Render builds and deploys automatically.
5. When it's done, your backend URL is `https://<name>.onrender.com` and the WebSocket endpoint is
   `wss://<name>.onrender.com`. Copy that — you'll need it in Step 3.
6. Verify: `curl https://<name>.onrender.com/health` should return
   `{"ok":true,"schemaVersion":1}`.

> Render auto-provides a `PORT` environment variable and `src/server.js` already reads it, so no
> extra config is needed.

### Step 2 — deploy the frontend to Cloudflare Pages

1. Go to <https://pages.cloudflare.com> and sign up.
2. **Create application → Pages → Connect to Git**. Pick the same repo.
3. Fill in the settings:
   - **Project name:** anything, e.g. `dou-di-ju`
   - **Production branch:** `main`
   - **Framework preset:** `None`
   - **Build command:** *(leave empty)*
   - **Build output directory:** `frontend`
4. Click **Save and Deploy**. First build takes a minute.
5. Your frontend URL is `https://<project>.pages.dev`.

### Step 3 — point the frontend at the backend

Open `https://<project>.pages.dev`. In the landing page:

1. In the **Server** field, paste `wss://<name>.onrender.com` (the URL from Step 1).
2. Enter your name and click **Create table**.
3. Copy the share link from the table page's top bar and send it to 2 – 3 friends.

The WS URL is saved in `localStorage` and embedded in share links as a `wsUrl=` query parameter,
so guests don't have to re-paste it.

That's it — `$0/month`, forever (as long as Render and Cloudflare honor their free tiers).

### Cold-start workaround (optional)

Render's free tier sleeps after 15 min of inactivity. If you want to avoid the cold start before
a scheduled game, either:

- **Just warm it up manually:** open the frontend, let it connect. The site wakes the server in
  30 – 50 s. One-time cost per play session.
- **Ping `/health` on a schedule:** set up a free cron (e.g. <https://cron-job.org>) to hit
  `https://<name>.onrender.com/health` every 10 minutes. Keep in mind Render's free tier allows
  750 instance-hours per month — pinging 24/7 would exceed that. A cron that runs only during
  the hours you actually play (say 6 pm – midnight on weekends) is safe.

---

## State persistence

Tables and sessions live in-memory only. A server restart wipes every in-flight hand. For
production you'd add one of:

- Redis-backed `TableRegistry` and `SessionStore` so a restart can resume.
- A DB (Postgres) for match history or persistent accounts.

Neither is required for casual multiplayer; the current design intentionally keeps MVP scope
small.

---

## Troubleshooting

- **"Reconnecting…"** — the client reconnects automatically with exponential backoff (1 s → 10 s
  cap). Session tokens in `localStorage` let you resume the seat within a 60 s grace window on the
  server.
- **"Seat unavailable" / "invalid_session"** — the `tableId` expired (server restart) or your
  session was dropped. Use the landing page to create or join again.
- **Guest sees the name prompt every time** — the name is stored per browser in `localStorage`
  under `doudizhu:name`. If you're in private browsing, the store doesn't persist between sessions.
- **Browser console: `WebSocket connection to 'ws://…' failed`** — the server isn't reachable.
  Verify with `curl http://<host>:8787/health`.
- **Mixed-content error** — the frontend is loaded over HTTPS but the WS URL is `ws://`. Switch
  to `wss://` (needs TLS in front of the server) or serve the frontend over plain HTTP for local
  development.
- **Render free tier cold start** — first connection after 15 min of inactivity takes ~30 – 50 s.
  This is fundamental to the free tier, not a bug. Use the cold-start workaround above, or pay
  Render $7/month for an always-on instance.
