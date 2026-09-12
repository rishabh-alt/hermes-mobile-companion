# Hermes Mobile

An Android companion for [Hermes Agent](https://hermes-agent.nousresearch.com/).
Hermes runs on your Mac; this app provides a polished phone interface that
connects directly to your gateway.

This project is intentionally transparent about its origin: it was initially
vibe-coded with help from Hermes Agent and is now being cleaned up as a normal,
community-contributable open-source project. The maintainer is not a
professional programmer, so clear explanations and patient pull requests are
welcome.

## Architecture

```text
Android phone → Tailscale → Hermes gateway on your Mac
```

The repository contains the client only. It does not contain Hermes, a gateway,
API keys, access tokens, or a hosted proxy.

## Current status

The app can connect to a local Hermes gateway, browse sessions, send chat
messages, stream responses, select models, and attach images/files. It is still
in active development and should be treated as an experimental client.

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
CAP_SERVER_URL=http://127.0.0.1:8080 npx cap sync android
(cd android && ./gradlew assembleDebug --no-daemon)
```

The current Phase 1 APK loads the web client from a local Mac development
server. Start that server with `npm run dev -- --host 0.0.0.0`, then set
`CAP_SERVER_URL` to the Mac address before syncing. A packaged offline client is
planned separately.


## Connecting to Hermes

Install Tailscale on both the Mac running Hermes and the Android phone. In the
app's Settings, enter the gateway URL exposed by your setup and the gateway
access token. Credentials are stored locally by the app and must never be
committed here.

Do not copy the maintainer's hostname, token, `.env` file, or screenshots with
private connection details into an issue or pull request.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Please
start with an issue for larger changes. Every contribution is reviewed and
built before it is merged.

## Security

See [SECURITY.md](SECURITY.md). If you think a credential was exposed, revoke
it immediately rather than merely deleting the file from the latest commit.

## License

A license will be selected before the first public release. Until then, the
repository is public for collaboration and review, not a promise that every
use or redistribution right has been granted.
