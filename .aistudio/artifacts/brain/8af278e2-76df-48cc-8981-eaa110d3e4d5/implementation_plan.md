# Hermes Companion — Full Feature Restoration Plan

This plan restores all 9 product features that were narrowed out of the original plan while preserving every security boundary from your Hermes Agent's host review (zero long-lived credentials in QR codes, strict SSE vs. Native HTTP transport split, write-only `/api/env` secrets, and host-verified reads/writes).

## User Review & Critical Decisions

> [!IMPORTANT]
> **Confirmed Scope & Security Boundaries**
> - **Confirmed Decision 1 (Full 9-Feature Scope)**: We will implement all 9 omitted capabilities from the original plan in this pass without duplicating existing collapsible session groups or breaking the transport split.
> - **Confirmed Decision 2 (Safe QR Onboarding + One-Time Code Exchange)**: `Settings → Connection` will include a live `<video>` camera QR scanner, scan-from-photo fallback, pasteable input, and a **Share Gateway Address QR** card. Raw bearer tokens and passwords remain strictly banned from QR payloads; scanning an HTTPS URL populates the gateway address, while scanning/pasting a short-lived one-time pairing code exchanges it via `POST /api/pairing/exchange` on the HTTPS host.

---

## 1. Overview & Core Concept

- **What It Does**: Upgrades Hermes Companion with the complete mobile UX and operational parity from the original vision: pre-chat profile/model/reasoning setup, `All / Cron / Messaging` session drawer filters, a complete action/fallback audit across Capabilities, Messaging, Artifacts, Jobs, and Kanban, desktop-style compact tool rows, live camera QR onboarding, Kanban attention sorting + worker-session links, a host-backed Memory Inspector, and full theme/density/notification preferences.
- **Target Audience / Persona**: Power users operating a headless Hermes Agent server over Tailscale Serve / HTTPS who want desktop-grade control and visibility from their phone.
- **Key Value**: Combines the rock-solid security and reliability fixes already completed with the rich ergonomics, filtering, and inspection workflows from the original design.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **New-Chat Setup Card (`ChatView` Empty State)**:
     - Opening a fresh chat displays an interactive setup card below the Hermes emblem where you can switch the **Active Profile**, choose the **Provider & Model**, set **Reasoning effort** (`off` / `low` / `medium` / `high`), and toggle **Fast mode** before sending your first prompt.
  2. **Drawer Parity (`All / Cron / Messaging` Filters) & Complete Screen Audit**:
     - The session drawer adds a segmented **`All · Cron · Messaging`** filter bar above the existing `Pinned / Today / This week / Earlier` collapsible groups, filtering sessions by `source` or title/metadata prefix, and respects **Drawer density** (`comfortable` vs `compact`).
     - **Capabilities (`/capabilities`)**: Tapping a skill expands its full `SKILL.md` / content via `skillContent` (backed by `apiOrDashboard`); MCP servers gain a **Test** button (`testMcpServer`) alongside the enable/disable switch with explicit toast feedback on success or failure.
     - **Messaging (`/messaging`)**: Platform tests and webhook toggles route through `apiOrDashboard` and surface clear toast feedback on both success and failure.
     - **Artifacts (`/artifacts`)**: Tapping any artifact opens a detail/preview card with a Download/Open action and a direct **Open session** link when `session_id` is present.
  3. **Desktop-Style Tool Rows (`MessageBubble`)**:
     - Tool calls render as sleek, single-line desktop-style rows (`[state icon] tool_name · summary/arg preview · chevron`) that expand on tap to show structured input and terminal/JSON output, defaulting to collapsed or expanded based on your **Tool detail** setting in Appearance.
  4. **Live Camera QR Onboarding, One-Time Code Exchange & Share QR (`Settings → Connection`)**:
     - Tapping **Address QR** opens a camera viewfinder (`getUserMedia` + `BarcodeDetector` with photo-capture fallback), a pasteable URL / one-time code input (`POST /api/pairing/exchange`), and a **Share Gateway Address QR** visual matrix encoding only the safe `https://` gateway URL.
  5. **Kanban Attention Sorting & Worker-Session Links (`/kanban`)**:
     - Within each column, cards requiring attention (`blocked`, `needs_attention`, `review`, `urgent`, or flagged) sort to the top with a clear unboxed status label, and any card carrying a `session_id` / `worker_session_id` displays a direct **Open worker session** link.
  6. **Host-Backed Memory Inspector (`Settings → Memory & context`)**:
     - Displays `/api/memory` status plus any peer/fact entries returned by `/api/memory` or `/api/memory/peers`, with search filtering and an inline **Correct / Remove fact** action (`POST /api/memory/correct` or `DELETE /api/memory/facts/:id`) when supported by the host.
  7. **Fuller Appearance & Notification Preferences (`Settings → Appearance & Notifications`)**:
     - **Appearance**: Adds **Theme** (`Dark / Light / System`), **Tool detail** (`Compact / Expanded`), and **Drawer density** (`Comfortable / Compact`) alongside Haptics, Reasoning traces, and Text size.
     - **Notifications**: Adds a **Scheduled job failures** alert toggle alongside Turn finished and Approvals & questions.
  8. **Document Attachments & Active Approval/Clarify Restoration (`ChatView`)**:
     - All camera photos, images, PDFs, and text/code files queue in the composer preview bar until Send; PDF/document attachments extract readable text (or attach structured document metadata + base64 payload) so Hermes receives document context.
     - When opening or refreshing a session, `ChatView` checks the host's active session/run payload and restores an unanswered `approval` or `clarify` card *only* when the host confirms it is still active.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: High-contrast utilitarian console supporting both deep dark mode and crisp daylight light mode (`Dark / Light / System`).
  - *Color Palette & Mood*: OKLCH semantic tokens (`--background`, `--card`, `--primary`, `--muted-foreground`, `--destructive`) with hairline borders and zero decorative pill clutter.
  - *Typography & Hierarchy*: Clean sans-serif UI labels, `tabular-nums` for counts/timestamps, and `font-mono` for tool arguments, cron schedules, and environment keys.
  - *Component Styling & Layout*: $\ge 44\text{px}$ touch hitboxes on mobile, single-elevation cards, and unboxed `·`-separated metadata.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Safe QR Onboarding with Optional One-Time Code Exchange**
  - *Chosen Approach*: Never embed bearer tokens, dashboard passwords, or admin keys in QR codes. The built-in QR generator encodes only the `https://` gateway address. When scanning or pasting, if the input is a short-lived one-time pairing token (`hermes-pair:...` or `POST /api/pairing/exchange`), exchange it over HTTPS with the host; if it is a raw credential payload, reject it with a clear warning.
  - *Why*: Gives you effortless camera QR onboarding and device-to-device address sharing while respecting the host security boundary.

- **Decision 2: Host-Confirmed Active Approval/Clarify Restoration**
  - *Chosen Approach*: Query `/api/sessions/:id` (or inspect active run metadata returned during session pull) and only render an approval or clarify card if the host reports `pending_approval` / `pending_clarify` on an active run—never from stale local storage.
  - *Why*: Prevents acting on expired tool approvals while ensuring you don't lose an active prompt if you switch apps and return.

- **Decision 3: Typed Host API First for Memory Inspector**
  - *Chosen Approach*: Add typed client methods (`readDashboardMemoryPeers`, `correctDashboardMemoryFact`) targeting `/api/memory` and `/api/memory/peers` (via `apiOrDashboard` / `dashboardRequest`). When the host exposes peer facts, render the interactive inspector and correction form; when the host only exposes provider/status metadata, show that cleanly without fake placeholder facts.
  - *Why*: Ensures 100% honest host state with zero mock data.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         Hermes Companion UI Layer                          │
│                                                                            │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │   Chat & Composer    │  │  Drawer & Screens    │  │ Settings Console │  │
│  │ ──────────────────── │  │ ──────────────────── │  │ ──────────────── │  │
│  │ • New-Chat Setup Card│  │ • All/Cron/Messaging │  │ • Live Camera QR │  │
│  │ • Desktop Tool Rows  │  │   Drawer Filters     │  │   & Share QR SVG │  │
│  │ • PDF/Doc & Text     │  │ • Capabilities: Skill│  │ • Memory Peer    │  │
│  │   Attachment Queue   │  │   View & MCP Test    │  │   Inspector      │  │
│  │ • Host-Confirmed     │  │ • Artifacts Preview  │  │ • Theme, Density │  │
│  │   Approval Restore   │  │   & Session Link     │  │   & Tool Detail  │  │
│  │                      │  │ • Kanban Attention   │  │   Preferences    │  │
│  │                      │  │   Sort & Worker Link │  │                  │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └────────┬─────────┘  │
└─────────────┼─────────────────────────┼───────────────────────┼────────────┘
              │                         │                       │
              ▼                         ▼                       ▼
┌─────────────────────────┐  ┌───────────────────────────────────────────────┐
│  Standard Fetch (SSE)   │  │      apiOrDashboard & Dashboard Native HTTP   │
│ ─────────────────────── │  │ ───────────────────────────────────────────── │
│ • /api/sessions/*/stream│  │ • /api/skills/content, /api/mcp/servers/*     │
│ • /api/sessions/*/watch │  │ • /api/messaging/platforms/*/test, /webhooks  │
│ • /api/sessions/*/model │  │ • /api/memory, /api/memory/peers, /pairing    │
└─────────────────────────┘  └───────────────────────────────────────────────┘
```

- **Data Model & State (`HermesConfig` & Host Types)**:
  - Extend `HermesConfig` with optional persisted preferences:
    - `theme?: "dark" | "light" | "system"`
    - `toolDetail?: "compact" | "expanded"`
    - `drawerDensity?: "comfortable" | "compact"`
    - `notificationPrefs?: { turnComplete: boolean; approvals: boolean; cronFailures?: boolean }`
  - Extend `Session` & `SessionInfo` with optional `source?: string` (`"cron" | "messaging" | "chat"` or platform name) so `SessionDrawer` can filter `All / Cron / Messaging` accurately.

- **Interactive Component & State Mapping**:
  - **`ChatView` & `MessageBubble`**:
    - Render `NewChatSetupCard` when `shown.length === 0` with profile selector, model sheet trigger, reasoning effort segmented buttons (`off | low | medium | high`), and fast mode switch.
    - Update `ToolBlock` in `MessageBubble` to show a compact 1-line summary header (tool name, first input argument or status summary, and status badge) and initialize `open` from `config.toolDetail === "expanded"`.
    - Check `fetchSessionState` on session load to hydrate active `approval` / `clarify` requests only when the host reports them active.
  - **`SessionDrawer` & Gateway Screens**:
    - Add `filter: "all" | "cron" | "messaging"` segmented buttons in `SessionDrawer` above `Pinned` and apply `config.drawerDensity` padding.
    - Route `skillContent`, `setMcpEnabled`, `testMcpServer`, `testMessagingPlatform`, and `setWebhookEnabled` through `apiOrDashboard` in `rest.ts`.
    - Add expandable skill reader and MCP `Test` button in `/capabilities`, error toasts in `/messaging`, interactive preview + session jump link in `/artifacts`, and attention-first sorting + worker-session links in `/kanban`.
  - **`SettingsRoute` (`Connection`, `Memory`, `Appearance`, `Notifications`)**:
    - Add live `<video>` camera QR scanner (`BarcodeDetector`), one-time code exchange (`exchangePairingCode`), and client-side QR SVG renderer for the gateway's HTTPS address.
    - Add `MemoryInspector` inside `DashboardMemoryPanel` for inspecting and correcting host peer/fact entries when exposed by `/api/memory`.
