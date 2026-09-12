# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected security vulnerability. Use
GitHub's private vulnerability reporting if enabled, or contact the maintainer
through the contact method listed on the repository profile.

## Never commit secrets

Do not commit Hermes gateway tokens, API keys, passwords, private keys,
Android signing files, `.env` files, personal Tailscale hostnames, or logs that
contain credentials. The app is designed for the user to enter gateway
credentials locally on their device. Android gateway tokens are encrypted with
a non-exportable Android Keystore key, excluded from WebView storage, and app
data backups are disabled.

Hermes currently authenticates its WebSocket transport with a token query
parameter. The app permits this only over `wss://` and never logs the socket URL.
Gateway operators and reverse proxies must also avoid recording query strings.

If a secret is accidentally committed, revoke it immediately and report the
commit so it can be removed from history. Removing a file in a later commit is
not enough to invalidate a leaked credential.
