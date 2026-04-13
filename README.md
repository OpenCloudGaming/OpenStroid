# OpenStroid

Open-source cloud gaming client. Built with React, TypeScript, Mantine, and Vite.

## Quick start

```bash
npm install
npm run dev
```

The dev server starts on [http://localhost:3000](http://localhost:3000).

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `https://cloud.boosteroid.com` | Backend API origin |

## Project structure

```
src/
├── api/          # API client, config, endpoint wrappers
├── auth/         # Token storage, login adapter, AuthContext
├── components/   # Shared UI components
├── hooks/        # Custom React hooks
├── layouts/      # Page layout shells
├── pages/        # Route-level page components
├── theme/        # Mantine theme customization
└── types/        # Shared TypeScript interfaces
```

## Current features (v0.1)

- **Login** — email/password authentication with validation, loading states, and server error handling
- **Session restore** — persisted tokens are validated on startup so users stay signed in
- **My Games library** — fetches installed games from the API with skeleton loading, empty state, and error recovery
- **Logout** — clears session and returns to login
- **Token refresh** — automatic silent refresh on 401 responses with request queuing

## Architecture notes

- Auth tokens are stored in `localStorage` (`access_token`, `refresh_token`, `boosteroid_auth`).
- The `Authorization` header sends the raw access token (no `Bearer` prefix), matching the observed protocol.
- Login payload construction is isolated in `src/auth/login-adapter.ts` — if field names need to change, only that file is touched.
- The API client in `src/api/client.ts` handles automatic token refresh with a queue for concurrent 401s.
- Route protection is handled by `RequireAuth`, which shows a loading spinner during session bootstrap and redirects unauthenticated users.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |

## License

Apache-2.0 — see [LICENSE](LICENSE).
