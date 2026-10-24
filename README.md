# Hermes Companion

A native Android companion for [Hermes Agent](https://hermes-agent.nousresearch.com/).
Hermes runs on your computer; this app is a full phone interface for it — not a
read-only viewer. Chat, sessions, settings, cron jobs, and notifications, built
to match the Hermes desktop dashboard as closely as a phone sensibly can.

```text
Android phone → Tailscale or LAN → Hermes gateway on your machine
```

The repository contains the client only. It does not contain Hermes, a gateway,
API keys, access tokens, or a hosted proxy.

This project is intentionally transparent about its origin: it was initially
vibe-coded with help from Hermes Agent and is developed with AI coding agents
under the maintainer's direction. The maintainer is not a professional
programmer, so clear explanations and patient pull requests are welcome.

## Download

**[Hermes Companion v1.0 (APK)](https://github.com/rishabh-alt/hermes-mobile-companion/releases/tag/v1.0)**

- Debug-signed APK for sideloading — Android will ask you to allow installs
  from your browser once. This is not a Play Store build.
- Requires Android 7.0 (API 24) or newer.
- Works with Hermes Agent hosts **0.20.0 – 0.22.x**; the app checks your host's
  version and configuration schema and tells you plainly if an update or
  migration is needed.

## What it does

- **Chat** — streaming responses, model picker, camera and file attachments,
  message timestamps with day dividers, and a session drawer that shows which
  sessions are waiting on you or need an approval.
- **Settings parity** — the dashboard's configuration is editable from the
  phone: every config category is covered, with secret values kept hidden by
  design. Includes config backup and restore, and an app PIN lock.
- **Jobs** — view cron jobs and read a run inbox of results, synced from your
  host.
- **Activity & notifications** — an activity feed of what your agent is doing,
  with optional ntfy push notifications so a waiting approval can reach you
  with the app closed.
- **Host status** — gateway health, version compatibility, and connection
  details at a glance.
- **Connections** — Tailscale or LAN, HTTPS only, with automatic route
  probing that picks the fastest reachable address for your host.

## Connecting to Hermes

Expose your Hermes dashboard/gateway over HTTPS (for example with Tailscale
Serve or LAN TLS), then connect in Settings:

- **Pair with QR code (recommended)** — if your host has the
  `hermes-companion-pair` plugin enabled, open the dashboard's **Pair phone**
  page and scan the one-time QR code (or paste the `hermes-pair://v1?...` URI).
  The app probes all advertised routes (`Tailscale` + `LAN`) in parallel,
  redeems the one-time token for a per-device credential and dashboard session,
  and configures chat + dashboard in one step.
- **Enter details manually** — enter your HTTPS gateway/dashboard URL, bearer
  token, and dashboard password in Settings.

Plain HTTP URLs are rejected so your credentials are never transmitted without
encryption. On Android, tokens and device credentials are encrypted with a
non-exportable Android Keystore key; they are never written to WebView
`localStorage`, and app-data backups are disabled.

> **Note on device revocation (v1):** Revoking a paired phone from the
> dashboard's paired-devices list immediately invalidates its dashboard session
> and refresh token. When connected to a Hermes `0.20.0–0.22.x` `api_server`
> that uses a single global `API_SERVER_KEY` (`gatewayTokenScope: "shared"`),
> also rotate `API_SERVER_KEY` on the host if you want to revoke direct
> `/v1/chat/completions` gateway access.

Do not copy the maintainer's hostname, token, `.env` file, or screenshots with
private connection details into an issue or pull request.

## Development

Requirements:

- Node.js 20+ and npm
- Android Studio / Android SDK for APK builds
- Java 21 for the Android Gradle build
- A Hermes gateway for end-to-end testing

```sh
npm install
npm run dev
```

For a local Android debug build:

```sh
npm run build
npx cap sync android
(cd android && ./gradlew assembleDebug --no-daemon)
```

The complete interface is bundled into the APK; no frontend development server
is required after installation. The APK is written to
`android/app/build/outputs/apk/debug/`.

Pushes to `main` run CI (lint, tests, typecheck, web build, Android build) and
republish the v1.0 release APK automatically.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Please
start with an issue for larger changes. Every contribution is reviewed and
built before it is merged.

## Security

See [SECURITY.md](SECURITY.md). If you think a credential was exposed, revoke
it immediately rather than merely deleting the file from the latest commit.

## License

MIT
