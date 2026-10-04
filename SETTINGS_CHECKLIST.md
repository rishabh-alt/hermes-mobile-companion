# Headless phone settings checklist

Date: 2026-10-04

The phone is the console. Hermes stays on the headless host. This checklist is the desktop Settings tree with window, keyboard, and overlay controls removed. A row is in scope when it changes the host brain, the phone client, or something that would otherwise be unreachable without a desktop.

Do not copy the desktop renderer. Build these as mobile accordion sections. Every mutation reads the host, writes through a supported contract, then reads the value back. If the host does not expose a control, show that. Do not invent a phone-only fake.

Current app settings cover only connection, token, fallback model, live channel, and haptics. Everything below is still to build unless marked done.

## Phone shell

- [ ] One Settings gear. One section open at a time. Deep editors open their own screen.
- [ ] Search across setting names.
- [ ] Export config, import config, and reset to defaults, with confirmation on destructive actions.
- [ ] Secret values use the host vault or Android Keystore. Never show, log, or store them in WebView storage.
- [ ] Profile switching stays in the session drawer, not as a second settings home.

## Model

- [ ] Main model, provider, and context length.
- [ ] Reasoning effort and service tier.
- [ ] Fallback providers.
- [ ] Auxiliary models, including compression and other host-side helper tasks.
- [ ] Mixture-of-agents presets, only when the host exposes them.
- [ ] Refresh after reconnect or profile switch. Disable an unavailable model with the real reason.

## Chat

- [ ] Personality.
- [ ] Timezone.
- [ ] Show or collapse reasoning.
- [ ] Image input mode.
- [ ] Attachment size limit.
- [ ] Phone-only: haptics. Already present.

## Appearance

Keep what changes the phone. Drop the window.

- [ ] Language.
- [ ] Theme: light, dark, and host skins that the phone can render.
- [ ] UI scale and chat text scale.
- [ ] Chat font.
- [ ] Resume last session.
- [ ] Show model cost in the picker.
- [ ] User bubble, text direction, reactions, tool detail, inline diffs, reasoning collapsed, and embeds.
- [ ] Session-list density for the drawer.

Skip: intro splash, tips, tours, terminal font, simple/advanced window mode, tab strip, titlebar actions, tray, translucency, backdrop, file-browser pane, and floating composer.

## Workspace

These are host paths and execution settings, not a phone file explorer.

- [ ] Default working directory.
- [ ] Project scan roots and exclusions.
- [ ] Shell persistence and environment passthrough.
- [ ] Code-execution mode.
- [ ] File-read size limit.

## Safety

- [ ] Approval mode, timeout, and MCP reload confirmation.
- [ ] Command allowlist.
- [ ] Secret redaction.
- [ ] Private-URL policy.
- [ ] Checkpoints: enabled and snapshot limit.

## Browser and passwords

- [ ] Browser profile and private-network policy.
- [ ] Credential vault: view, add, and revoke.
- [ ] Password-manager sources, when the host supports them.
- [ ] Unlock stays on the host. The phone never receives the master password.

## Memory and context

- [ ] Memory on/off, user profile on/off, and character limits.
- [ ] Memory provider.
- [ ] Inspect, correct, and clear, with confirmation before clear.
- [ ] Context engine.
- [ ] Compression: enabled, threshold, target, protected tail, and timeout.

## Voice

- [ ] Voice-chat mode, recording limit, and direct-client mode.
- [ ] Speech-to-text provider and model.
- [ ] Text-to-speech provider, voice, and auto-speak.
- [ ] Microphone permission stays a phone permission. Provider choice stays a host setting.

## Notifications

- [ ] Master mute.
- [ ] Approval needed.
- [ ] Clarification needed.
- [ ] Turn finished.
- [ ] Turn failed.
- [ ] Background work finished.
- [ ] Credits or quota warning.
- [ ] Plugin alert.
- [ ] Completion sound.

A killed app cannot receive true push yet. Say that. Do not pretend a local notification is a server wakeup.

## Providers

- [ ] Signed-in accounts, including device-code or browser OAuth. No terminal paste.
- [ ] API keys: add, replace, revoke. Write-only display.
- [ ] Custom endpoints.
- [ ] Local models, including LM Studio, when the host exposes them.

## Gateway

The phone's own connection screen stays separate from host administration.

- [ ] Phone connection: HTTPS URL, token test, models, sessions, transcript, and stream. Partly done.
- [ ] Host bind, port, and reachability.
- [ ] Paired devices: list and revoke.
- [ ] Host secret-storage mode. Do not copy the desktop keychain toggle blindly.
- [ ] Diagnostics: version, commit, active profile, active model, and redacted logs.

## Tools and keys

- [ ] Tool API keys.
- [ ] Toolset enable and disable.
- [ ] Tool-use enforcement.
- [ ] Tool output limits.

Computer-use stays off unless the host actually has it. Do not offer a dead desktop-control switch.

## Sessions

- [ ] Archived chats: restore and delete.
- [ ] Auto-archive timing.
- [ ] Default directory as a host path, not a phone folder picker.

## Advanced host runtime

- [ ] Max turns, retries, and service tier.
- [ ] Delegation model, provider, depth, concurrency, and timeout.
- [ ] Terminal backend, timeout, and sandbox image. This configures the host shell, not a phone terminal.
- [ ] Keep the host awake during a run.

## Billing

- [ ] Show plan, usage, and payment actions only when the host exposes them.
- [ ] Hide the section when the account has nothing to manage.

## About

- [ ] App version, build, and commit.
- [ ] Host Hermes version and compatibility.
- [ ] Active gateway, profile, and model.
- [ ] Phone app update check.
- [ ] Host Hermes update check, with an explicit apply step.

## Related console pages

These already have routes or belong beside Settings, not inside a fake form.

- [ ] Capabilities, skills, MCP, and plugins.
- [ ] Artifacts.
- [ ] Scheduled jobs.
- [ ] Messaging.
- [ ] Kanban and activity.
- [ ] Bots.

## Explicitly out

- [x] Keyboard shortcuts.
- [x] HUD modifier and HUD overlay.
- [x] Desktop screen-capture shortcut.
- [x] Quick-entry global hotkey.
- [x] F12 and developer-tools toggle.
- [x] Minimize to tray.
- [x] Window translucency, backdrop, and layout editor.
- [x] File-browser and terminal panes on the phone.
- [x] Floating composer and pet overlay.
- [x] Desktop app uninstall.

## Build order

1. Connection diagnostics and read-back.
2. Model, fallbacks, and auxiliary models.
3. Safety approvals and command allowlist.
4. Providers and tool keys.
5. Memory, voice, and notifications.
6. Workspace, gateway devices, sessions, and host updates.
7. Billing, only if the connected account exposes it.
