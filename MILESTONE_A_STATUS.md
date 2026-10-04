# Milestone A Status

**Project:** Hermes Mobile Companion  
**Branch:** `feature/mobile-model-session-parity`

This document summarizes what has already been completed, what is still left, the current bugs, and the specific area of the code we were fixing.

---

## What we have done

### Model / route picker
- Implemented a real parser for the gateway `/api/model/options` response.
- Replaced the fake/generic model list fallback with a provider-grouped, searchable picker.
- Kept provider and model as separate fields instead of guessing from one string.
- Added route locking so the selected provider/model pair is acknowledged by the gateway.

### Chat transport
- Switched chat sends toward the gateway-authoritative session flow.
- Added the session stream helper for `/api/sessions/{id}/chat/stream`.
- Preserved attachment forwarding for text + image content.
- Added fail-closed stream handling so truncated streams do not silently look successful.

### Session handling
- Gateway-backed session creation is implemented.
- Local phone transcript storage is no longer the source of truth.
- Session import is now intended to be cache-only for live rendering.
- Legacy transcript/localStorage cleanup is part of the migration.

### Security / packaging
- HTTPS-only gateway validation remains in place.
- Android secure storage / Keystore handling remains in place.
- Android backup remains disabled.
- Standalone APK packaging remains in place.
- Capacitor sync and Android debug build were previously verified.

### Verification already passed earlier
- Tests passed in prior verification runs.
- TypeScript passed in prior verification runs.
- Production build passed in prior verification runs.
- APK was built successfully earlier in the task.

---

## What we were fixing most recently

The last round of work was focused on the remaining Milestone A blockers from independent review:

1. **Gateway-authoritative rename/delete**
   - Session rename and delete in the drawer were still local-only.
   - We started wiring them to the gateway `renameSession` / `deleteSession` APIs.

2. **Camera send readiness checks**
   - Camera/photo submission was bypassing the same readiness checks used by normal send.
   - We started gating camera submission on configuration, route readiness, and pull state.

3. **Pull overwrite race**
   - A session pull could overwrite a user message if the user sent before the pull finished.
   - We started adding a generation-style guard so stale pull results would be ignored.

---

## Current bugs / blockers

### 1) TypeScript is currently broken in the working tree
The last check failed with:
- `src/components/hermes/chat-view.tsx`: `Cannot find name 'pullGeneration'`
- `src/lib/hermes/session-sync.ts`: `Cannot find name 'Role'`

So the tree is **not currently clean** and needs one more fix pass.

### 2) Pull-overwrite protection is incomplete
The intended fix was to make `pullSession` results fail closed if the user submits a new message while the pull is still running. That protection still needs to be completed and re-verified.

### 3) Session import / cache behavior still needs final validation
We were in the middle of separating:
- gateway transcript fetch
- local cache import for rendering
- stale-cache protection

That still needs a final test pass.

### 4) Rename/delete gateway flow needs final cleanup
The drawer has been partially patched, but it still needs a clean, verified pass so rename/delete are fully gateway-authoritative and the UI stays in sync after success/failure.

---

## What remains to be done

### Code completion
- Fix the current TypeScript errors.
- Finish the stale pull protection logic.
- Ensure camera sends obey all readiness checks.
- Finish gateway rename/delete behavior cleanly.
- Re-run the session tests and related chat tests.

### Verification
Run the full gate again:
- `npm test`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- `npx cap sync android`
- Android debug build if needed

### Finalization
- Inspect the final diff for regressions.
- Commit locally on the feature branch.
- Do not push or merge until the diff is clean and verified.

---

## Short version

We successfully moved Milestone A toward gateway-authoritative sessions, real model routing, and secure Android packaging. The remaining work is to finish the last fail-closed session/routing fixes and clear the current TypeScript errors before the branch is ready.
