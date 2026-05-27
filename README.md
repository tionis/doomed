# Judged by AI

An original realtime AI survival party game built with an authoritative TypeScript backend.

The client sends commands. The server validates membership, deadlines, transitions, AI judging, scoring, persistence, and realtime broadcasts.

## Stack

- React + Vite frontend
- Fastify TypeScript backend running on Bun
- SQLite persistence through Bun's built-in `bun:sqlite`
- HTTP-only session cookies
- authentik OIDC login with a local development fallback
- WebSocket game snapshots
- OpenAI judge when `OPENAI_API_KEY` is set, deterministic mock judge otherwise

## Local Setup

```bash
cp .env.example .env
bun install
bun run migrate
bun run dev
```

Open `http://localhost:5173`.

Without OIDC variables, `/auth/login/authentik` creates a local development session. Configure the authentik settings below for real provider login.

## Container

Build and run the single-image app with Podman:

```bash
podman build --file Containerfile --tag judged-by-ai:local .
podman run --rm -p 3000:3000 -v judged-by-ai-data:/data judged-by-ai:local
```

Open `http://localhost:3000`.

## Game Flow

1. Login.
2. Create a game and share the join code.
3. Players join and ready up in the lobby.
4. Host starts the game.
5. Host opens submissions.
6. Players submit before the deadline.
7. Host or the recovery loop closes submissions.
8. Backend locks submissions, creates panic defaults for missing players, judges, scores, and broadcasts reveal state.
9. Host advances reveal, then starts the next round or finishes the game.

## Environment

See `.env.example` for all options.

The SQLite database defaults to `.data/judged-by-ai.sqlite`. Override it with `SQLITE_PATH`.

`OPENAI_API_KEY` is optional for local development. When omitted, the mock judge still exercises validation, scoring, reveal, and leaderboard flow without external cost.

## authentik OIDC

Create an OAuth2/OpenID Provider and an Application in authentik for this app.

Recommended local development settings:

```text
Provider type: OAuth2/OpenID
Signing key: any active authentik signing key
Client type: Confidential
Redirect URI: http://localhost:5173/auth/callback/authentik
Scopes: openid, profile, email
Subject mode: Based on the User's hashed ID
```

Then set:

```bash
OIDC_PROVIDER=authentik
OIDC_ISSUER=https://authentik.example.com/application/o/judged-by-ai/
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=http://localhost:5173/auth/callback/authentik
```

For the Podman container on `localhost:3000`, use `http://localhost:3000/auth/callback/authentik` as the redirect URI and `APP_ORIGIN=http://localhost:3000`.
