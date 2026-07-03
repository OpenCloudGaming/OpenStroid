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

OpenStroid is a desktop app for Boosteroid with QR login, your game library, and WebRTC streaming.

## Downloads

Download the latest desktop build from [GitHub Releases](https://github.com/OpenCloudGaming/OpenStroid/releases). Android builds are shared in [Discord](https://discord.gg/8EJYaJcNfD).

## Development

```bash
bun install
cp .env.example .env
bun run dev
```

### QR login

1. Open OpenStroid and go to the login screen.
2. Scan the QR code or click **Login to Boosteroid** to finish in your browser.
3. After Boosteroid verifies the QR code, the app opens your game library.

### Scripts

| Command | Description |
|---|---|
| `bun run dev` | Launch the desktop app |
| `bun run build` | Build the app |
| `bun run start` | Run the built app |
| `bun run lint` | Run ESLint |

## Repository layout

```text
.
├── electron/     Electron main process
├── server/       Auth, library proxy, stream launch
├── src/          Desktop UI and streaming client
├── public/       Static assets
└── tools/        Dev scripts
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
