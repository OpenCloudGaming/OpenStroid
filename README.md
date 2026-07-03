<h1 align="center">OpenStroid</h1>

<p align="center">
  <img src="logo.svg" alt="OpenStroid logo" width="180" />
</p>

<p align="center">
  <strong>An open-source desktop client for Boosteroid.</strong>
</p>

<p align="center">
  Browse your library, tune your stream, and launch sessions from a community-built app.
</p>

<p align="center">
  <a href="https://github.com/OpenCloudGaming/OpenStroid/releases">
    <img src="https://img.shields.io/github/v/tag/OpenCloudGaming/OpenStroid?style=for-the-badge&label=Download&color=brightgreen" alt="Download">
  </a>
  <a href="#development">
    <img src="https://img.shields.io/badge/Docs-Development-blue?style=for-the-badge" alt="Development">
  </a>
  <a href="https://github.com/OpenCloudGaming/OpenStroid/issues">
    <img src="https://img.shields.io/github/issues/OpenCloudGaming/OpenStroid?style=for-the-badge&label=Issues" alt="Issues">
  </a>
  <a href="https://discord.gg/8EJYaJcNfD">
    <img src="https://img.shields.io/badge/Discord-Join%20Us-7289da?style=for-the-badge&logo=discord&logoColor=white" alt="Discord">
  </a>
</p>

<p align="center">
  <a href="https://github.com/OpenCloudGaming/OpenStroid/stargazers">
    <img src="https://img.shields.io/github/stars/OpenCloudGaming/OpenStroid?style=flat-square" alt="Stars">
  </a>
  <a href="https://github.com/OpenCloudGaming/OpenStroid/releases">
    <img src="https://img.shields.io/github/downloads/OpenCloudGaming/OpenStroid/total?style=flat-square" alt="Downloads">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/OpenCloudGaming/OpenStroid?style=flat-square" alt="License">
  </a>
</p>

> [!WARNING]
> OpenStroid is under active development. Expect occasional bugs, rough edges, and platform-specific issues while the client matures.
>
> QR login, WebRTC streaming, and gamepad input are still evolving. Report problems on [GitHub Issues](https://github.com/OpenCloudGaming/OpenStroid/issues) or [Discord](https://discord.gg/8EJYaJcNfD).

> [!IMPORTANT]
> OpenStroid is an independent community project and is not affiliated with, endorsed by, or sponsored by Boosteroid. Boosteroid is a trademark of its respective owner. You must use your own Boosteroid account.

## Overview

OpenStroid is a community-built Electron app for playing Boosteroid from an open-source desktop client. The Electron shell owns a local server on `http://127.0.0.1:3001`, handles Boosteroid QR login, proxies normalized auth and library routes, and renders the React desktop UI with integrated WebRTC streaming.

## Downloads

Grab the latest desktop build from [GitHub Releases](https://github.com/OpenCloudGaming/OpenStroid/releases) when available. Until packaged releases ship, build and run the client locally — see [Development](#development) below.

## Development

### Getting started

```bash
bun install
cp .env.example .env
bun run dev
```

What runs in development:

- Electron desktop shell with embedded Vite dev middleware
- Local server: `http://127.0.0.1:3001`

Use `bun run dev:bridge` only if you need the local server without launching Electron.

### QR login flow

1. Open OpenStroid Desktop and go to the login screen.
2. Scan the QR code with your phone or the Boosteroid app, or click **Login to Boosteroid** to finish in your browser.
3. After Boosteroid verifies the QR code, OpenStroid establishes a local session.
4. The app transitions into the game library.

### Scripts

| Command | Description |
|---|---|
| `bun run dev` | Start the Electron desktop shell with live dev server |
| `bun run dev:web` | Start the Vite renderer only |
| `bun run dev:bridge` | Run the local server without Electron |
| `bun run build` | Type-check and build renderer, server, and Electron main process |
| `bun run start` | Run the built Electron desktop app |
| `bun run start:bridge` | Run only the built local server |
| `bun run preview` | Preview the frontend build |
| `bun run lint` | Run ESLint |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | *(empty)* | Renderer API origin. Leave empty in local Electron dev so the renderer keeps using first-party routes. Never point this at a Boosteroid origin. |
| `SERVER_PORT` | `3001` | Local Electron server port. |
| `UPSTREAM_BASE_URL` | `https://cloud.boosteroid.com` | Upstream Boosteroid base URL. |
| `SESSION_SECRET` | `openstroid-development-session-secret` | Secret used to encrypt/authenticate the OpenStroid session cookie. Replace in production. |
| `SESSION_COOKIE_NAME` | `openstroid_session` | First-party auth cookie name. |
| `SESSION_TTL_SECONDS` | `2592000` | Cookie/session lifetime in seconds. |
| `COOKIE_SECURE` | `false` in dev, `true` in production | Whether to mark the auth cookie as `Secure`. |
| `APP_ORIGIN` | *(unset)* | Optional allowed renderer/browser origin if frontend and server are split. |

## Repository Layout

```text
.
├── electron/                  Electron main process, window creation, server startup
├── server/                    Local HTTP server, session handling, upstream client
├── src/                       React desktop UI, auth, streaming, and API client
├── public/                    Static assets and favicon
├── tools/                     Dev/build helper scripts
├── LICENSE                    Project license
└── logo.svg                   Project logo
```

## Contributing

Contributions are welcome. Open a focused pull request, explain user-facing impact clearly, and keep changes scoped to the problem you are solving.

## Star History

<a href="https://www.star-history.com/?repos=OpenCloudGaming%2FOpenStroid&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=OpenCloudGaming/OpenStroid&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=OpenCloudGaming/OpenStroid&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=OpenCloudGaming/OpenStroid&type=date&legend=top-left" />
 </picture>
</a>

## License

OpenStroid is licensed under the [Apache License 2.0](LICENSE).
