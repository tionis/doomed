# Promptly Doomed

Bad plans die fast. Good plans get judged anyway.

React + Vite client backed by a Bun + Hono game server. The server owns room
state as Automerge documents, runs the AI judge with a server-side key, and
handles host auth via OIDC (plus SCIM provisioning).

## Architecture

```text
React + Vite client (polls + WebSocket snapshots from /sync/:code)
Bun + Hono backend (Automerge room docs, authoritative game flow)
Server-side AI judging (OpenAI-compatible /v1/chat/completions)
OIDC host login, anonymous guests join by room code
SCIM 2.0 provisioning for org user management
```

## Trust Model

The backend is the authority.

- The host creates the room (OIDC login when `OIDC_ISSUER` is set).
- Guests join by code without login.
- Round control rotates between players; any joined member can advance the
  flow, the server validates membership.
- Judging runs on the server with `LLM_API_KEY`. Browser clients never see it.
- Admin endpoints require OIDC auth plus membership in `ADMIN_EMAILS` or the
  admin list (SCIM-provisioned users can be promoted there).

## Setup

Install dependencies:

```bash
bun install
```

Configure the backend (see `server/.env.example`):

```bash
PORT=3001
OIDC_ISSUER=https://your-idp.example.com
OIDC_CLIENT_ID=doomed-client-id
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=...
LLM_MODEL=gpt-4.1-mini
SCIM_TOKEN=...
ADMIN_EMAILS=admin@example.com
```

For local dev without an IdP, omit `OIDC_ISSUER` (rooms allow anonymous
hosts) and use `OIDC_DEV_BYPASS=1` with `Bearer dev-host-token` for
host/admin endpoints. Leave `LLM_BASE_URL` empty for the mock judge.

Point the client at the backend in `.env`:

```bash
VITE_BACKEND_URL=http://localhost:3001
VITE_OIDC_ISSUER=https://your-idp.example.com
VITE_OIDC_CLIENT_ID=doomed-client-id
```

Run both:

```bash
bun run backend:dev
bun run dev
```

Open `http://localhost:3000`.

## Demo Modes

Demo modes are isolated behind a URL flag so they do not interfere with normal
testing. Open:

```text
http://localhost:3000/?demo=1
```

This shows four client-only demo modes for status updates:

- Lobby: room code, host ownership, anonymous guests.
- Submissions: scenario, countdown, and hidden player responses.
- Reveal: one-by-one AI verdict flow.
- Scoreboard: leaderboard and judged answers.

Demo modes do not talk to the backend and do not call any AI endpoint. Without
`?demo=1`, the app only shows the normal create/join flow.

## Admin Panel

Open:

```text
http://localhost:3000/?admin=1
```

Admin access requires OIDC login plus an admin grant (`ADMIN_EMAILS`,
the admin list, or SCIM-provisioned promotion).

Admins can:

- View all games.
- Archive and restore games.
- Mark stale games as finished or archived.
- Run bulk cleanups (stale, old finished, unlinked).
- Manage the admin identity list.

## AI Judging

Judging runs on the backend. Configure `LLM_BASE_URL`, `LLM_API_KEY`, and
`LLM_MODEL` on the server (any OpenAI-compatible `/v1/chat/completions`
endpoint: OpenAI, OpenRouter, LM Studio, llama-server, Ollama). Without a
configured endpoint the server uses the mock judge, useful for demos and
testing the game flow.

## Deployment

Single-container Docker image (client bundle served same-origin by the
backend, so no `VITE_BACKEND_URL` needed):

```bash
docker build -t doomed .
docker run -p 3001:3001 --env-file .env -v doomed-data:/app/data doomed
```

Or with compose:

```bash
docker compose up --build
```

For split hosting, build static client files with `VITE_BACKEND_URL` set at
build time and deploy `dist/client` anywhere:

```bash
bun run build
```

### GitHub Pages

The CI workflow deploys `main` to GitHub Pages with the official Pages artifact
flow. In the repository settings, set Pages source to **GitHub Actions** and add
this secret:

```text
VITE_BACKEND_URL=https://your-backend.example.com
```

For normal project pages, the workflow builds with `/<repo-name>/` as the Vite
base path. If you use a custom domain or a `*.github.io` root repository, set a
repository variable named `VITE_BASE_PATH` to `/`.

The app includes a web manifest, service worker, favicon, and install icons for
PWA usage. Regenerate PNG icons after changing `public/logo.svg`:

```bash
bun run icons
```

## Files

- `server/src/index.ts` Bun entrypoint (REST + WebSocket sync).
- `server/src/app.ts` Hono routes (`/api/rooms`, `/api/host`, `/api/admin`,
  `/api/auth/oidc`, `/scim/v2`, `/sync/:code`), CORS, rate limits, static
  client serving.
- `server/src/store.ts` Automerge room docs with JSON snapshot persistence.
- `server/src/llm.ts` server-side AI judging with mock fallback.
- `server/src/auth.ts` + `server/src/oidc.ts` OIDC host token verification
  and PKCE callback.
- `server/src/scim.ts` + `server/src/scimStore.ts` SCIM 2.0 provisioning
  with admin entitlement wiring.
- `client/src/main.tsx` realtime game UI and host controls.
- `client/src/serverSync.ts` backend REST + Automerge delta-sync hooks.
- `client/src/serverAuth.ts` OIDC login and host token storage.
