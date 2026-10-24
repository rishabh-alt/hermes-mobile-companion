# SPEC — Hermes Companion Pairing: host plugin + QR scan flow

**Version:** v1 (2026-10-23) · **Author:** Momo (spec) · **Builder:** Argon
**Status:** Ready to build. Step 0 is a verification spike — do not skip it.
**Repos:** NEW repo `hermes-companion-pair` (the plugin) + changes in `hermes-mobile-companion` (the app).

---

## 1. Problem

Connecting Hermes Companion to a Hermes host today means typing a Tailscale/LAN
address, port, username, and password into the phone, then hoping the route works.
Hermes core has no device-pairing flow (its dashboard "pairing" page is for
messaging-platform users, and `POST /api/pairing/exchange` 401s unauthenticated —
verified 2026-10-21). Every other Hermes client has the same problem. This plugin
is the host-side half that makes one-scan pairing possible, published as a
standalone community plugin (Nous's stated pattern for third-party plugins:
standalone repo, installed into `~/.hermes/plugins/`, never patched into core).

## 2. User experience (the whole point — keep it this simple)

**Host (once):**
```
hermes plugins install rishabh-alt/hermes-companion-pair --enable
# restart hermes dashboard (plugin API routes mount at startup, not on rescan)
```

**Pairing (every phone, ~10 seconds):**
1. Open dashboard → **Companion** tab → **Pair new device** → QR appears
   (or run `hermes companion pair` and get the QR in the terminal).
2. In the app: **Connect → Scan QR** → point camera → done. No typing.
3. The device shows up in the Companion tab's device list. Revoke it there any time.

The app's existing manual connect form stays as the fallback ("Enter details manually").

## 3. Verified platform facts (Nous docs + source, checked 2026-10-23)

- Plugin layout: `~/.hermes/plugins/<name>/` with optional `plugin.yaml` +
  `__init__.py` (`register(ctx)`), plus a `dashboard/` subdir.
- `ctx.register_cli_command(name, help, setup_fn, handler_fn)` →
  `hermes <name> <subcommand>` is a supported pattern. Slash commands via
  `ctx.register_command()`.
- Dashboard plugin: `dashboard/manifest.json` + pre-built JS bundle (IIFE) at
  `dashboard/dist/index.js`; registers via `window.__HERMES_PLUGINS__.register(name, Component)`;
  SDK on `window.__HERMES_PLUGIN_SDK__` (React, shadcn components, `SDK.fetchJSON`
  which injects the session token). Icons are Lucide names (`KeyRound` exists).
- Backend: `dashboard/plugin_api.py` exporting a module-level FastAPI
  `router = APIRouter()`; mounted under `/api/plugins/<name>/*`.
- **⚠️ CRITICAL: plugin API routes sit behind the dashboard's normal auth gate —
  unauthenticated requests 401 before the route runs.** This shapes §6.
- Durable plugin state: `plugin_data_dir()` / `plugin_db()` survive
  `hermes plugins update`/`remove` and follow the active profile.
- Discovery: `GET /api/dashboard/plugins`, rescan via
  `GET /api/dashboard/plugins/rescan` (UI only — API routes need a dashboard restart).
- Test tooling: `hermes plugins doctor <path>` and
  `hermes plugins validate <path> --install-deps` (same check catalog CI runs).
- Dashboard auth (from our own 2026-10-21 audit of the 0.22.2 install): basic
  provider; `POST /auth/password-login` sets `hermes_session_at` / `hermes_session_rt`
  cookies; the app currently authenticates with those cookies.
- The developer guide lists `ctx.register_dashboard_auth_provider()` as a real
  extension point (dashboard auth providers are pluggable).

## 4. Step 0 — verification spike on Hermes 0.22.2 (Rishab's live version)

Docs track `main`; the app supports hosts 0.20.0–0.22.x. Before building:

1. `GET /api/dashboard/plugins` on the 0.22.2 dashboard → confirm the endpoint
   and plugin discovery exist there.
2. Drop a hello-world dashboard plugin (manifest + bundle + one `plugin_api.py`
   route) into `~/.hermes/plugins/` → confirm the tab renders and the route answers.
3. **Resolve the §6 question in `hermes_cli/web_server.py`:** is there any
   public/unauthenticated exemption for plugin API routes? (Expected answer: no.)
4. Locate the basic auth provider's credential store and check whether
   `register_dashboard_auth_provider` is usable from a directory plugin on 0.22.2.

Deliverable of the spike: one paragraph in the plugin repo's `NOTES.md` stating
which §6 mechanism is live on 0.22.2. Everything else in this spec is
mechanism-independent.

## 5. Plugin design (`hermes-companion-pair`)

### 5.1 Layout
```
hermes-companion-pair/
├── plugin.yaml                 # manifest: name, version, capabilities (see §5.5)
├── __init__.py                 # register(ctx): CLI commands (§5.4)
├── pairing/
│   ├── store.py                # offers + devices, backed by plugin_db()
│   ├── offers.py               # create/validate/burn pairing offers
│   └── credentials.py          # per-device credential issue/verify/revoke (§6)
└── dashboard/
    ├── manifest.json           # name "companion-pair", label "Companion",
    │                           # icon "KeyRound", tab.path "/companion-pair",
    │                           # tab.position "after:skills", api "plugin_api.py"
    ├── plugin_api.py           # FastAPI router (§5.2)
    └── dist/
        ├── index.js            # IIFE bundle; React from SDK, never bundled
        └── style.css           # theme vars only (--color-*), no hard-coded colors
```

### 5.2 Backend endpoints (mounted at `/api/plugins/companion-pair/`)

All sit behind dashboard auth (that's fine — the *host user* calls these):

| Method & path | Purpose |
|---|---|
| `POST /offers` | Create a pairing offer. Returns the full QR payload (§7) + `expires_at`. Called by the dashboard tab and mirrored by the CLI. |
| `GET /devices` | List paired devices: `id`, `name`, `paired_at`, `last_seen_at`, `credential_state`. Never returns secrets. |
| `DELETE /devices/{id}` | Revoke a device: delete its credential + registry entry. |
| `POST /devices/{id}/rotate` | Rotate a device's credential (re-pair without removing the entry). P2 — stub OK in v1. |

### 5.3 Dashboard tab UI

- **Pair new device** button → calls `POST /offers` → renders the QR (payload
  encoded with any tiny QR lib bundled into the IIFE, or rendered server-side as
  SVG by `plugin_api.py` — pick whichever keeps the bundle smaller) + a live
  countdown to expiry + the payload as copyable text (for phones that can't scan
  a screen, e.g. the phone *is* the screen — see §8 fallback).
- Polls `GET /devices` every 2 s while an offer is open; when the new device
  appears, show "Paired: <name>" and close the offer view.
- Device list with per-device **Revoke** (confirm inline, no modal lib).
- Empty state copy: one line explaining what pairing is. No marketing text.

### 5.4 CLI (via `register_cli_command` in `__init__.py`)

```
hermes companion pair            # create offer, print QR (ASCII) + payload text in terminal
hermes companion devices         # table of paired devices
hermes companion revoke <id>     # revoke
```
Terminal QR: any pure-Python QR encoder as a declared `python_dependencies`
entry in `plugin.yaml`, or print the payload text only if adding the dep is a
problem — decide in the spike, prefer the dep (the QR *is* the product).

### 5.5 `plugin.yaml` capabilities (declare honestly — users get one consent screen)

- Registers: 1 dashboard tab + backend routes, 1 CLI command tree.
- Stores: pairing offers + device credentials (hashed) in `plugin_db()`.
- Network: binds nothing new (rides the dashboard server) unless §6 lands on
  mechanism C — if it does, that must be declared and off by default.

## 6. THE redemption problem — read carefully, pick in this order

The phone, before pairing, holds **no session**, and plugin API routes 401
unauthenticated. So "app POSTs the secret to `/api/plugins/companion-pair/redeem`"
does **not** work as-is. Choose the first mechanism the Step-0 spike proves out:

**Mechanism A — public-route exemption.** If `web_server.py` offers any way for
a plugin route to opt out of the auth gate, put `POST /redeem` there
(body: `pair_id` + `secret` + `device_name`). Cleanest. Expected: unavailable.

**Mechanism B — pairing auth provider (preferred realistic path).**
Register a dashboard auth provider via `ctx.register_dashboard_auth_provider()`
that (1) accepts a one-time pairing exchange — `pair_id` + `secret` — and
(2) afterwards validates **per-device credentials** the plugin issues (see §6.1).
The app redeems through whatever login surface the provider plugs into, and ends
up with a normal dashboard session. All later app traffic is stock dashboard API.

**Mechanism C — plugin's own redemption listener (last resort).**
The plugin runs a minimal HTTP listener on its own port (default `9121`,
bind Tailscale + LAN interfaces only, never `0.0.0.0` unless the user opts in)
serving only `POST /redeem`. Works regardless of dashboard internals; costs a
second port + firewall surface. Must be declared in capabilities, with the port
configurable and the listener only alive while an offer is open (start on offer
creation, stop on redeem/expiry — a listener that exists ≤5 min per pairing is
a much smaller target than a permanent one).

### 6.1 What redemption hands back — per-device credentials (all mechanisms)

Do **not** hand the phone the user's password or a raw session cookie as the
long-term credential. On successful redeem the plugin:

1. Burns the offer (single-use — §9).
2. Creates a device record: `device_id` (uuid), `name` (from the app's redeem
   body, e.g. "Rishab's S24 Ultra"), `paired_at`.
3. Issues a **per-device credential**: 256-bit random secret, stored **hashed**
   (SHA-256 is fine at this entropy) in `plugin_db()`, returned to the app
   exactly once.
4. The app stores it in its existing secure storage and presents it on future
   logins (exact presentation follows the chosen mechanism — provider login
   field under B, or `Authorization: Bearer` to a plugin validation route under
   A/C-style hybrids). If the spike shows none of this is reachable on 0.22.2,
   fall back to: redeem returns a standard session via the provider exchange and
   the app re-pairs when the session dies — ship that, file the limitation in
   the README, do not gold-plate.
5. **Revoke** = delete the device record + credential. Known v1 limitation to
   state in the README: an already-live session cookie may survive until its
   own expiry; revocation guarantees the device cannot log in *again*.

## 7. QR payload format (versioned — the contract between plugin and app)

```json
{
  "v": 1,
  "type": "hermes-companion-pair",
  "host_name": "mogambos-macbook-pro",
  "routes": [
    { "kind": "tailscale", "url": "http://100.104.99.93:9119" },
    { "kind": "lan",       "url": "http://192.168.1.42:9119" }
  ],
  "redeem": { "mode": "provider", "path": "/auth/pairing-login" },
  "pair_id": "3f9c1d2e-....",
  "secret": "<43-char base64url, 256-bit>",
  "expires_at": 1761247200
}
```

Rules:
- `routes` ordered by host preference; the app re-probes anyway (§8). Include
  every route the host knows: Tailscale IPv4, LAN IPv4, MagicDNS name if present.
- `redeem.mode`/`path` come from the chosen §6 mechanism (`"provider"`,
  `"plugin-public"`, or `"listener"` + the listener's port inside `routes`-style
  entries). The app must refuse unknown modes with a named error, not a crash.
- `secret` is the *only* sensitive field; it never appears in logs (host or app).
- Payload is plain JSON, no encryption — the transport is the user's own
  LAN/Tailscale and the secret is single-use + 5-minute TTL (§9). Do not add a
  crypto layer in v1.
- The app must reject: wrong `type`, `v` > supported, `expires_at` in the past —
  each with its own user-facing message.

## 8. App-side changes (`hermes-mobile-companion`)

1. **Connect screen:** primary action becomes **Scan QR code**; the existing
   form moves behind "Enter details manually" (unchanged behaviour).
2. **Scanner:** Capacitor barcode-scanning plugin (evaluate
   `@capacitor-mlkit/barcode-scanning` vs `capacitor-barcode-scanner` — pick the
   one that ships without Google Play Services drama on sideloaded APKs like
   ours; this choice matters because v1.0 is a direct-download APK).
   Camera permission string: "Scan a pairing code from your Hermes dashboard".
3. **Pairing flow (new module `src/lib/hermes/pairing.ts`):**
   parse + validate payload → probe routes with the existing
   `resolveOptimalHostRoute` logic (first route that answers wins; try all
   before failing) → redeem against the winning route → receive per-device
   credential + host profile → persist via existing host-profile + secure
   storage code → run the existing version-compat check (0.20.0–0.22.x
   statuses) → land on chat.
4. **Paste fallback:** "Paste pairing code instead" — accepts the payload JSON
   as text (covers QR-on-the-same-phone and CLI-only hosts).
5. **Error mapping (user-facing, no raw exceptions):**
   - `pairing_expired` → "That code expired — generate a new one in the dashboard."
   - `pairing_used` → "That code was already used. Generate a fresh one."
   - `pairing_invalid` → "That code isn't valid for this host."
   - routes unreachable → "Couldn't reach your Hermes on any address in the
     code. Same Wi-Fi, or Tailscale on?"
   - version mismatch → reuse the existing version-status copy.
6. **No type-safety shortcuts:** the repo's standing rule applies — call sites
   aligned with real types; no `as any`, no `@ts-ignore`, no tsconfig loosening.
   `npx tsc --noEmit` is part of the local gate before any push (the last two
   web-CI failures were exactly this).

## 9. Security requirements (non-negotiable in v1)

- Offer secret: 256-bit, from a CSPRNG; stored **hashed**; TTL **300 s**;
  **single-use** (burned on first successful redeem *and* on expiry).
- Rate limits: max 5 failed redeem attempts per offer → offer burned;
  max 10 offers created per hour per host.
- Offers can only be created from an authenticated dashboard session or the
  host CLI — i.e. proof of already owning the host. The QR is shown only in
  those two places. Never expose offer creation on any unauthenticated surface.
- Redeem responses must not distinguish "pair_id unknown" from "secret wrong"
  (single generic `pairing_invalid`).
- Per-device credentials: 256-bit, hashed at rest, shown exactly once.
- Audit: one log line per offer created / redeemed / failed / revoked
  (timestamp + pair_id/device_id only — never secrets, never payloads).
- The plugin must fail closed: any internal error during redeem → offer burned,
  generic error to the app.

## 10. Acceptance tests

**Spike:** §4 items 1–4 answered in `NOTES.md`.
**Plugin:**
- [ ] `hermes plugins doctor` + `validate` clean.
- [ ] Fresh profile: install → restart dashboard → Companion tab appears,
      backend routes answer (200 authed / 401 unauthed).
- [ ] Offer → QR → redeem → device listed; second redeem of same secret →
      `pairing_used`; expired offer → `pairing_expired`; 5 bad secrets → burned.
- [ ] Revoke → device credential no longer logs in.
- [ ] `hermes companion pair` prints a working QR; `devices`/`revoke` work.
- [ ] Plugin disabled → its routes are refused (dashboard behaviour), tab gone.
**App:**
- [ ] Scan flow E2E on a real device against Hermes **0.22.2** (release APK
      path, not just dev build).
- [ ] Paste-payload fallback works.
- [ ] Every §8.5 error renders its message (force each one).
- [ ] Manual connect unchanged; existing test suite green (120/120 baseline),
      `tsc` clean, lint clean.
**End-to-end (the demo that matters):** fresh app install → scan → chatting,
timed, no typing. Target: under 30 seconds including camera aim.

## 11. Out of scope for v1

- Multi-host / multi-profile pairing bundles (one QR = one host profile).
- iOS app support (payload format is platform-neutral; scanner lands with the app).
- Submitting to the official plugin catalog (ship on GitHub first;
  `hermes plugins install rishabh-alt/hermes-companion-pair` is the distribution;
  catalog submission is a follow-up once 0.22.x behaviour is proven).
- Any change to Hermes core. If the spike finds the dashboard-plugin API
  missing on 0.20.x, set the plugin's floor at the first version that has it
  and say so in the README — do not backport.

## 12. Why this shape (one paragraph, for the README)

Hermes has no device pairing because its clients were desktops. Phones are
becoming primary clients, and "type your Tailscale IP, port, username and
password" is the wall every mobile user hits. This plugin is that missing wall
demolition, built entirely on Hermes's public plugin surfaces — dashboard tab,
plugin API, CLI commands — so it installs in one command, survives Hermes
updates, and any Hermes client (not just Companion) can implement the scan side
against §7's payload contract.
