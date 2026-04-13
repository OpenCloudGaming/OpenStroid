# OpenStroid

Open-source cloud gaming client. Built with React, TypeScript, Mantine, Vite, and an Express auth bridge.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

- Frontend dev server: [http://localhost:3000](http://localhost:3000)
- Backend auth bridge: [http://localhost:3001](http://localhost:3001)

`npm run dev` starts both processes. The browser talks only to first-party `/auth`, `/me`, and `/library` routes. The backend bridge owns the upstream Boosteroid session and proxies authenticated requests to `https://cloud.boosteroid.com`.

## Auth bridge architecture

OpenStroid is no longer a browser-direct Boosteroid client.

- The frontend sends login, session bootstrap, logout, and library requests to first-party endpoints on the OpenStroid origin.
- The backend bridge talks to `https://cloud.boosteroid.com` for:
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh-token`
  - `POST /api/v2/auth/logout`
  - `GET /api/v1/user`
  - `GET /api/v1/boostore/applications/installed`
- Upstream access and refresh tokens are stored only inside encrypted, HttpOnly first-party cookies.
- The browser no longer stores raw upstream tokens in `localStorage`.
- Session bootstrap uses `GET /auth/session` instead of reading browser storage.
- Upstream 401s are refreshed server-side with a shared refresh lock to avoid duplicate refresh races.

## API surface

The backend exposes normalized first-party endpoints:

| Method | Route | Description |
|---|---|---|
| `POST` | `/auth/login` | Login with email/password/Turnstile, create first-party session cookie, return `{ authenticated, user }` |
| `POST` | `/auth/logout` | Clear first-party session and attempt upstream logout |
| `GET` | `/auth/session` | Validate/refresh current session and return `{ authenticated, user }` |
| `GET` | `/me` | Return `{ user }` for authenticated clients |
| `GET` | `/library/installed` | Return `{ games }` from the upstream installed library API |
| `GET` | `/health` | Lightweight backend health check |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | *(empty)* | Frontend API origin. Leave empty for same-origin deployments. |
| `VITE_TURNSTILE_SITE_KEY` | `0x4AAAAAAB83Vz-GpH08brQi` | Cloudflare Turnstile site key. Use `1x00000000000000000000AA` for local dev. |
| `SERVER_PORT` | `3001` | Backend bridge port. |
| `UPSTREAM_BASE_URL` | `https://cloud.boosteroid.com` | Upstream Boosteroid base URL. |
| `SESSION_SECRET` | `openstroid-development-session-secret` | Secret used to encrypt/authenticate the session cookie. Replace in production. |
| `SESSION_COOKIE_NAME` | `openstroid_session` | First-party auth cookie name. |
| `SESSION_TTL_SECONDS` | `2592000` | Cookie/session lifetime in seconds. |
| `COOKIE_SECURE` | `false` in dev, `true` in production | Whether to mark the auth cookie as `Secure`. |
| `APP_ORIGIN` | *(unset)* | Optional allowed browser origin when frontend and backend run on different origins. |
| `BACKEND_PROXY_TARGET` | `http://localhost:3001` | Vite-only proxy target for local frontend development. |

## Production notes

- Build with `npm run build`.
- Start the bridge with `npm run start`.
- Serve the frontend and backend from the same origin when possible.
- Set a strong `SESSION_SECRET` and keep `COOKIE_SECURE=true` in production.
- If you deploy the frontend separately, set `VITE_API_BASE_URL` to the backend origin and `APP_ORIGIN` to the frontend origin.

## Project structure

```text
server/
├── config.ts        # Runtime config for the auth bridge
├── index.ts         # Express server + first-party endpoints
└── lib/
    ├── crypto.ts    # Encrypted cookie helpers
    ├── session.ts   # Session cookie read/write helpers
    └── upstream.ts  # Boosteroid upstream client + refresh handling
src/
├── api/             # First-party API client and endpoint wrappers
├── auth/            # AuthContext + legacy storage cleanup
├── components/      # Shared UI components
├── layouts/         # Page layout shells
├── pages/           # Route-level page components
├── theme/           # Mantine theme customization
└── types/           # Shared TypeScript interfaces
```

## Current features (auth bridge refactor)

- **Secure login flow** — email/password authentication with Cloudflare Turnstile routed through the backend bridge
- **Server-managed session** — session bootstrap checks `/auth/session` and keeps upstream tokens out of browser JavaScript
- **My Games library** — installed games loaded through first-party backend routes with existing loading, empty, and error states
- **Logout** — clears the OpenStroid session and attempts upstream logout
- **Server-side refresh** — upstream token refresh happens on the backend with refresh de-duplication for concurrent requests
- **Local dev proxy** — Vite proxies first-party backend routes to the local bridge instead of proxying directly to Boosteroid

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start backend bridge and frontend dev server together |
| `npm run dev:server` | Start backend bridge in watch mode |
| `npm run dev:web` | Start Vite frontend dev server |
| `npm run build` | Type-check and build backend + frontend for production |
| `npm run start` | Run the built backend bridge |
| `npm run preview` | Preview the frontend build |
| `npm run lint` | Run ESLint |

## License

Apache-2.0 — see [LICENSE](LICENSE).
