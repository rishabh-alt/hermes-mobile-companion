# Hermes Mobile Parity and Headless Administration Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Turn the verified standalone Android companion into a trustworthy primary control surface for a screenless Hermes host, beginning with real model/runtime selection, then profile switching, then secure headless administration.

**Architecture:** Keep the APK as a static Capacitor/Vite client and the host as the single source of truth. Use the existing authenticated API-server model/session contracts for the next test APK. Add narrowly scoped, capability-advertised gateway APIs only where the current API server is intentionally missing profile discovery or administration; never expose the desktop `hermes serve` process or raw config files as a shortcut.

**Tech Stack:** React 19, TypeScript, TanStack Query/Router, Radix/vaul mobile sheets, Vite, Capacitor Android, native Android Keystore AES-GCM, Hermes aiohttp API server, pytest/Vitest, GitHub Actions.

---

## Confirmed Current State

### Authoritative source tree

Implementation must target:

`/Users/mogambo/Downloads/hermes-connect-mobile-current`

Public repository:

`https://github.com/rishabh-alt/hermes-mobile-companion`

Current clean commit:

`059a8d6bfde824c64fd24e8ba183b95e46284426`

The requirements draft currently lives in the older Lovable-connected checkout:

`/Users/mogambo/hermes-connect-mobile/NEXT_VERSION.md`

Do not implement against that older dirty tree. Copy the reviewed roadmap into the standalone repository in the first implementation commit, then continue only in the standalone repository.

### Live gateway findings

The authenticated API server currently advertises:

- `model_options: true`
- `session_model_lock: true`
- `session_chat: true`
- `session_chat_streaming: true`
- `admin_config_rw: false`
- `memory_write_api: false`

Live endpoint behavior:

- `GET /api/model/options` → `200`, shape `{ providers, provider, model }`
- `GET /v1/models` → generic gateway model plus configured route aliases
- `GET /api/profiles` → `404`
- `GET /api/config` → `404`

The model picker bug is therefore known: `src/lib/hermes/rest.ts::modelOptions()` passes the model-options payload through a generic list parser that does not recognize the `providers` shape. `ModelSheet.loadModels()` treats the real response as empty and falls back to `/v1/models`, producing the one generic `hermes-agent` route.

### Existing mobile authority problem

`src/lib/hermes/sessions.ts` currently persists full sessions and transcripts in `localStorage`. New phone sessions receive client-generated eight-character IDs. `src/components/hermes/chat-view.tsx` falls back to stateless `/v1/chat/completions` when its guessed `/ws` transport is unavailable. This means model parity must not be built on top of phone-owned session truth. The gateway already offers authoritative session create/chat/stream/model-lock routes; use those.

---

## Delivery Strategy

Do not attempt every Settings category in one release. Deliver three independently testable milestones:

1. **Milestone A — next test APK:** authoritative sessions plus desktop-equivalent model/runtime picker.
2. **Milestone B — profile parity:** profile discovery and profile-scoped routing through the multiplex gateway.
3. **Milestone C — headless administration:** opt-in, separately authorized administrative APIs and a collapsible mobile Settings console.

Each milestone ends with a physical-device APK and an independent security/code review. Do not begin the next milestone while the previous one has unresolved state-authority or authentication defects.

---

# Milestone A — Authoritative Sessions and Model/Runtime Parity

## Task 1: Establish the clean implementation baseline

**Objective:** Preserve the verified standalone source and move the roadmap into its actual repository.

**Files:**

- Create: `NEXT_VERSION.md` from the reviewed file in `/Users/mogambo/hermes-connect-mobile/`
- Verify: `capacitor.config.ts`
- Verify: `.github/workflows/ci.yml`

**Steps:**

1. Confirm `git status --short --branch` is clean in the standalone checkout.
2. Copy only `NEXT_VERSION.md`; do not copy source or Android output from the Lovable checkout.
3. Run `npm ci --ignore-scripts`, `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build`.
4. Commit: `docs: add next mobile parity roadmap`.

**Gate:** Baseline remains green and Capacitor configuration has no `server.url`.

## Task 2: Model the real gateway capability and model-options contracts

**Objective:** Replace heuristic response parsing with typed parsing of the API server’s advertised contracts.

**Files:**

- Create: `src/lib/hermes/capabilities.ts`
- Create: `src/lib/hermes/model-options.ts`
- Create: `src/lib/hermes/model-options.test.ts`
- Modify: `src/lib/hermes/types.ts`
- Modify: `src/lib/hermes/rest.ts`

**Core types:**

```ts
export interface ModelCapability {
  fast: boolean
  reasoning: boolean
  can_disable_reasoning?: boolean
}

export interface ModelProviderOption {
  slug: string
  name: string
  models: string[]
  featuredModels: string[]
  authenticated: boolean
  isCurrent: boolean
  unavailableModels: Set<string>
  capabilities: Record<string, ModelCapability>
  warning?: string
}

export interface ModelOptionsSnapshot {
  activeProvider: string
  activeModel: string
  providers: ModelProviderOption[]
}
```

**Steps:**

1. Write failing tests for `{providers, provider, model}` parsing.
2. Cover authenticated and unconfigured providers, empty providers, malformed rows, unavailable models, capabilities, MoA, and current provider.
3. Implement a dedicated parser; do not extend the generic `list()` helper with special model semantics.
4. Add `fetchCapabilities()` using only `GET /v1/capabilities` and parse feature flags/endpoints.
5. Add `fetchModelOptions({ refresh })`, using `?refresh=1` only for explicit refresh.
6. Preserve `/v1/models` only as a compatibility fallback when capabilities say `model_options` is absent—not when model-options returns an empty or malformed successful response.
7. Commit: `fix: parse gateway model inventory`.

**Verification:** `npm test -- src/lib/hermes/model-options.test.ts` passes and a development probe reports the configured provider/model without logging credentials.

## Task 3: Replace phone-owned sessions with gateway-owned sessions

**Objective:** Make session identity, messages, model lock, rename, pin, and delete authoritative on the host.

**Files:**

- Create: `src/lib/hermes/session-api.ts`
- Create: `src/lib/hermes/session-api.test.ts`
- Create: `src/store/session-store.ts`
- Modify: `src/lib/hermes/rest.ts`
- Modify: `src/lib/hermes/sessions.ts`
- Modify: `src/lib/hermes/session-sync.ts`
- Modify: `src/components/hermes/session-drawer.tsx`
- Modify: `src/components/hermes/chat-view.tsx`

**Steps:**

1. Write failing tests for session creation, transcript loading, rename, pin, delete, model lock, and profile-scoped URL construction.
2. Implement `POST /api/sessions` for New Chat and use the returned server ID.
3. Replace local transcript persistence with a small in-memory/query cache of server truth.
4. Migrate legacy phone sessions conservatively: show them in a one-time “Local drafts” recovery surface or export them; do not silently upload or merge them into server sessions.
5. Send turns through `POST /api/sessions/{id}/chat/stream` using complete SSE frame parsing. Do not use the unadvertised `/ws` guess.
6. Preserve `POST /v1/chat/completions` only for explicitly detected older gateways and label those sessions non-persistent.
7. Refetch the server transcript after terminal completion to reconcile message IDs, model metadata, and tool output.
8. Replace local rename/delete/pin mutations with optimistic server writes plus rollback and authoritative refresh.
9. Commit: `refactor: make gateway sessions authoritative`.

**Gate:** A phone-created session appears on Desktop, survives app restart, can be continued on either surface, and never depends on WebView transcript storage.

## Task 4: Implement session-owned model and runtime selection

**Objective:** Apply model changes through the real session contract and prove the backend accepted them.

**Files:**

- Modify: `src/lib/hermes/session-api.ts`
- Modify: `src/lib/hermes/session-api.test.ts`
- Modify: `src/components/hermes/chat-view.tsx`
- Modify: `src/lib/hermes/types.ts`

**Request shape:** Build the lock request from the selected provider/model and only the capabilities actually exposed for that model. Use the gateway’s existing runtime request schema; confirm it from `_session_runtime_request_from_body` before coding.

**Steps:**

1. Write failing tests asserting provider + model are sent together and empty model/provider selections are rejected client-side.
2. Add `lockSessionRuntime(sessionId, selection)` using `POST /api/sessions/{id}/model`.
3. Parse the returned `runtime.provider`, `runtime.model`, and `runtime.model_lock` fields.
4. Update UI state only after the backend acknowledges the lock; on failure retain the old active selection and show the exact safe error.
5. Submit the next session-chat turn with the acknowledged provider/model/runtime options.
6. Refetch the session/transcript after completion and display the effective model recorded by the server.
7. Commit: `feat: lock session model and runtime`.

## Task 5: Build the mobile-native route picker

**Objective:** Match the useful desktop picker behavior without copying desktop geometry.

**Files:**

- Rewrite: `src/components/hermes/model-sheet.tsx`
- Create: `src/components/hermes/model-provider-section.tsx`
- Create: `src/components/hermes/model-search.tsx`
- Create: `src/components/hermes/model-sheet.test.tsx`
- Modify: `src/components/hermes/chat-view.tsx`

**Behavior:**

- Composer chip displays `model · reasoning`, e.g. `gpt-5.6-terra · Off`.
- Bottom sheet contains search, active route, configured provider sections, named virtual/MoA routes, reasoning level, fast mode when supported, Refresh Models, and truthful unsupported/edit states.
- Providers are grouped from gateway payload data, never inferred from model-name strings.
- Unauthenticated providers are not mixed into ordinary selection; expose setup only once Milestone C provides a real secure setup flow.

**Steps:**

1. Write component tests for loading, successful grouping, search, active marker, empty inventory, malformed payload, 401/403, transport failure, refresh, unavailable model, and capability-gated runtime controls.
2. Render configured/authenticated providers first; collapse large groups and show featured models before “See all.”
3. Keep only one provider group expanded on narrow screens.
4. Selecting a model calls Task 4’s lock mutation; never close the sheet before acknowledgement.
5. Disable unsupported fast/reasoning choices using the gateway capabilities with a visible reason.
6. Add pull-to-refresh or explicit Refresh Models; avoid both if they duplicate behavior.
7. Commit: `feat: add searchable mobile route picker`.

## Task 6: Milestone A diagnostics and physical-device gate

**Objective:** Prove model selection and persisted session continuity end to end.

**Files:**

- Create: `src/lib/hermes/diagnostics.ts`
- Create: `src/lib/hermes/diagnostics.test.ts`
- Modify: `src/routes/status.tsx`
- Modify: `.github/workflows/ci.yml` if new tests need explicit inclusion

**Checks:**

1. HTTPS health.
2. Authenticated capabilities.
3. Model options and active provider/model.
4. Session create/list/transcript.
5. Session-chat stream.
6. Session model lock.
7. Reconnect after gateway restart.

**Commands:**

```bash
npm ci --ignore-scripts
npm audit --audit-level=moderate
npm test
npx tsc --noEmit
npm run lint
npm run build
npx cap sync android
(cd android && ./gradlew clean assembleDebug --no-daemon)
```

**Physical device acceptance:**

1. With no Vite/preview process running, install the APK.
2. Open an existing Desktop session and continue it from phone.
3. Create a phone session and verify it appears on Desktop.
4. Select `openai-codex / gpt-5.6-terra`, set reasoning Off, send a real turn, and read back the server-recorded runtime.
5. Switch to an available Gemini route and repeat.
6. Restart the app and verify the same authoritative transcript and model lock return.
7. Commit: `test: verify mobile model parity`.

---

# Milestone B — Profile Discovery and Switching

## Task 7: Add a read-only profile inventory to the API server

**Objective:** Let external clients discover served profiles without exposing general admin configuration.

**Hermes Agent files:**

- Modify: `gateway/platforms/api_server.py` only to register/advertise the route
- Create: `gateway/platforms/api_server_profiles.py`
- Create: `tests/gateway/test_api_server_profiles.py`

**Contract:**

`GET /api/profiles` returns only safe profile metadata required for selection: canonical name, display label, default/current markers, optional active model summary, and profile-prefix path. Never return filesystem paths, secrets, SOUL text, raw config, or environment data.

**Steps:**

1. Add invariant tests for bearer auth, safe response shape, default profile, named profiles, deleted/tombstoned exclusion, and multiplex profile isolation.
2. Add `profiles` to `/v1/capabilities` only when the route is present.
3. Implement route logic in the new topical sibling; keep `api_server.py` as registration/facade.
4. Run `scripts/run_tests.sh tests/gateway/test_api_server_profiles.py`.
5. Commit in a dedicated Hermes Agent branch: `feat(api): expose safe profile inventory`.

## Task 8: Add profile-scoped URL construction to mobile

**Objective:** Route every model/session/capability request through the selected profile’s multiplex prefix.

**Mobile files:**

- Create: `src/lib/hermes/connection-scope.ts`
- Create: `src/lib/hermes/connection-scope.test.ts`
- Create: `src/store/profile-store.ts`
- Modify: `src/lib/hermes/rest.ts`
- Modify: `src/lib/hermes/client.ts`
- Modify: `src/lib/hermes/session-api.ts`

**Rules:**

- Default profile uses the unprefixed base.
- Named profile uses `/p/{encoded-profile}/...` exactly as the API server advertises.
- The selected profile name may be stored as harmless presentation/connection state, but all sessions, models, tools, and memory remain server-owned.
- A late response from the previous profile must be discarded with a generation/request token.

**Tests:** Default/named profile URL, encoding, stale-response rejection, connection change, deleted profile, and profile unavailable after reconnect.

**Commit:** `feat: add profile-scoped gateway client`.

## Task 9: Replace Memory with the active-profile switcher

**Objective:** Make “which Hermes am I speaking to?” visible in the drawer’s permanent utility slot.

**Files:**

- Modify: `src/components/hermes/session-drawer.tsx`
- Create: `src/components/hermes/profile-switcher.tsx`
- Create: `src/components/hermes/profile-switcher.test.tsx`
- Modify: `src/routes/memory.tsx`
- Modify: `src/routes/settings.tsx`

**Steps:**

1. Replace the bottom-left Memory link with active profile name + switch affordance.
2. Open a searchable bottom sheet listing gateway-reported profiles.
3. On selection, keep the shell mounted, cancel/strand old requests, clear gateway-bound caches, connect to the selected profile prefix, then reload sessions/model/capabilities.
4. Never merge rows from the previous profile.
5. Move Memory to Settings → Memory & context → Data & memory.
6. Show a recoverable error if a selected profile no longer exists.
7. Commit: `feat: add authoritative profile switcher`.

**Physical gate:** Switch default → named profile → default and prove session lists, active model, tools, and context never bleed between profiles.

---

# Milestone C — Secure Headless Administration

## Task 10: Design and approve the administrative security boundary

**Objective:** Avoid turning the ordinary chat bearer token into unrestricted remote machine administration.

**Decision required before code:** Use a distinct, opt-in administrative credential/capability. The normal API token continues to authorize chat/session/model-read functions. Administrative mutation requires a separate admin credential stored in Android Keystore and sent only to advertised admin endpoints.

**Required properties:**

- Disabled by default.
- Tailnet HTTPS remains required.
- Exact CORS origin allowlist.
- Separate chat and admin authorization checks.
- No raw `.env` download or generic filesystem/config mutation endpoint.
- Secrets are write-only/masked-status; never returned after save.
- Every destructive operation is typed, logged with redacted metadata, and confirmed in UI.
- Capability flags truthfully enumerate each supported admin section.
- Gateway restart/update operations return durable action IDs so the phone can reconnect and read status.

**Deliverable:** A short API contract/design document reviewed before implementation.

## Task 11: Add the narrow administrative API as a topical gateway module

**Objective:** Expose only concrete settings operations required by the mobile console.

**Hermes Agent files:**

- Create: `gateway/platforms/api_server_admin.py`
- Create: `tests/gateway/test_api_server_admin.py`
- Modify: `gateway/platforms/api_server.py` for route registration/capabilities only
- Modify configuration in the canonical gateway config loader as required

**Initial API groups:**

- Admin capabilities/schema
- Safe resolved configuration reads and whitelisted updates
- Profile lifecycle where appropriate
- Model/provider route assignments
- Masked provider credential status plus write/delete/validate operations
- Gateway status, logs, restart, and update plan/status
- Tools/toolsets and MCP enable/test/config
- Messaging status/test/config
- Cron/job administration
- Memory-provider status and explicit correction/deletion flows
- Voice/STT/TTS settings
- Notification and safety settings
- Archived sessions and About/build metadata

Do not mount FastAPI desktop routers directly into aiohttp. Reuse lower-level domain functions behind small adapter handlers so Desktop and mobile share behavior without sharing transport implementation.

**Tests:** Normal token denied; admin token accepted; missing capability 404/501; per-profile scoping; secret redaction; write/read-back; destructive confirmation nonce/idempotency; restart survivability; CORS; audit logs; malformed inputs.

**Gateway test command:**

```bash
scripts/run_tests.sh tests/gateway/test_api_server_admin.py tests/gateway/test_api_server_profiles.py
```

## Task 12: Extend native secure storage for named credentials

**Objective:** Store chat and admin credentials separately without exposing either to WebView persistence.

**Files:**

- Modify: `android/app/src/main/java/app/hermes/companion/SecureStoragePlugin.java`
- Modify: `src/lib/hermes/secure-storage.ts`
- Modify: `src/lib/hermes/config.ts`
- Modify/Create tests around credential migration and ordering

**Rules:**

- Named entries: chat token and admin token.
- Android Keystore AES-256-GCM, fresh IV per write, no backups.
- Values never returned to logs, errors, analytics, or URL query strings.
- Admin credential remains memory-only in JavaScript after native retrieval.
- Failure is closed and asks for re-pairing/re-entry.

## Task 13: Build the collapsible mobile Settings console

**Objective:** Make practical desktop settings reachable from a phone without creating one unmanageable page.

**Files:**

- Rewrite: `src/routes/settings.tsx`
- Create: `src/components/settings/settings-home.tsx`
- Create: `src/components/settings/settings-section.tsx`
- Create: `src/components/settings/settings-registry.ts`
- Create sub-screens under `src/routes/settings/` or equivalent file-route structure
- Create tests for registry, capability gating, loading/error/write/read-back states

**Top-level collapsed sections:**

1. Model & routes
2. Chat/runtime defaults
3. Profile/workspace
4. Appearance
5. Safety
6. Browser
7. Passwords & logins
8. Memory & context
9. Voice
10. Advanced
11. Notifications
12. Providers
13. Gateways
14. Tools & keys
15. Archived chats
16. Billing, when applicable
17. About/build diagnostics

**Interaction rules:**

- One top-right Settings gear from chat.
- Only one accordion section expanded at a time.
- Complex editors navigate to a dedicated sub-screen.
- Search filters section names and settings labels.
- Each row shows current authoritative value/status, not just a control.
- Writes use optimistic feedback only when safely reversible; otherwise wait for acknowledgement.
- Every write reads back the effective value.
- Unsupported capabilities are either omitted with an explanation in diagnostics or shown disabled with the backend requirement; never render dead controls.
- HUD, layout editor, and desktop utility-strip chrome are not separate mobile destinations.

**Commit sequence:** One section family per commit; do not land a monolithic settings rewrite.

## Task 14: Headless recovery workflows

**Objective:** Let the phone repair the common failures that matter when the host has no monitor.

**Required workflows:**

- Gateway health and component status
- Safe redacted log viewer with search/component filters
- Restart gateway and watch reconnection
- Update plan → snapshot → apply → fleet verification receipt
- Provider credential re-entry/validation through secure flow
- Model route repair and fallback selection
- Profile availability and selection repair
- Tailscale/tunnel reachability diagnosis without exposing private host details
- Export diagnostic bundle with secrets redacted

Do not promise recovery from failures that sever the only network/control path. The UI must state when physical or SSH access is required.

## Task 15: Final release, review, and rollback gate

**Objective:** Ship a reproducible APK without regressing the working standalone client.

**Verification:**

- Full mobile CI command set from Milestone A.
- Targeted Hermes Agent API tests through `scripts/run_tests.sh`.
- Independent spec-compliance review.
- Independent security review focused on admin authorization, secret handling, CORS, profile isolation, and destructive operations.
- Physical S24 Ultra test over the exact Tailscale HTTPS route.
- Stop all frontend development servers and retest bundled UI.
- Record APK package/version, SHA-256, size, commit, and CI URL.
- Preserve the last known-good APK for rollback until the new build passes physical testing.

---

## Major Risks and Mitigations

### Risk: Building UI over the wrong control plane

Desktop settings routes live under `hermes serve`; the current API server intentionally advertises `admin_config_rw: false`. Do not point the phone at Desktop-only routes and call 404s empty states. Extend the API server narrowly and advertise each capability.

### Risk: Ordinary chat token becomes remote root access

Use a separate opt-in admin authorization boundary. Never mount raw file/config/env endpoints. Secret values are write-only and native-secure.

### Risk: Local phone session state diverges from Hermes

Remove transcript ownership from WebView localStorage before model/profile parity. Gateway session IDs and transcripts are canonical.

### Risk: Profile state leaks

All requests use one connection/profile scope resolver. Cancel or ignore stale previous-profile responses. Tests assert profile isolation.

### Risk: One giant release becomes impossible to debug

Ship three milestones with physical-device gates. Model parity uses existing contracts first; profile and admin API work follow as separate reviewed changes.

### Risk: Headless recovery cannot fix a dead network path

Expose diagnostics and restart/update operations, but clearly identify failures requiring SSH or physical intervention. A phone cannot repair the service that carries its only request if both the gateway and fallback management channel are unreachable.

---

## Completion Definition

The project is complete when:

1. The APK remains self-contained and works with no Vite/Lovable runtime.
2. Phone and Desktop show the same authoritative sessions and active runtime.
3. The route picker displays the real grouped gateway inventory and applies provider/model/reasoning changes through acknowledged server contracts.
4. Profile switching changes the authoritative profile scope without cross-profile leakage.
5. A headless host can be administered from the phone for every capability the gateway advertises, through a collapsible Settings console.
6. Chat and administrative credentials remain distinct, encrypted at rest, absent from logs/backups/WebView storage, and protected in transit.
7. CI, independent review, and physical-device tests pass for every milestone.
