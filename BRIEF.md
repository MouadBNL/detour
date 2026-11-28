# Detour — Product & Technical Brief (v1)

## 1. Vision & Core Thesis

**Detour** is a Chrome and Firefox browser extension that intercepts visits to distracting websites and asks for a reason. A fast decision model evaluates the request within user-defined guardrails and responds with one of three outcomes: **grant**, **hold**, or **deny**.

The blocking mechanism is table stakes. Detour wins on the **craft of the interruption** and **closing the loop after access is granted**—turning mindless habits into conscious choices and honest self-reflection.

### Guiding Principles

1. **Honest speed bump, not a jail.** MV3 extensions cannot stop a determined user from disabling them. Hard walls trigger rage-uninstalls; Detour prioritizes dignified exits, progressive friction, and treating overrides/bypasses as signals to record rather than crimes to punish.
2. **A hold is _"yes, at 14:32"_, not a waiting room.** Most impulsive urges fade within a few minutes. Instead of immediately saying no, Detour can offer a brief hold that lets the user return to what they were doing—never trapping their eyes on a ticking countdown and never yanking them back into the distraction when the timer ends.
3. **Friction habituates; scarcity and consequence don't.** A reason that disappears into the void becomes a password you type on autopilot. Detour quotes your own reasons back to you, varies the prompt, tracks whether visits felt worth it, and surfaces insights right on the gate screen—the one place you actually look every day.
4. **Two systems, one door.** Users can run Detour completely anonymously with their own API key (BYOK) or sign in to use a starter allowance with zero setup. Both paths share the exact same decision engine, UX, and local-first privacy defaults.

---

## 2. Core User Loop & UX Design

### Onboarding (Under 60 Seconds)

1. **One-line North Star (optional, encouraged):** _"What are you protecting your attention for right now?"_ Gives the model real context instead of generic scolding.
2. **Starter sites:** Pick from presets or add domains, requesting optional host permissions in one clean batched prompt.
3. **Choose your door:** Use the starter allowance (zero API setup—ideal for friends trying Detour) or connect **OpenRouter** (BYOK).

### The Gate (`blocked.html`)

Intercepted navigations redirect cleanly to a local extension page (0 ms render, zero flash of the blocked site):

- **Duration first, against a visible daily budget:** Ask how long they need (e.g. `2m`, `5m`, `15m`, `30m`) before asking why. Day rolls over at **4:00 AM** local time so late-night browsing doesn't reset friction at midnight.
- **Deterministic fast-path:** The first short unblock of the day (or a tiny 2-minute urgent check within budget) can grant immediately with zero model latency and zero credit cost.
- **Progressive friction:** Repeated visits to the same site during the day escalate friction naturally—surfacing the pattern rather than blocking blindly on visit #1.
- **Defeating muscle memory (day 14+):**
  - Rotate the prompt locally based on context (zero extra LLM latency): free text, _"What does done look like?"_, _"What are you stepping away from?"_, or showing today's earlier reasons + _"What's different now?"_
  - Detect near-duplicate reasons locally and reflect it dryly (_"You've typed this 9 times this week"_) while switching the question. Never disable paste; make boilerplate pointless.
  - **Never punish honesty:** _"I'm bored"_ should fare better than plausible boilerplate like _"for work"_, otherwise users learn to lie and their own analytics become useless.
- **Dignified off-switch:** _"Pause Detour (1 hour / rest of today)"_—logged as an event and auto-resuming so users never uninstall just to get work done.

### Tri-State Decision (`grant` | `hold` | `deny`)

Every non-fast-path request sends compact structured context (`siteHost`, `reason`, `requestedMinutes`, `userGoal`, `localTime`, `todayVisitCount`, `recentReasonsAndOutcomes`) to the decision engine. A **deterministic policy engine** owns hard limits (max grant duration, daily budget, cooldown bounds) and clamps the model's structured output `{ decision, holdMinutes, grantMinutes, category, nudge }`.

| Decision                          | Behavior                                                                                                                                     | UX Rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`grant`**                       | Immediately opens the site for the clamped duration.                                                                                         | Shows the commitment + dry 1-line nudge; transitions smoothly without jarring flashes.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`hold`** _(signature mechanic)_ | Defers access for a short urge-surfing window (default **3 min**), pre-committing to the grant that follows (_"Opens at 14:32 for 10 min"_). | **Fixed contract:** a matured hold always converts to that grant in 1 click (no hold chains, no re-interrogation). Show an **absolute time**, not a ticking seconds counter. Primary CTA: _"Back to what I was doing"_. **Never auto-redirect** when ready—keep the pass claimable for ~10 min with a quiet toolbar badge dot. Track 4 outcomes: `claimed`, `lapsed`, `skipped`, `closed`. Offer a scarce skip (_"This can't wait"_, e.g. 2/day shown on screen). Locally adapt holds per site/hour based on lapse rate. |
| **`deny`**                        | Last resort when user-configured limits are hit (daily budget exhausted, quiet hours).                                                       | In v1, `deny` cites the user's own rule; otherwise downgrades to a longer hold. Always offers a calm exit (wait, pause Detour, or logged override).                                                                                                                                                                                                                                                                                                                                                                      |

- **Latency & fail-soft fallback:** Frame the ~0.5–2 s model call as a deliberate breath. Enforce a hard **~5–6 s timeout**. On timeout, offline, provider error, or zero remaining credits, fall back deterministically (brief pause + 5-min pass logged as `fallback`)—never a hard wall or paywall.

### Closing the Loop (Expiry & Local Reflection)

- **Post-grant follow-up:** When a grant expires, quote the user's stated reason back verbatim (_"'quick check' — 10 min elapsed"_) and capture a 1-tap follow-up:
  - _"Got what I came for"_
  - _"Drifted"_
  - _"Wasn't worth it"_
    _(Exact expiry UX—e.g. an on-demand in-page overlay with a "2 more minutes" wrap-up vs. a tab redirect—is intentionally left open until the extension prototype is running.)_
- **Gate-first distribution:** Surface **one dry, observational insight card directly on the hold screen**, where you already have 3 minutes of attention.
- **Local Dashboard (extension page):** Powered entirely by an append-only local IndexedDB event log.
  - **Urge clock:** Gate hits by hour and weekday.
  - **Said vs. did:** Stated reason/category (`task-required`, `boredom`, `avoidance`, `habit`, `social`, `stress`) vs. follow-up verdict and actual duration.
  - **Lapsed holds:** Plain facts (_"7 of 11 waits, you never came back. 85 minutes granted, never claimed"_). No fabricated _"time saved"_ counterfactuals.
  - **Your own words:** Most frequent words/phrases across reasons (naturally shareable).
  - **Personal bests & rule proposals:** Longest uninterrupted stretch (unbreakable—no streaks, no daily scores, no red/guilt UI) + actionable suggestions (_"You always claim YouTube holds—switch to direct timer?"_).
  - **Day-7 weekly recap** + **JSON export/import** (backup + feedback from friends) + user-reviewed **"Share summary"** card.
  - **Tone:** Dry, calm, observational. Use _detour / wait / pass_ rather than _block / violation_.

---

## 3. "Two Systems, One Door" Architecture

```text
packages/decision          (pure: prompt builder, promptVersion, Zod schema, policy clamp, fallback)
  ▲                                            ▲
  │                                            │
apps/extension                             apps/api
  ├─ ai/decide.ts          (port: Result<Decision, DecideError>)
  ├─ ai/byok.adapter.ts    (SW → OpenRouter directly, local clamp)
  └─ ai/managed.adapter.ts (SW → oRPC → apps/api /decide → clamp → credit_ledger)
```

- **BYOK path (Anonymous, first pass: OpenRouter):**
  - Clean provider adapter interface starting with **OpenRouter** (one key, access to fast/cheap models; check OpenRouter PKCE OAuth during spike for 1-click connect). Direct OpenAI/Anthropic/Gemini adapters plug in cleanly post-v1.
  - API key lives in the extension's own IndexedDB, like all other extension data (not `storage.local`, which Firefox lets content scripts read; see ADR 0002). Only the background worker reads it and makes provider calls. Key never leaves the browser to Detour.
- **Managed path (Full accounts + friends-first starter allowance):**
  - **Full authentication from day 1** (real user accounts via tab-based browser pairing + OAuth/Better Auth on Hono + Drizzle, following the template's `docs/backend.md` auth recipe).
  - **One-time welcome grant** per verified account (e.g. ~$1 internal budget, **displayed to users as ~500 decisions/unblocks**—decoupling UX from token math).
  - Tracked in an append-only `credit_ledger` (micro-cents + idempotency key per decision) so monthly grants, top-ups, or subscriptions plug in later without schema rewrites.
  - **Abuse resistance by design:** `/decide` is _not_ a general LLM proxy. The server constructs the prompt from bounded structured fields (`reason <= 300 chars`), uses a fixed fast/cheap model, enforces small `max_tokens`, re-clamps output, and applies a daily ceiling (~50–100 decisions/day).
  - **Zero Stripe in v1:** When the starter grant runs out, users can switch seamlessly to BYOK (or request a top-up during the friends beta).
- **Privacy Contract (Explicit & Honest):**
  - All history, reasons, follow-ups, and analytics live **locally only** in extension IndexedDB (append-only event log, ready for future opt-in E2EE sync). The same database holds guard state and credentials; credentials are never included in the JSON export.
  - **BYOK mode:** Zero requests to Detour servers.
  - **Managed mode:** `{ siteHost, reason, compact context }` transits `apps/api` solely to run the decision model and is **not persisted**; the server stores only ledger metadata and cost.

---

## 4. Monorepo, Template & Modern Extension Stack

### Starting From `~/Projects/project-template`

Start directly from the full `project-template` repository (`node tools/rename-scope/src/main.ts detour`) rather than cherry-picking. Its zero-product-bloat structure, strict `Result` + `*.adapter.ts` / `*.effect.ts` conventions, `packages/ui` design tokens, PGlite local dev DB, and fast cached `pnpm check` loop match Detour's long-term shape cleanly.

```text
apps/
  extension/          Chrome + Firefox MV3 extension (WXT target, React 19, Tailwind v4)
  api/                Hono + oRPC + Drizzle (Postgres / PGlite): auth, /decide, credit_ledger
  web/                Marketing site, privacy policy, auth/pairing callback (TanStack Start prerendered)
packages/
  decision/           Pure prompt builder, Zod schemas, policy clamp, fallback, 30+ eval fixtures
  contracts/          Shared Zod + oRPC API contracts
  result/             Result type utilities
  db/                 Drizzle schema, migrations, PGlite/Postgres client
  ui/                 Shared Tailwind v4 design tokens + Base UI primitives
```

### Chrome & Firefox MV3 Architecture

- **Framework:** **WXT** (Vite-native, active 2026 ecosystem, cross-browser Chrome + Firefox MV3 builds, `fakeBrowser` Vitest support, `wxt zip` / store submission). _Contingency:_ if the Vite+ Rolldown override (`vite@*: catalog:`) clashes with WXT in Spike 1, either scope the override to exclude `apps/extension` or use a lean custom Vite+ multi-entry build.
- **Blocking via `declarativeNetRequest` (DNR) as a pure projection of stored state:**
  - `dynamic` rules for the user's blocklist (persists across restarts, fails closed).
  - Higher-priority `session` `allow` rules for active grants (auto-clears on browser restart).
  - Redirect blocked navigations via `requestDomains` + `regexFilter`/`regexSubstitution` to `blocked.html` (avoiding broad `webNavigation` history warnings and Shadow DOM / Tailwind v4 `:root` / `rem` clashes).
  - Always `await` allow-rule installation before redirecting back to the target URL.
- **Timers & lifecycle resilience:**
  - Absolute timestamps in storage + `chrome.alarms` (30 s min).
  - Idempotent `reconcile()` on `onStartup`, `onInstalled`, alarm fire, and incoming messages (handles Chrome SW suspension and Firefox MV3 event pages).
  - Open a `runtime.connect` port from `blocked.html` during the LLM request to keep the worker alive.
  - Sweep open tabs (`tabs.query`) at expiry to catch SPAs and bfcache restores.
- **Permissions & store readiness:**
  - Minimal install permissions: `declarativeNetRequestWithHostAccess` + optional per-site host permissions; listen to `permissions.onRemoved` and surface revoked access in the popup.
  - Prefer **browser-tab pairing** (open normal tab on `apps/web` → poll/callback) over `launchWebAuthFlow` so Chrome and Firefox behave identically.
  - **Firefox AMO requirements:** declare `data_collection_permissions` accurately (hostnames/reasons leave device for AI evaluation), plan reproducible source bundling for review, and use unlisted signing for friends beta. Submit store skeletons early.
- **Template guardrail adaptations:**
  - Extend `REACT_CODE`, `WEB_SIZE`, `DEFAULT_EXPORT_ALLOWED` (WXT entrypoints), and `repo/boundaries` in `vite.config.ts` (extension ↛ `apps/api`/`packages/db`; content scripts ↛ AI adapters; `packages/decision` in `PURE_PACKAGES`).
  - Wrap `chrome.*` / `browser.*` APIs in `*.adapter.ts` and listeners in `*.effect.ts`.
  - Add WXT entrypoints to `knip.config.ts` and a Playwright persistent-context extension project in `e2e/`.

---

## 5. Scope: v1 (Friends Release) vs. Later

| In Scope for v1                                                                                   | Explicitly Deferred (v2+)                                          |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Chrome + Firefox MV3 extension                                                                    | Firefox Android / Safari / mobile                                  |
| DNR blocking + `grant` / `hold` / `deny` + deterministic policy clamp                             | Anti-tamper native helper / incognito enforcement                  |
| Progressive friction, 4am rollover, scarce skips, dignified pause                                 | Complex scheduling calendars / team policies                       |
| Expiry re-block + 3-option post-grant follow-up                                                   | Live cross-tab shared timers across devices                        |
| Local IndexedDB event log + extension analytics dashboard + weekly recap + JSON export/import     | Cloud sync (waiting for opt-in E2EE design) & synced web dashboard |
| BYOK via OpenRouter (pluggable adapter interface)                                                 | Direct OpenAI / Anthropic / Gemini / local Ollama providers        |
| Full auth (accounts + tab pairing) + `/decide` API + one-time starter allowance + `credit_ledger` | Stripe billing, subscriptions, recurring monthly grants            |
| Lightweight marketing site + privacy policy + auth/pairing page                                   | Full marketing blog / public community leaderboards                |
| ~30 prompt regression fixtures in `packages/decision`                                             | Automated online eval pipeline                                     |

---

## 6. Pre-Build Spikes (Validate Before Writing Product Code)

1. **WXT + Vite+ Monorepo Spike (~2 hrs):** Copy `project-template`, rename scope to `@detour/*`, add minimal `apps/extension` with WXT, verify `wxt dev`, `wxt build` (Chrome + Firefox), `vp check`, `vp test`, and `knip` against `vite@*: catalog:` and `typescript: ^7.0.2`.
2. **Cross-Browser MV3 Spike (~2 hrs):** Verify DNR `regexSubstitution` redirect to `chrome-extension://` and `moz-extension://` gate page, `storage.local.setAccessLevel("TRUSTED_CONTEXTS")`, and `scripting.executeScript` (for expiry handling if chosen) in both Chrome and Firefox.
3. **Auth Pairing & OpenRouter PKCE Spike (~1 hr):** Validate the tab-based pairing flow with full accounts (Better Auth + Hono/Drizzle) on Chrome and Firefox, and check whether OpenRouter's PKCE flow works cleanly for 1-click BYOK setup.

---

## 7. Open Implementation Details (Decide During Prototyping)

- **Expiry presentation:** On-demand in-page overlay with a free _"2 more minutes"_ wrap-up (preserves unsaved drafts) vs. redirecting the tab back to the gate page—evaluate in real use once the extension skeleton is running.
- **Locked v1 defaults:** Full user accounts from day 1, **4:00 AM** daily rollover, **3-minute** default hold, and **2 daily** _"this can't wait"_ skips.
