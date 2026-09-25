# Legacy Hermes Mobile Feature Inventory

Date inventoried: 2026-09-25

This document records useful ideas and partially implemented features found in obsolete local Hermes mobile prototypes before those duplicate directories were removed. It is a requirements inventory, **not** a claim that the old implementations were production-ready or compatible with the current gateway-authoritative architecture.

The canonical implementation is this repository. Any feature below must be rebuilt or deliberately ported here, then tested against the live Hermes gateway and Android packaging/security requirements.

## Native Kotlin prototype (`~/hermes-android`)

Distinct architecture and behaviors found:

- Native Android implementation using Kotlin, Jetpack Compose, Material 3, Coroutines/Flow, and OkHttp.
- Adaptive phone/tablet concept with a persistent rail on larger displays.
- Cached transcripts and one draft per session, including activity-recreation continuity.
- Explicit active-run controls: stop, steer, and queue a follow-up.
- Approval and clarification cards.
- Explicit connection states: connected, reconnecting, sleeping/offline Mac, authentication failure, and incompatible Hermes version.
- Pairing concept using a base URL plus one-time provisioning payload/QR flow.
- Android Keystore-backed credential storage and cleartext-network restrictions.
- Accessibility requirements: 48dp touch targets, dynamic type, TalkBack labels, edge-to-edge insets, and predictive Back.
- Native test coverage concepts for connection, chat, session APIs, network policy, app startup, and main navigation.
- Planned workspace surfaces: Activity, Artifacts, Automations, Bots, Capabilities, Messaging, Scheduled jobs, and Kanban.
- Planned cross-surface continuity for attaching to runs initiated on Desktop.

## Claude/Antigravity prototype family

The folders `hermes-mobile-antigravity-review`, `hermes-mobile-final`, and `hermes-mobile-production` represented one prototype family. `production` contained the broadest/hardened variant; `final` and `antigravity-review` were near-duplicates.

Useful feature concepts found:

- QR scanner for gateway/pairing details.
- Biometric lock/gate.
- Local notification integration and background-run notification concept.
- Offline queue concept.
- Chat and ZIP export utilities.
- Audio completion chime.
- Persona picker and persona data.
- Prompt-template sheet.
- Global search and in-session search.
- Keyboard-shortcut help.
- Image viewer modal.
- Android setup/guide modal.
- Gateway profiles screen.
- Thinking accordion and explicit tool blocks.
- Rich settings screen and memory inspector.
- Haptics, camera/gallery/document attachments, and image previews.
- `production` additionally contained a credential-store abstraction, native secure-storage bridge, Hermes API adapter tests, and an Android project.

Architecture warning: these prototypes included direct-provider/client-side concepts and packages that conflict with the current rule that the Mac-hosted Hermes gateway is the sole authority. Preserve the product ideas, not the old backend assumptions.

## Old Lovable/TanStack copies

The folders `hermes-connect-mobile-lovable` and `hermes-connect-mobile` were ancestors of the canonical repository.

Ideas or planning details worth retaining:

- Searchable model/route picker grouped by provider/source.
- Active model plus runtime/thinking control in the composer.
- Primary and fallback routes shown separately.
- Named/MoA presets when exposed by the gateway.
- Truthful model states: loading, empty, unauthorized, transport failure, malformed response, and unsupported endpoint.
- One visible Settings gear with mobile-focused accordion sections.
- Headless-host diagnostics showing models, sessions, transcript, capabilities, streaming, app version, commit, active profile, and active model.
- Settings domains proposed for future parity: model/routes, runtime defaults, profile/workspace, appearance, safety, browser, passwords/logins, memory/context, voice, advanced controls, notifications, providers, gateways, tools/keys, archived chats, billing where applicable, and build diagnostics.
- Stale-token recovery and gateway restart/reconnect testing.

Most source files from these copies were already identical to or superseded by the canonical repository. This list preserves only the roadmap concepts that should remain visible.

## Legacy directory with no app (`~/Hermes%20folder`)

This was not an application. It only contained an old `run_claude.py` helper and Finder metadata. No product feature was retained.

## Prioritization for future implementation

### Highest-value next candidates

1. Approval and clarification cards.
2. Stop, steer, and queued follow-up controls.
3. Global and in-session search.
4. Background completion notifications.
5. Connection diagnostics and explicit reconnect/auth/version states.
6. Prompt templates.
7. Chat export.
8. QR-assisted pairing.

### Later/mobile-native polish

- Biometric app lock.
- One draft per session.
- Tablet/foldable adaptive layout.
- Audio completion chime.
- Predictive Back, TalkBack, and dynamic-type audit.
- Native image viewer and Android share-sheet integration.

### Re-evaluate before implementing

- Offline send queue: avoid conflicting with gateway-authoritative sessions and active-run ordering.
- Personas: map only to real Hermes profiles/presets; do not create phone-owned identity state.
- Direct-provider integrations: reject unless explicitly redesigned around Hermes gateway contracts.
- Local transcript databases: use only bounded cache/recovery behavior, never a competing source of truth.
