# OpenStroid

Open-source cloud gaming client. Built with React, TypeScript, Mantine, Vite, Express, and a backend-owned browser capture bridge for Boosteroid authentication.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

- Frontend dev server: [http://localhost:3000](http://localhost:3000)
- Backend auth bridge: [http://localhost:3001](http://localhost:3001)

`npm run dev` starts both processes. The browser talks only to first-party `/auth`, `/me`, and `/library` routes. The backend bridge owns the upstream Boosteroid session, launches a real browser window for manual upstream login, and proxies authenticated requests to `https://cloud.boosteroid.com`.

## Auth bridge architecture

OpenStroid is no longer a browser-direct or credential-forwarding Boosteroid client.

- The frontend starts a backend login capture instead of posting credentials to OpenStroid.
- The backend launches a visible Playwright-controlled browser window to the real Boosteroid login experience and waits for the user to complete Turnstile manually.
- Once Boosteroid sets authenticated upstream state, the backend captures raw cookies and observed auth/session payloads, validates the upstream session, and converts it into the existing encrypted first-party OpenStroid cookie session.
- The frontend sends session bootstrap, logout, and library requests to first-party endpoints on the OpenStroid origin.
- The backend bridge talks to `https://cloud.boosteroid.com` for:
  - browser-observed `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh-token`
  - `POST /api/v2/auth/logout`
  - `GET /api/v1/user`
  - `GET /api/v1/boostore/applications/installed`
- Upstream access and refresh tokens are stored only inside encrypted, HttpOnly first-party cookies for normal app behavior.
- Raw upstream cookies, login/session payloads, and request metadata are also persisted under `.runtime/auth-captures/` and exposed through a dedicated authenticated debug endpoint.
- The browser no longer stores raw upstream tokens in `localStorage`.
- Session bootstrap uses `GET /auth/session` instead of reading browser storage.
- Upstream 401s are refreshed server-side with a shared refresh lock to avoid duplicate refresh races.

## API surface

The backend exposes normalized first-party endpoints:

| Method | Route | Description |
|---|---|---|
| `POST` | `/auth/login/start` | Start a browser-backed Boosteroid login capture and launch the upstream login window |
| `GET` | `/auth/login/status` | Read the latest capture status and establish the first-party OpenStroid session on success |
| `GET` | `/auth/login/status/:id` | Read status for a specific capture session |
| `POST` | `/auth/login/cancel` | Cancel the active capture and clean up browser resources |
| `GET` | `/auth/debug/capture` | Return the latest raw upstream capture artifact, including cookies and payloads |
| `POST` | `/auth/logout` | Clear first-party session and attempt upstream logout |
| `GET` | `/auth/session` | Validate/refresh current session and return `{ authenticated, user }` |
| `GET` | `/me` | Return `{ user }` for authenticated clients |
| `GET` | `/library/installed` | Return `{ games }` from the upstream installed library API |
| `GET` | `/health` | Lightweight backend health check |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | *(empty)* | Frontend API origin. Leave empty in local dev and same-origin deployments so the browser stays on first-party `/auth`, `/me`, and `/library` routes. Never set this to a Boosteroid origin. |
| `SERVER_PORT` | `3001` | Backend bridge port. |
| `UPSTREAM_BASE_URL` | `https://cloud.boosteroid.com` | Upstream Boosteroid base URL. |
| `SESSION_SECRET` | `openstroid-development-session-secret` | Secret used to encrypt/authenticate the session cookie. Replace in production. |
| `SESSION_COOKIE_NAME` | `openstroid_session` | First-party auth cookie name. |
| `SESSION_TTL_SECONDS` | `2592000` | Cookie/session lifetime in seconds. |
| `COOKIE_SECURE` | `false` in dev, `true` in production | Whether to mark the auth cookie as `Secure`. |
| `APP_ORIGIN` | *(unset)* | Optional allowed browser origin when frontend and backend run on different origins. |
| `AUTH_CAPTURE_ARTIFACT_DIR` | `<project>/.runtime/auth-captures` | Directory where raw capture JSON artifacts are written. |
| `BROWSER_USER_DATA_DIR` | `<project>/.runtime/browser-profile` | Persistent Chrome profile directory used for the backend-launched login browser. |
| `BROWSER_LOGIN_TIMEOUT_MS` | `300000` | Maximum time allowed for manual upstream login before timing out. |
| `BROWSER_LOGIN_POLL_INTERVAL_MS` | `1500` | Interval used while checking whether upstream auth cookies/tokens are ready. |
| `BROWSER_LAUNCH_NAVIGATE_TIMEOUT_MS` | `30000` | Initial page navigation timeout for the launched browser. |
| `BROWSER_HEADLESS` | `false` | Whether to launch the backend browser headlessly. Visible mode is strongly recommended for Turnstile. |
| `BROWSER_CHANNEL` | `chrome` when no explicit executable is found | Preferred browser channel passed to Playwright. Use a real Chrome install when possible. |
| `BROWSER_EXECUTABLE_PATH` | auto-detects system Chrome/Chromium | Optional explicit browser executable path. |
| `BROWSER_LOCALE` | `en-US` | Locale for the persistent browser profile. |
| `BROWSER_LAUNCH_ARGS` | *(unset)* | Comma-separated extra browser launch arguments. |
| `BACKEND_PROXY_TARGET` | `http://localhost:3001` | Vite-only proxy target for local frontend development. |

## Production notes

- Build with `npm run build`.
- Start the bridge with `npm run start`.
- Serve the frontend and backend from the same origin when possible.
- In local dev, keep `VITE_API_BASE_URL` empty so Vite proxies first-party routes to the backend bridge. The frontend must never call `https://cloud.boosteroid.com` directly.
- For the manual Boosteroid login flow, prefer visible system Chrome with the persistent backend profile directory. Turnstile is more likely to reject fresh ephemeral automation profiles or headless Chromium.
- Set a strong `SESSION_SECRET` and keep `COOKIE_SECURE=true` in production.
- If you deploy the frontend separately, set `VITE_API_BASE_URL` to the backend origin and `APP_ORIGIN` to the frontend origin.

## Turnstile / browser-launch notes

- The backend now launches a persistent browser profile instead of a throwaway ephemeral context.
- When available, OpenStroid prefers the installed system Chrome binary over bundled Playwright Chromium.
- The launch path removes Playwright's default `--enable-automation` flag, disables obvious automation blink features, keeps the browser visible by default, and preserves a realistic user profile between attempts.
- OpenStroid does not script the Boosteroid login form or Turnstile widget. The page is opened for manual interaction only; capture stays passive and relies on observed network/cookies after login completes.
- Even with these mitigations, anti-bot systems can still be environment-sensitive. Desktop sessions with a real display server and system Chrome are the recommended setup.

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

- **Manual upstream login capture** — the user completes the real Boosteroid + Turnstile login in a backend-launched browser window
- **Server-managed session** — session bootstrap checks `/auth/session` and keeps upstream tokens out of browser JavaScript
- **Debug evidence capture** — raw upstream cookies, payloads, and request metadata are inspectable from the UI and saved to `.runtime/auth-captures`
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
