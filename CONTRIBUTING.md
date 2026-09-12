# Contributing to Hermes Mobile

Thanks for helping improve the Android companion for Hermes Agent.

## Before opening a pull request

1. Search existing issues before starting work.
2. For a substantial change, open an issue first so the direction is clear.
3. Keep changes focused; avoid unrelated formatting or redesign work.
4. Do not include API keys, gateway tokens, personal hostnames, screenshots
   containing secrets, or generated signing files.
5. Explain which Android version and device you tested on.

## Local setup

```sh
npm install
npm run dev
```

The app connects directly to a Hermes gateway configured in the app's Settings.
A gateway is not included in this repository.

## Checks

Run these before opening a PR:

```sh
npm run lint
npm run build
```

For Android changes, also sync and build the debug APK:

```sh
npx cap sync android
(cd android && ./gradlew assembleDebug --no-daemon)
```

## Pull requests

PRs should include:

- What changed and why
- Testing performed
- Screenshots or a short recording for UI changes
- Any known limitations

The maintainer may ask for revisions, test the change on a physical device, or
merge the PR with squash merging after the checks pass.
