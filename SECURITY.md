# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected security vulnerability. Use
GitHub's private vulnerability reporting if enabled, or contact the maintainer
through the contact method listed on the repository profile.

## Never commit secrets

Do not commit Hermes gateway tokens, API keys, passwords, private keys,
Android signing files, `.env` files, personal Tailscale hostnames, or logs that
contain credentials. The app is designed for the user to enter gateway
credentials locally on their device.

If a secret is accidentally committed, revoke it immediately and report the
commit so it can be removed from history. Removing a file in a later commit is
not enough to invalidate a leaked credential.
