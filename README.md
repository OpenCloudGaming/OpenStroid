# OpenStroid Desktop

Electron-first cloud gaming client. OpenStroid Desktop runs a local bridge on localhost, coordinates Boosteroid auth capture, and displays the user-facing desktop UI. A companion Chrome extension installed in the user's normal Chrome profile captures Boosteroid auth/session state from the real browser session and sends it to the desktop bridge.

## Desktop-first architecture

OpenStroid is now an Electron-first desktop client.

- The Electron app is the primary product shell.
- Electron starts and owns the local HTTP bridge on `http://127.0.0.1:3001`.
- The React UI is rendered inside the Electron window.
- The Chrome extension in `extension/openstroid-capture/` runs in the user's real Chrome profile and talks to the Electron bridge over localhost.
- The desktop bridge validates captured upstream state, persists raw artifacts to `.runtime/auth-captures/`, creates the encrypted OpenStroid session, and continues to proxy normalized `/auth`, `/me`, and `/library` routes.

## Local development

```bash
bun install
cp .env.example .env
bun run dev
```

What runs in development:
- Vite renderer: `http://127.0.0.1:3000`
- Electron desktop shell: launched automatically by `npm run dev`
- Electron-managed local bridge: `http://127.0.0.1:3001`

Use `npm run dev:bridge` only if you need the local bridge without launching Electron.

## Chrome extension setup

1. Open `chrome://extensions` in your normal Chrome profile.
2. Enable Developer Mode.
3. Click **Load unpacked**.
4. Select `extension/openstroid-capture/` from this repo.
5. Open the extension popup.
6. Set the backend URL to `http://127.0.0.1:3001`.
7. When OpenStroid Desktop shows a pairing code, paste it into the extension popup.
8. Start desktop extension capture from the Electron app.
9. Log in on `https://boosteroid.com` in the same Chrome profile.

## Desktop capture flow

1. OpenStroid Desktop starts an extension capture session.
2. The desktop UI shows a user-issued pairing code.
3. The user pastes that code into the Chrome extension popup.
4. The extension requests the active ingest session from the Electron bridge using that pairing code.
5. The user logs in to Boosteroid in real Chrome.
6. The extension captures relevant cookies, response metadata, and observed JSON auth/session payloads.
7. The extension submits the capture artifact to `POST /auth/extension/capture` on the Electron bridge.
8. The bridge validates upstream state with `GET /api/v1/user`, persists the raw artifact, and establishes the encrypted OpenStroid session.
9. The desktop UI polls `/auth/login/status` and transitions into the game library after success.

## Local bridge API surface

| Method | Route | Description |
|---|---|---|
| `POST` | `/auth/login/start` | Start an extension capture session from the desktop UI |
| `GET` | `/auth/login/status` | Read latest capture status and establish the local OpenStroid session on success |
| `GET` | `/auth/login/status/:id` | Read status for a specific capture session |
| `POST` | `/auth/login/cancel` | Cancel the active capture |
| `POST` | `/auth/extension/active` | Extension-only route to fetch the active pending capture after presenting the user pairing code |
| `POST` | `/auth/extension/capture` | Extension-only route to submit captured upstream cookies/payloads |
| `GET` | `/auth/debug/capture` | Return the latest raw upstream capture artifact for inspection |
| `POST` | `/auth/logout` | Clear the OpenStroid session and attempt upstream logout |
| `GET` | `/auth/session` | Validate/refresh current session and return `{ authenticated, user }` |
| `GET` | `/me` | Return `{ user }` for authenticated clients |
| `GET` | `/library/installed` | Return `{ games }` from the upstream installed library API |
| `GET` | `/health` | Local desktop bridge health check |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | *(empty)* | Renderer API origin. Leave empty in local Electron dev so Vite proxies first-party routes. Never point this at a Boosteroid origin. |
| `SERVER_PORT` | `3001` | Local Electron bridge port. |
| `UPSTREAM_BASE_URL` | `https://cloud.boosteroid.com` | Upstream Boosteroid base URL. |
| `SESSION_SECRET` | `openstroid-development-session-secret` | Secret used to encrypt/authenticate the OpenStroid session cookie. Replace in production. |
| `SESSION_COOKIE_NAME` | `openstroid_session` | First-party auth cookie name. |
| `SESSION_TTL_SECONDS` | `2592000` | Cookie/session lifetime in seconds. |
| `COOKIE_SECURE` | `false` in dev, `true` in production | Whether to mark the auth cookie as `Secure`. |
| `APP_ORIGIN` | *(unset)* | Optional allowed renderer/browser origin if frontend and bridge are split. |
| `AUTH_CAPTURE_ARTIFACT_DIR` | `<project>/.runtime/auth-captures` | Directory where raw capture JSON artifacts are written. |
| `AUTH_CAPTURE_TIMEOUT_MS` | `300000` | Maximum time allowed for the extension login session before timing out. |
| `BACKEND_PROXY_TARGET` | `http://127.0.0.1:3001` | Vite-only proxy target for local renderer development. |
| `ELECTRON_RENDERER_URL` | `http://127.0.0.1:3000` | Dev-only renderer URL opened by Electron. |

## Turnstile and capture notes

- The extension-first path is the primary auth mechanism because it operates inside the user's real Chrome profile.
- The extension can read relevant Boosteroid cookies via Chrome cookie APIs, including HttpOnly cookies when host permissions are granted.
- Response metadata is captured via `webRequest`, while JSON auth/session payloads are captured from page `fetch`/XHR instrumentation on Boosteroid pages.
- The extension never automates the Turnstile widget or login form. It passively observes the real session after the user acts normally.
- The pairing code remains required before the extension can discover an active ingest token from the local bridge.

## Project structure

```text
electron/
└── main.ts                     # Electron main process, window creation, bridge startup
server/
├── app.ts                      # Reusable local bridge app and startup helpers
├── config.ts                   # Runtime config for the bridge
├── index.ts                    # Standalone bridge entrypoint for non-Electron use
└── lib/
    ├── crypto.ts              # Encrypted cookie helpers
    ├── session.ts             # Session cookie read/write helpers
    ├── upstream.ts            # Boosteroid upstream client + refresh handling
    └── authCapture.ts         # Extension-first capture/session orchestration
src/
├── api/                       # First-party API client and endpoint wrappers
├── auth/                      # AuthContext + legacy storage cleanup
├── components/                # Shared UI components
├── layouts/                   # Desktop page layout shells
├── pages/                     # Desktop route-level page components
├── theme/                     # Mantine theme customization
└── types/                     # Shared TypeScript interfaces
extension/
└── openstroid-capture/        # Unpacked Chrome extension for real-browser Boosteroid capture
```

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start Vite and launch the Electron desktop shell |
| `bun run dev:web` | Start the Vite renderer only |
| `bun run dev:electron` | Launch Electron against the dev renderer |
| `bun run dev:bridge` | Run the local bridge without Electron |
| `bun run build` | Type-check and build renderer, bridge, and Electron main process |
| `bun run start` | Run the built Electron desktop app |
| `bun run start:bridge` | Run only the built local bridge |
| `bun run preview` | Preview the frontend build |
| `bun run lint` | Run ESLint |

## License

Apache-2.0 — see [LICENSE](LICENSE).
