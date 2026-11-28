# ADR 0003: Auth Pairing, Cloudflare D1 + WorkOS AuthKit, & OpenRouter PKCE Spike (Spike 3)

- **Status:** Accepted (Go: Cloudflare Workers + D1, WorkOS AuthKit + Tab-Based Pairing, OpenRouter Headless PKCE)
- **Date:** 2026-11-27
- **Context:** Pre-build Spike 3 from `BRIEF.md` (updated after architecture review to target Cloudflare Workers Free + D1 + WorkOS AuthKit)

## Decision

1. **Hosting & Database — GO with Cloudflare Workers + Cloudflare D1 (SQLite):**
   Migrate `@detour/db` from Postgres/PGlite to **Drizzle SQLite (`drizzle-orm/sqlite-core` + `drizzle-orm/d1`)**, giving Detour a single Cloudflare dashboard and `$0/mo` Workers Free + D1 Free deployment for the friends release and early public beta. **Wrangler is the API's only runtime** (`wrangler dev` on workerd + local D1, `wrangler d1 migrations apply`, `wrangler deploy`; config in `apps/api/wrangler.jsonc`); the Node server (`main.ts`, `@hono/node-server`) is gone. Vitest tests run on Node's built-in `node:sqlite` (`DatabaseSync`) wrapped in `drizzle-orm/sqlite-proxy` configured with `d1Codecs`, sharing the **exact same `Db` type (`SQLiteAsyncDatabase<"async", unknown>`) and SQLite migrations** as Cloudflare D1 with zero WASM/Docker overhead.
2. **Managed Accounts & Cross-Browser Pairing — GO with WorkOS AuthKit + Typed oRPC Tab Pairing:**
   Adopt **WorkOS AuthKit (`@workos-inc/node@^12.4.0`, native `workerd` build)** for web sign-in/sign-up (1M free MAU, hosted UI, built-in email verification, stateless sealed cookies at <1 ms CPU on Workers Free—avoiding `scrypt` password-hashing CPU caps). Keep our **contracts-first oRPC `pairing` module** and dedicated **scoped `extension_tokens`** so Chrome and Firefox MV3 extensions open a normal browser tab (`/pair?code=...`) and poll for a single-use scoped bearer token (`dtr_...`) without `browser.identity.launchWebAuthFlow`.
3. **OpenRouter BYOK PKCE — GO (Headless PKCE + Manual Paste Default; Static Web Relay Optional):**
   Adopt **OpenRouter OAuth PKCE (`S256`)** in **headless mode** (omitting `callback_url`) as the default 1-click-authorize BYOK path alongside **manual API key paste** (`sk-or-v1-...`). Headless PKCE strictly honors `BRIEF.md`'s _"BYOK mode: Zero requests to Detour servers"_ privacy contract, works identically on Chrome and Firefox without `web_accessible_resources` or extra host permissions, and exchanges `{ code, code_verifier, code_challenge_method: "S256" }` directly from the extension to `https://openrouter.ai/api/v1/auth/keys` (which sends `access-control-allow-origin: *`).

## Exact Versions Tested

| Tool / Package                 | Resolved Version | Notes                                                                          |
| ------------------------------ | ---------------- | ------------------------------------------------------------------------------ |
| `@workos-inc/node`             | `12.4.0`         | Ships dedicated Cloudflare Workers `index.worker.mjs` (`workerd`) build        |
| `@cloudflare/workers-types`    | `5.20261127.1`   | Provides `D1Database` types for `@detour/db` and `apps/api/src/worker.ts`      |
| `drizzle-orm` / `drizzle-kit`  | `1.0.0-rc.5`     | `dialect: "sqlite"`, `drizzle-orm/d1` + `d1Codecs`, `drizzle-orm/sqlite-proxy` |
| `node:sqlite` (`DatabaseSync`) | Node `26.13.0`   | Test-only SQLite engine (zero native addons, <1 ms test resets)                |
| `wrangler`                     | `4.168.0`        | `dev` (workerd `1.20261123.1`, local D1), `d1 migrations apply`, `deploy`      |
| `hono`                         | `4.13.x`         | Served by the Worker entry (`worker.ts`)                                       |
| `@orpc/contract` / `server`    | `1.16.2`         | Typed `authenticated` and `webAuthenticated` middlewares                       |
| `wxt`                          | `0.21.5`         | Built `connect.html` in both `chrome-mv3` and `firefox-mv3`                    |
| `typescript`                   | `7.0.2`          | Zero errors under strict workspace `tsconfig.base.json`                        |
| `vite-plus` (`vp`)             | `1.5.1`          | oxlint (type-aware), oxfmt, Vitest 5.1.0, Knip 6.44.2, jscpd 5.4.2             |

_(Also previously verified `better-auth@1.7.28` + `drizzle-orm@1.0.0-rc.5` + PGlite before choosing WorkOS AuthKit + Cloudflare D1 to avoid password-hashing CPU limits on Workers Free and eliminate auth UI / transactional email plumbing.)_

## Part 1: Cloudflare D1 + WorkOS AuthKit + Tab-Based Pairing

### Architecture & Sequence

```text
Extension (Chrome / Firefox)             apps/web (/pair)               apps/api (Cloudflare Worker)
────────────────────────────             ────────────────               ───────────────────────────────────
1. POST /rpc/pairing/start  ──────────────────────────────────────────▶ Insert pairing_sessions (pending)
   { browser, deviceName }  ◀──────────────────────────────────────────   stores sha256(deviceCode), userCode
   returns { deviceCode, userCode, verificationPath, expiresAt }

2. browser.tabs.create(
     "<webOrigin>/pair?code=XXXX-YYYY"
   )                        ───────────▶ 3. If signed out: redirect to
                                            /api/auth/sign-in?returnTo=/pair?code=...
                                            -> WorkOS AuthKit hosted UI
                                            -> /api/auth/callback
                                               - upsert WorkOS user into D1 `users`
                                               - set HttpOnly `wos-session` sealed cookie
                                         4. POST /rpc/pairing/lookup ──▶ Verify sealed cookie (JWKS cached per isolate)
                                         5. User clicks "Approve"
                                            POST /rpc/pairing/approve ─▶ Atomic UPDATE status='approved', user_id

6. POST /rpc/pairing/poll   ──────────────────────────────────────────▶ Atomic UPDATE approved -> consumed
   { deviceCode }           ◀──────────────────────────────────────────   mint "dtr_<32B>", store sha256(token)
   returns { status: "approved", accessToken, tokenId, scopes, user }     in extension_tokens (returned ONCE)

7. Subsequent RPC calls
   Authorization: Bearer dtr_... ─────────────────────────────────────▶ resolveRequestSession() hashes token,
                                                                          verifies !revoked && !expired
```

### Schema & Database Design (`packages/db`)

- **Worker-safe package root (`@detour/db`):** Exports `createD1Db(env.DB)` (`drizzle-orm/d1`), `Db`, `tryQuery` and the schema with **zero Node built-ins**, so `wrangler deploy --dry-run` bundles only `node:crypto` (covered by `nodejs_compat`). An earlier layout re-exported the `node:sqlite` client from the root, which `app.ts` imports, and would have dragged `node:sqlite` (unsupported in workerd) into the Worker bundle.
- **Test-only entrypoint (`@detour/db/testing`, `src/testing/sqlite.adapter.ts`):** Uses Node's built-in `node:sqlite` behind `drizzle-orm/sqlite-proxy` with `d1Codecs` (`drizzle-orm/d1`) so `timestamp_ms` (`Date`) and JSON columns (`scopes: string[]`) hydrate identically to Cloudflare D1. Test database resets run in ~0.1 ms (down from ~2.5 s PGlite WASM init).
- **Tables (`packages/db/migrations/20261127195142_users_and_pairing/migration.sql`):**
  - `users`: local WorkOS user projection (`id` = WorkOS `user_...`, `email` unique, `name`, `created_at`, `updated_at`), upserted on `/api/auth/callback` so `pairing_sessions`, `extension_tokens`, and future `credit_ledger` keep strict `ON DELETE CASCADE` foreign keys.
  - `pairing_sessions`: `device_code_hash` (unique), `user_code` (unique), `browser`, `device_name`, `status`, `user_id`, `created_at`, `expires_at`, `approved_at`, `consumed_at`.
  - `extension_tokens`: `user_id`, `token_hash` (unique), `browser`, `device_name`, `scopes` (JSON array), `created_at`, `expires_at`, `last_used_at`, `revoked_at`.
- **SQLite / D1 error mapping (`packages/db/src/query.adapter.ts`):** Maps both local `node:sqlite` error codes (`errcode` 2067/1555/1299/787/275) and Cloudflare `D1_ERROR: ...: SQLITE_CONSTRAINT` messages into typed `ConstraintViolation` / `DbUnavailable` `Result` errors, rethrowing unexpected SQL defects.

### Security Notes

- **No plaintext secrets at rest:** Only SHA-256 digests (`device_code_hash`, `token_hash`) are stored in D1.
- **URL leakage does not grant access:** `/pair?code=ABCD-EFGH` exposes only the short confirmation `userCode`; polling `pairing.poll` requires the 256-bit `deviceCode` held solely in the extension.
- **Single-use atomic redemption:** the token is minted by one statement, `INSERT INTO extension_tokens ... SELECT ... FROM pairing_sessions WHERE id = ? AND status = 'approved' AND expires_at > ?`, and `extension_tokens.pairing_session_id` is unique, so a pairing yields at most one token even under concurrent polls, with no interactive transaction (D1 has none). The insert is the commit point: a failure before it leaves the pairing redeemable; marking it `consumed` afterwards is bookkeeping. Approval is likewise conditional on `status = 'pending' AND expires_at > now`.
- **Privilege separation (`authenticated` vs `webAuthenticated`):** Extension bearer tokens can call extension endpoints (`auth.me`, future `decision.decide`), while account/device management (`pairing.lookup`, `pairing.approve`, `pairing.deny`, `pairing.listDevices`, `pairing.revokeDevice`) requires a WorkOS `web_session` and rejects extension tokens with `403 FORBIDDEN { reason: "web_session_required" }`.
- **Login CSRF guard:** `/api/auth/sign-in` uses the SDK's `getAuthorizationUrlWithPKCE`; the random `state`, the PKCE verifier and `returnTo` live in an HttpOnly `detour_sign_in` cookie (path `/api/auth`, 10 min). The callback requires that cookie and a constant-time match of `state` before exchanging the code with the verifier, so a victim cannot be signed into an attacker's account with a forwarded callback URL.
- **Open-redirect guard:** `returnTo` is resolved the way a browser resolves it (backslashes and control characters rejected first) and kept only if it stays on our origin; `/\evil.example`, `/<TAB>/evil.example` and `//evil.example` all return to `/`.
- **Session cookie only on same-origin requests:** `SameSite=Lax` still lets a sibling subdomain or another localhost port post with the cookie; `/rpc` ignores the cookie unless `Sec-Fetch-Site: same-origin` (or, without fetch metadata, a matching or absent `Origin`), and `/api/auth/sign-out` refuses cross-site requests.
- **Session refresh and identity binding:** WorkOS access tokens expire in minutes; `verifySealedSession` refreshes on `invalid_jwt` and the `/rpc` middleware re-sets the cookie. The sealed payload's `user.id` must equal the verified access token's `sub`.
- **Outages are not sign-outs:** a D1 or WorkOS failure while resolving a credential answers `SERVICE_UNAVAILABLE { reason: "database_unavailable" | "auth_unavailable" }`, never `UNAUTHORIZED`, so an extension does not discard a valid token during a blip.
- **No committed secrets:** `WORKOS_COOKIE_PASSWORD` has no default; dev without `.dev.vars` gets a random password per isolate. Production is guarded by `secrets.required` (but see the caveat on named environments below).
- **Extension CORS without cookies:** `/rpc/*` allows `chrome-extension://` and `moz-extension://` origins with `credentials: false` and `allowHeaders: ["Content-Type", "Authorization"]`.
- **Contract-typed refusal table:** `apps/api/src/modules/auth/refusal.test.ts` maps every leaf of `@detour/contracts` at compile time (`RefusalTable<typeof contract>`), so any new API procedure fails type-checking until its signed-out refusal policy is explicitly tested.

### Friction Points & Workarounds Discovered

1. **Drizzle `1.0.0-rc.5` `sqlite-proxy` omits D1 codecs by default:**
   - Unlike `drizzle-orm/d1` (which automatically passes `d1Codecs`), `drizzle-orm/sqlite-proxy` leaves `codecs` unset, causing `integer(..., { mode: "timestamp_ms" })` to return raw epoch numbers instead of `Date` objects.
   - **Fix:** Pass `{ codecs: d1Codecs }` (exported from `drizzle-orm/d1`) to `drizzle(executors, { codecs: d1Codecs })` in `packages/db/src/testing/sqlite.adapter.ts`.
2. **Duplicate column names in SQLite/D1 JOIN queries:**
   - D1 returns object-keyed rows where joining `extension_tokens` and `users` without aliasing `id` can overwrite `extension_tokens.id` with `users.id`.
   - **Fix:** Use `stmt.setReturnArrays(true)` in `packages/db/src/testing/sqlite.adapter.ts` for array mode **and** explicitly alias joined columns (`extensionTokens.id.as("token_id")`, `users.id.as("user_id")`) in `apps/api/src/auth/session.ts` for D1 safety.
3. **oRPC middleware typing + `repo/no-throw`:**
   - Standalone typed middlewares start from `orpcOs.$context<Context>().errors({ ... }).middleware(...)` (`import { os as orpcOs } from "@orpc/server"`) and route error throws through `orThrow` (`apps/api/src/orpc/result.adapter.ts`) so zero files outside `*.adapter.ts` throw.
4. **Zero-DB-hit session resolution for public endpoints:**
   - `resolveRequestSession` short-circuits to "signed out" when neither `Authorization: Bearer dtr_...` nor `wos-session` is present. A cookie is verified against WorkOS's JWKS with zero DB queries; `worker.ts` keeps one WorkOS client per isolate so the SDK's JWKS cache survives between requests (a client per request would fetch the keys on every signed-in call).

### Wrangler (local dev, migrations, deploy)

`apps/api/wrangler.jsonc` declares `main: src/worker.ts`, `compatibility_date: 2026-11-20`, `nodejs_compat`, `observability`, `dev.port: 3001` and the `DB` D1 binding. Scripts (`apps/api/package.json`; the deploy script is `ship` because `pnpm deploy` is a pnpm built-in that would shadow a `deploy` script):

| Script              | Runs                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| `dev`               | `wrangler d1 migrations apply DB --local && wrangler dev` (root `pnpm dev`) |
| `build`             | `wrangler deploy --dry-run --outdir dist` (bundle check, no upload)         |
| `ship`              | `wrangler d1 migrations apply DB --remote && wrangler deploy`               |
| `db:migrate:local`  | `wrangler d1 migrations apply DB --local`                                   |
| `db:migrate:remote` | `wrangler d1 migrations apply DB --remote`                                  |

Findings:

- **Drizzle's folder layout works natively.** drizzle-kit 1.0 writes `migrations/<timestamp>_<name>/migration.sql`; Wrangler ≥ 4.x reads it through `migrations_pattern: "../../packages/db/migrations/*/migration.sql"` (with `migrations_dir` pointing at the same folder) and records `20261127195142_users_and_pairing/migration.sql` in `d1_migrations`. No copy step, no second migrations folder. Without the pattern Wrangler finds nothing and prints a hint pointing at exactly this setting.
- **Local secrets live in `apps/api/.dev.vars`** (Wrangler's convention; git-ignored, `.dev.vars.example` committed). `wrangler dev --env-file ../../.env` (to keep one root `.env`) does not work: Wrangler's bin re-spawns Node with its own argv, Node 26 parses `--env-file` there itself and exits with `../../.env: not found` when the file is missing. The root `.env` now only feeds `apps/web` and e2e. `pnpm dev` boots with no file at all: placeholder WorkOS ids, and a random cookie password per isolate (never a committed one).
- **`src/env.ts` parses Worker bindings, not `process.env`**: `worker.ts` passes `env` to `loadEnv` per request and answers 500 with the Zod issues logged when a secret is missing or malformed.
- **e2e runs on Wrangler too**: `e2e/src/stack.adapter.ts` migrates a throwaway `--persist-to` D1, then starts `wrangler dev --port 3461 --env-file <empty file>` (the empty file stops it reading a developer's `.dev.vars`). No `workerd` processes are left behind.
- **Knip's Wrangler plugin** picks up `main` from `wrangler.jsonc`, so `apps/api` needs no `entry` in `knip.config.ts`.
- **pnpm 12 blocks install scripts by default**; `workerd` and `esbuild` are allowed in `pnpm-workspace.yaml#allowBuilds`.
- **Tests stay on `node:sqlite`** (not `@cloudflare/vitest-pool-workers`): the Workers Vitest integration pins its own Vitest major and would fight Vite+ 1.5 / Vitest 5.1. The gap is covered by `e2e/tests/pairing.spec.ts` (pairing start + poll on D1 under workerd) and a manual D1 check of token redemption (below); constraint-error mapping on real D1 text is only covered by unit tests over D1-shaped messages.
- **`wrangler types` generates `Bindings`** (`--env-interface Bindings`, so it does not collide with `src/env.ts`'s parsed `Env`) plus the workerd runtime types for `2026-11-20` + `nodejs_compat` into `apps/api/worker-configuration.d.ts` (16.5k lines, git-ignored, regenerated by `check:static` and `dev` like `.wxt` in the extension; ~1.7 s). The WorkOS settings are declared in `secrets.required`, so they appear on `Bindings`, `wrangler dev` warns when they are missing, and `wrangler deploy` refuses to deploy without them. The runtime types coexist with `@types/node` in one tsconfig: the only conflict was the global `URL` (Workers) vs `node:url`'s in the test SQLite driver, fixed by using `import.meta.dirname`. With `secrets` declared, `wrangler dev` also reads those names from the shell environment, so e2e strips `WORKOS_*` from its child environment.
- **`secrets.required` is not inherited by named environments** (Wrangler's schema says so): repeat it in every `env.<name>` when one is added, or its deploy guard silently disappears.
- **`database_id` is omitted** until a real D1 exists (`wrangler d1 create detour`, then add the id; Wrangler can also auto-provision on first deploy).

## Part 2: OpenRouter PKCE OAuth Flow (1-Click BYOK)

### Verified Current OpenRouter PKCE Specification (Live Checked 2026-11-26)

Verified directly against OpenRouter's published documentation (`https://openrouter.ai/docs/use-cases/oauth-pkce.md`) and live HTTP probes against `https://openrouter.ai/auth` and `https://openrouter.ai/api/v1/auth/keys`:

- **Authorization URL:** `https://openrouter.ai/auth?code_challenge=<BASE64URL_SHA256>&code_challenge_method=S256`
  - **PKCE is mandatory** (`code_challenge` + `code_challenge_method=S256`).
  - **Optional params:** `callback_url`, `state`, `key_label`, `limit` (USD cap), `expiration` (`1-hour` .. `1-year` | `never`), `workspace_id`, `required_workspace_id`.
- **Supported callback modes:** `https://...`, `http://localhost:<port>/...` (any port), or **headless mode** (omit `callback_url` → 10-minute one-time code displayed on screen).
- **Code Exchange Endpoint:** `POST https://openrouter.ai/api/v1/auth/keys` with `{ code, code_verifier, code_challenge_method: "S256" }` → `{ key: "sk-or-v1-...", user_id? }`.
  - **Live probe:** Returns `access-control-allow-origin: *` for `Origin: chrome-extension://...`, and returns `HTTP 400 {"error":{"message":"Invalid code","code":400}}` in addition to documented `403` error codes.
- **Key management deep links:** `https://openrouter.ai/logs?api_key_hash=<sha256Hex>` and `https://openrouter.ai/keys/<sha256Hex>`.

### Callback Strategy Trade-Offs (Chrome & Firefox MV3)

| Strategy                                                               | Chrome + Firefox Parity                           | Privacy vs `BRIEF.md` ("BYOK: zero Detour server requests")                                                           | Security & Permissions Trade-Offs                                                                                                       | Recommendation                         |
| ---------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Headless PKCE (omit `callback_url`)**                                | Identical on Chrome & Firefox                     | **Strictly zero requests** to Detour servers                                                                          | No `web_accessible_resources`, no `identity` permission, no host permission on `detour.app`.                                            | **Recommended primary BYOK PKCE flow** |
| **Manual API key paste (`sk-or-v1-...`)**                              | Identical on Chrome & Firefox                     | **Strictly zero requests** to Detour servers                                                                          | Works with pre-existing budgeted keys or offline key managers.                                                                          | **Recommended fallback**               |
| **Static `apps/web` relay (`https://detour.app/openrouter/callback`)** | Identical with `host_permissions` on `detour.app` | **1 GET request** hits `detour.app` during setup (PKCE ensures Detour cannot exchange `code` without `code_verifier`) | Requires `host_permissions` on `detour.app` to read `changeInfo.url` without broad `"tabs"`.                                            | **Optional future enhancement**        |
| **Direct `chrome-extension://` / `moz-extension://` callback**         | Broken / inconsistent                             | Zero Detour requests                                                                                                  | Undocumented by OpenRouter; blocked by Chrome without `web_accessible_resources` and by Firefox top-level web→extension redirect rules. | **No-Go**                              |
| **`browser.identity.launchWebAuthFlow`**                               | Divergent (`chromiumapp.org` vs `allizom.org`)    | Zero Detour requests                                                                                                  | Requires `"identity"` permission; Firefox container/popup quirks.                                                                       | **No-Go**                              |

### Live Manual Verification Steps (With an OpenRouter Account)

1. Build and load the unpacked extension (`vp -C apps/extension run build` in Chrome, `build:firefox` in Firefox).
2. Open `connect.html` (`chrome-extension://<id>/connect.html` or `moz-extension://<uuid>/connect.html`).
3. Click **Connect OpenRouter (headless PKCE)** → verify OpenRouter opens with `code_challenge_method=S256` and prefilled label `Detour`.
4. Authorize on OpenRouter, copy the displayed one-time code, paste it into `connect.html`, and click **Finish OpenRouter setup**.
5. Confirm `POST https://openrouter.ai/api/v1/auth/keys` returns `200` with a `sk-or-v1-...` key and revoke the test key via the generated `openrouter.ai/keys/<sha256>` link.

## Review Round (pre-PR)

Three independent read-only reviews (GPT-6.1 Sol, Gemini 4 Neon, Fable 5.2, all at high effort) ran on the uncommitted branch. Every finding below was checked against the code before fixing.

| Finding (reviewers)                                                                  | Fix                                                                                                  |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Callback never verified `state`: login CSRF (all three)                              | Random `state` + PKCE verifier in an HttpOnly flow cookie, checked before the code exchange          |
| `returnTo` bypass via `/\host` and `/<TAB>/host` (all three)                         | Resolve like a browser, keep only same-origin paths                                                  |
| Web sessions never refreshed: signed out after the access-token lifetime (all three) | Refresh on `invalid_jwt`, re-set the cookie from the `/rpc` middleware                               |
| Consume-then-insert could burn an approval on a D1 failure (GPT, Fable)              | Single `INSERT ... SELECT` redemption + unique `pairing_session_id` (migration `token_pairing_link`) |
| D1/WorkOS outages answered `UNAUTHORIZED` (all three)                                | `Result` from session resolution; `SERVICE_UNAVAILABLE { database_unavailable \| auth_unavailable }` |
| New WorkOS client per request discarded the JWKS cache (all three)                   | One provider per isolate and config in `worker.ts`                                                   |
| Test driver `batch` not transactional; lenient binding (all three)                   | `BEGIN`/`COMMIT`/`ROLLBACK`; D1-style `D1_TYPE_ERROR` for unsupported params; async executors        |
| `users.email` unique index locked out users WorkOS recreated (Gemini, Fable)         | Index dropped (WorkOS owns email uniqueness)                                                         |
| No CSRF defence beyond `SameSite=Lax` (Gemini, Fable)                                | Cookie honoured only on same-origin requests; cross-site sign-out refused                            |
| Committed default cookie password + unbound sealed user (Fable)                      | No default (random per isolate in dev); sealed `user.id` must equal the token's `sub`                |
| Malformed cookie (`%ZZ`) crashed every `/rpc` call (Gemini, Fable)                   | Hono's tolerant cookie parser                                                                        |
| `pnpm -C apps/api deploy` runs pnpm's built-in (Fable)                               | Script renamed `ship`                                                                                |
| D1 "unavailable" regex matched `reset`/`internal` anywhere (Fable)                   | Only Cloudflare's documented transient messages                                                      |
| Approve/consume lacked an expiry guard; expired tokens listed as devices (Gemini)    | `expires_at > now` in both conditional updates and in `listDevices`                                  |
| Extension opened any origin the API returned as `verificationPath` (Gemini)          | Path must start with `/`, no backslash, and resolve on `webOrigin`                                   |
| Headless PKCE paste of a callback URL always failed `state_mismatch` (Fable)         | `state` exists only with a `callbackUrl`                                                             |
| Logout `returnTo` was relative (Gemini, Fable)                                       | Absolute web-app root derived from `WORKOS_REDIRECT_URI`                                             |
| `/pair?code=<digits>` failed route validation (Gemini)                               | `z.coerce.string().optional().catch(undefined)`                                                      |
| `lastUsedAt` written on every bearer request (Fable)                                 | At most once an hour per token, best effort                                                          |
| One-click approval phishing (Fable)                                                  | Warning on the approval card to approve only a code shown in your own extension; see open items      |

Open items for v1 (not fixed in the spike):

- **Approval phishing by design:** anyone can call `pairing.start` with a misleading `deviceName` and send a signed-in user the `/pair` link. Stronger: after approval, show a short code that the user types back into the extension. Also rate-limit `pairing.start` and delete expired `pairing_sessions` (a cron trigger).
- **The extension hand-rolls the oRPC wire format** (`apps/extension/src/lib/pairing.adapter.ts`) instead of a client typed from `@detour/contracts`, so contract drift is not caught at compile time.
- **A lost poll response still burns the pairing** (the token was minted but never received); the user restarts pairing. Acceptable for v1.

## Verification Commands & Observed Results

After the review round (2026-11-28):

| Command                                                            | Result | Notes                                                                                                                                                                  |
| ------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drizzle-kit generate` (`users_and_pairing`, `token_pairing_link`) | Pass   | Second migration: `pairing_session_id` + unique index, `users_email_unique` dropped                                                                                    |
| `vp -C packages/db test`                                           | Pass   | 9/9 on `node:sqlite` + `d1Codecs`, D1-strict binding, transactional `batch`                                                                                            |
| `vp -C apps/api test`                                              | Pass   | 38/38: state + PKCE sign-in, login CSRF and open-redirect cases, refresh, outages → `SERVICE_UNAVAILABLE`, cross-site cookie, pairing                                  |
| `vp -C apps/web test`                                              | Pass   | 22/22                                                                                                                                                                  |
| `vp -C apps/extension test`                                        | Pass   | 23/23 (RFC 7636 S256 vector, PKCE adapter, pairing adapter, verification-URL origin check)                                                                             |
| `vp -C apps/extension run build` & `build:firefox`                 | Pass   | `chrome-mv3` and `firefox-mv3`, including `connect.html`                                                                                                               |
| `wrangler deploy --dry-run --outdir dist`                          | Pass   | 1214.70 KiB / 234.69 KiB gzip; only `node:crypto` imported from Node                                                                                                   |
| `pnpm e2e` (Wrangler + local D1)                                   | Pass   | 2/2: health, and pairing start + poll on D1 with a signed-out `/pair` visit                                                                                            |
| Manual D1 redemption (`wrangler dev` + `d1 execute`)               | Pass   | Approved row → first poll mints a token (`INSERT ... SELECT ... RETURNING`, JSON `scopes`, integer timestamps), second poll `NOT_FOUND`, token authenticates `auth.me` |
| `pnpm check`                                                       | Pass   | `check:static` (incl. `wrangler types`), all tests incl. canary, `knip` + `knip --production`, `duplicates` (0 clones)                                                 |

## Recommendation

Proceed to **v1 implementation** on **Cloudflare Workers + D1 + WorkOS AuthKit**:

- Deploy with `pnpm -C apps/api ship` (remote D1 migrations, then `wrangler deploy`) after `wrangler d1 create detour` fills in `database_id`; add `apps/web` static assets to the same Worker (`assets` in `wrangler.jsonc`) when the web app ships.
- Persist the extension's `dtr_...` bearer token and BYOK OpenRouter key in extension-origin IndexedDB, owned by the background (ADR 0002, Decision item 3; not `storage.local`, which Firefox exposes to content scripts), and build `credit_ledger` + `/decide` on top of the D1 schema using atomic conditional updates + `UNIQUE (idempotency_key)`.
