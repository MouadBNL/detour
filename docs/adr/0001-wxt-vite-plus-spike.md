# ADR 0001: WXT + Vite+ Monorepo Compatibility Spike (Spike 1)

- **Status:** Accepted (Go with WXT under the existing Vite+ / Rolldown toolchain)
- **Date:** 2026-11-26
- **Context:** Pre-build Spike 1 from `BRIEF.md`

## Decision

Adopt **WXT (`wxt@^0.21.5`)** in `apps/extension` directly on top of the `project-template` Vite+ toolchain (`@voidzero-dev/vite-plus-core@1.5.1`, Vite 8.3.7 / Rolldown, Vitest 5.1.0, TypeScript 7.0.2, oxlint/oxfmt, Knip 6.44.2, jscpd 5.4.2) **without** scoping out or relaxing the global `overrides: { "vite@*": "catalog:" }` rule.

Plan B (scoping the `vite@*` override or building a custom multi-entry Vite+ extension bundler) is **not needed**.

## Exact Versions Tested

| Tool / Package                      | Resolved Version                     | Notes                                                        |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| Node.js                             | `26.13.0`                            | Managed by Vite+ (`.node-version`)                           |
| pnpm                                | `12.18.0`                            | Managed by Vite+ (`packageManager`)                          |
| `vite-plus` (`vp`)                  | `1.5.1`                              | Global CLI + local catalog                                   |
| `vite` (via catalog override)       | `@voidzero-dev/vite-plus-core@1.5.1` | Reports `Vite 8.3.7` / Rolldown to WXT                       |
| `vitest` (via `vite-plus/test`)     | `5.1.0`                              | Driven via `vp test`                                         |
| `wxt`                               | `0.21.5`                             | Peer range includes `vite: ^8.0.0-0` and `typescript: >=5.4` |
| `typescript`                        | `7.0.2`                              | Workspace strict `tsconfig.base.json`                        |
| `react` / `react-dom`               | `19.3.1`                             | Shared with `apps/web` and `packages/ui`                     |
| `@vitejs/plugin-react`              | `6.3.0`                              | Configured directly in `wxt.config.ts`                       |
| `@rolldown/plugin-babel`            | `0.3.1`                              | With `babel-plugin-react-compiler@^1.0.0`                    |
| `tailwindcss` / `@tailwindcss/vite` | `4.3.5`                              | Consumes `@detour/ui/styles.css` tokens                      |
| `knip`                              | `6.44.2`                             | Includes built-in WXT config detection                       |
| `jscpd`                             | `5.4.2`                              | Duplicate check across workspace                             |

## What Was Built & Tested

1. **Baseline bootstrap:** Copied `~/Projects/project-template`, ran `vp install`, renamed scope via `node tools/rename-scope/src/main.ts detour` (65 files), ran `vp install`, and confirmed baseline `pnpm check` passed.
2. **Minimal WXT extension (`apps/extension`, `@detour/extension`):**
   - `wxt.config.ts`: `srcDir: "src"`, `imports: false` (explicit imports only), `manifestVersion: 3`, Chrome + Firefox MV3 manifest (including Firefox `browser_specific_settings.gecko.data_collection_permissions`), and React 19 + React Compiler + Tailwind v4 Vite plugins (no `@wxt-dev/module-react` needed).
   - `src/entrypoints/background.ts`: MV3 background entrypoint (`defineBackground`) reading state through `src/lib/storage.adapter.ts` (`@detour/result`).
   - `src/entrypoints/popup/`: React 19 + Tailwind v4 popup using `@detour/ui` (`Button`), `lucide-react`, and `storage.adapter.ts`.
   - `src/entrypoints/blocked/`: Unlisted `blocked.html` extension page using React 19 + Tailwind v4 + `@detour/ui` (`Button`, `RadioGroup`, `RadioCard`) + `src/lib/blocked-target.ts` (`@detour/result`).
   - `vite.config.ts`: Vitest config using `WxtVitest({ root: import.meta.dirname })` with split `unit` (Node) and `dom` (`happy-dom`) projects.
   - Tests: `blocked-target.test.ts`, `storage.adapter.test.ts` (with `fakeBrowser`), `popup-app.test.tsx` (with `fakeBrowser` + Testing Library), and `blocked-page.test.tsx`.
3. **Guardrail & Knip integration (no rules weakened):**
   - `vite.config.ts`: added `apps/extension` to `REACT_CODE`, `WEB_SIZE`, `react/only-export-components`, and `repo/boundaries` (forbidding imports from `apps/api/**` and `packages/db/**`); added `**/wxt.config.ts` and `apps/extension/src/entrypoints/*.ts` to `DEFAULT_EXPORT_ALLOWED`; added `**/wxt.config.ts` to `repo/no-process-env` exemptions; ignored `**/.wxt/**` and `**/.output/**` in `fmt` and `lint`.
   - `tools/canary`: added canary cases for `apps/extension` boundary enforcement (`apps/api`, `packages/db`) and default-export allowance on `apps/extension/src/entrypoints/*.ts` (48 conventions, 172 samples, all firing).
   - `knip.config.ts`: added `apps/extension` workspace with production entrypoints `src/entrypoints/*.ts!` and `src/entrypoints/*/main.{ts,tsx}!`.
   - `.gitignore`, `.jscpd.json`, `tools/workspace-check/src/catalog.test.ts`: excluded `.wxt` and `.output`.

## Commands & Observed Results

| Command                                                                | Result | Key Timing / Output                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vp install` (with `wxt: ^0.21.5` in catalog)                          | Pass   | 3.8 s, zero peer-dep or override conflicts                                                                                                                                           |
| `vp -C apps/extension exec wxt prepare`                                | Pass   | 221 ms, generated `.wxt/wxt.d.ts` and `.wxt/tsconfig.json`                                                                                                                           |
| `vp -C apps/extension run build`                                       | Pass   | 560 ms (`chrome-mv3`, Vite 8.3.7), emits `manifest.json` (MV3 service worker), `blocked.html`, `popup.html`, `background.js`, Tailwind CSS + Inter fonts                             |
| `vp -C apps/extension run build:firefox`                               | Pass   | 581 ms (`firefox-mv3`, Vite 8.3.7), emits `manifest.json` (MV3 event page `background.scripts` + `gecko.data_collection_permissions`), `blocked.html`, `popup.html`, `background.js` |
| `vp -C apps/extension run zip`                                         | Pass   | 699 ms, emits `.output/detourextension-0.0.0-chrome.zip` (327 kB)                                                                                                                    |
| `vp -C apps/extension run zip:firefox`                                 | Pass   | 734 ms, emits `.output/detourextension-0.0.0-firefox.zip` (327 kB) + sources zip                                                                                                     |
| `wxt dev` smoke check (Chrome + Firefox, `webExt: { disabled: true }`) | Pass   | Chrome built in 366 ms (port 3173), Firefox built in 124 ms (port 3174); both served `src/entrypoints/blocked/main.tsx` with HTTP 200 and emitted valid MV3 dev manifests            |
| `vp -C apps/extension test --no-cache --no-fsModuleCache`              | Pass   | 793 ms, 4 test files / 7 tests (both `unit` and `dom` projects with `WxtVitest` + `fakeBrowser`)                                                                                     |
| `vp run --filter @detour/extension check:static` (2nd run)             | Pass   | 2/2 cache hits (100%), 1.32 s saved                                                                                                                                                  |
| `pnpm check` (full monorepo)                                           | Pass   | `check:static` (15/15), `test` (11/11 incl. canary & workspace-check), `knip` + `knip --production` (0 warnings), `duplicates` (0 clones)                                            |

## Friction Points & Workarounds Discovered

1. **Firefox defaults to MV2 in WXT unless configured:**
   - Running `wxt build -b firefox` without configuration produced `.output/firefox-mv2` (`manifest_version: 2`, `browser_action`).
   - **Fix:** Set `manifestVersion: 3` in `apps/extension/wxt.config.ts`. Both `wxt build` and `wxt build -b firefox` then target MV3 (`chrome-mv3` with `background.service_worker`, `firefox-mv3` with `background.scripts` and `action`).
2. **`WxtVitest()` cwd sensitivity under Knip:**
   - Calling `await WxtVitest()` with no arguments in `apps/extension/vite.config.ts` caused WXT to resolve `./entrypoints` relative to the repo root when Knip loaded the config via `jiti`, printing `WARN Entrypoints directory not found: ./entrypoints`.
   - **Fix:** Pass `await WxtVitest({ root: import.meta.dirname })`. Knip then runs completely cleanly with zero warnings.
3. **Knip 6.44 built-in WXT plugin vs explicit entries:**
   - Knip already recognizes `wxt.config.ts` automatically; listing `"wxt.config.ts"` in `knip.config.ts` emitted a redundant entry hint.
   - **Fix:** List only the WXT production entrypoints (`src/entrypoints/*.ts!`, `src/entrypoints/*/main.{ts,tsx}!`) in `knip.config.ts` so both `knip` and `knip --production` trace the full extension graph cleanly.
4. **Vite+ task caching on `wxt prepare && vp check`:**
   - Because `wxt prepare` reads and rewrites `apps/extension/.wxt/tsconfig.json`, Vite+ initially skipped caching `@detour/extension#check:static` (`not cached because it modified its inputs`).
   - **Fix:** Define `check:static` under `run.tasks` in `apps/extension/vite.config.ts` with `cache: { input: [{ auto: true }, "!.wxt/**"], output: [{ auto: true }, "!.wxt/**"] }`. Repeat runs achieve 100% cache hit rate.
5. **Disable WXT auto-imports (`imports: false`):**
   - Keeping `imports: false` in `wxt.config.ts` ensures explicit imports (`wxt/utils/define-background`, `wxt/browser`, React hooks), keeping TypeScript 7 strict mode, oxlint, and Knip deterministic with zero magic globals.
6. **AMO reproducible source zip for monorepo (follow-up for release):**
   - By default, `wxt zip -b firefox` creates `*-sources.zip` containing only `apps/extension/`, omitting workspace root files (`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `packages/ui`, `packages/result`).
   - **Action when preparing AMO submission:** Configure WXT's `zip.sourcesRoot` (or a dedicated release packaging script) so Mozilla reviewers receive the full reproducible monorepo slice and build instructions.
7. **`web-ext` browser auto-launch in `wxt dev`:**
   - `web-ext` is an optional peer dependency of WXT. Without it installed, `wxt` falls back to `ManualRunner` (`Load ".output/chrome-mv3-dev" as an unpacked extension manually`), so root `pnpm dev` (`vp run --no-cache -r --parallel dev`) will not unexpectedly launch browser windows. Developers who want automatic browser launching can add `web-ext` or run with a local `web-ext.config.ts`.
8. **Avoiding `@wxt-dev/module-react`:**
   - Wiring `@vitejs/plugin-react` + `@rolldown/plugin-babel` (`reactCompilerPreset()`) + `@tailwindcss/vite` directly inside `wxt.config.ts#vite` matches `apps/web/vite.config.ts` identically, gives us React Compiler in the extension, and avoids an extra WXT module dependency.

## Recommendation

Proceed to **Spike 2 (Cross-Browser MV3 DNR / Storage / Scripting)** on top of this WXT + Vite+ setup. Keep `apps/extension` on `wxt@^0.21.5`, `imports: false`, `manifestVersion: 3`, and explicit `WxtVitest({ root: import.meta.dirname })`.
