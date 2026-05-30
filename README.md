# Judged by AI

Bad plans die fast. Good plans get judged anyway.

This version is a static React app. InstantDB handles realtime room state, and the
session leader's browser runs the AI judge with their own token or local
OpenAI-compatible endpoint.

## Architecture

```text
React + Vite static app
InstantDB realtime state
Host browser runs AI judging
Guests join anonymously by room code
AI token and endpoint stay in host local storage
```

There is intentionally no game backend, no server-owned AI key, and no quota
system. This keeps permanent hosting cheap and fits the casual party-game trust
model.

## Trust Model

The host is the authority.

- The host creates the room.
- Guests join by code without login.
- The host opens submissions, runs judging, advances reveal, and starts rounds.
- The host's browser can see submissions and writes judgments/scores.
- InstantDB permissions allow public room play, but admin cleanup fields are
  restricted to linked admin identities.
- This is not designed for competitive anti-cheat or hidden-information security.

## Setup

Install dependencies:

```bash
bun install
```

Create an Instant app:

```bash
npx instant-cli init-without-files --title judged-by-ai
```

Put the app id in `.env`:

```bash
VITE_INSTANT_APP_ID=your-instant-app-id
```

Push schema and permissions:

```bash
npx instant-cli push schema --yes
npx instant-cli push perms --yes
```

Run locally:

```bash
bun run dev
```

Open `http://localhost:5173`.

## Demo Modes

Demo modes are isolated behind a URL flag so they do not interfere with normal
testing. Open:

```text
http://localhost:5173/?demo=1
```

This shows four client-only demo modes for status updates:

- Lobby: room code, host ownership, anonymous guests.
- Submissions: scenario, countdown, and hidden player responses.
- Reveal: one-by-one AI verdict flow.
- Scoreboard: leaderboard and judged answers.

Demo modes do not write to InstantDB and do not call any AI endpoint. Without
`?demo=1`, the app only shows the normal create/join flow.

## Admin Panel

Open:

```text
http://localhost:5173/?admin=1
```

Admin access uses normal Instant auth plus the `admins` namespace linked to
`$users`. An admin identity must point at a user that has signed in at least
once. The first admin must be bootstrapped from the Instant dashboard/Explorer
or another trusted admin-token workflow by creating an `admins` row and linking
it to the matching `$users` row.

Admins can:

- View all games.
- Archive and restore games.
- Mark stale games as finished or archived.
- Archive old games that are not linked to a host user account.
- Manage the admin identity list.

## AI Settings

The host configures AI in the room sidebar. Settings are saved only in the host
browser's local storage.

Supported targets are any OpenAI-compatible `/v1/chat/completions` endpoint:

```text
OpenAI       https://api.openai.com/v1
OpenRouter  https://openrouter.ai/api/v1
LM Studio   http://localhost:1234/v1
llama-server http://localhost:8080/v1
Ollama      http://localhost:11434/v1
```

If a local endpoint has CORS restrictions, run a small local CORS proxy or host
the app from the same machine/origin. Electron packaging is another possible
future path, but the web app is the default.

## Deployment

Build static files:

```bash
bun run build
```

Deploy `dist/client` to any static host. Configure `VITE_INSTANT_APP_ID` at build
time.

The app includes a web manifest, service worker, favicon, and install icons for
PWA usage. Regenerate PNG icons after changing `public/logo.svg`:

```bash
bun run icons
```

## Files

- `instant.schema.ts` defines InstantDB entities and indexed query fields.
- `instant.perms.ts` enforces admin-only cleanup fields while keeping public
  room play possible.
- `client/src/main.tsx` contains the realtime game UI and host controls.
- `client/src/ai.ts` contains host-side OpenAI-compatible judging.
