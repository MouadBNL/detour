# AGENTS.md

**Detour** is a Chrome and Firefox MV3 browser extension, Hono/oRPC API, and React web app. Product
requirements live in `BRIEF.md`; architecture decisions live in `docs/adr/`.

Conventions are enforced by tools (`vite.config.ts`, `knip.config.ts`, `tools/oxlint-plugin`,
`tools/canary`). When a check fails, read the error message—it tells you the fix.

## Required before finishing

- Run `pnpm check` (format, lint, types, boundaries, tests, canary, Knip, duplicates).
- When changing extension config or entrypoints, also verify `vp -C apps/extension run build` and
  `vp -C apps/extension run build:firefox`.
- Never weaken a rule, add a disable comment, or bypass `.vite-hooks/pre-commit`.

## Architectural invariants (avoid writing code that fails lint)

- **Errors are values.** Return `Result` from `@detour/result` with tagged error objects. `throw`,
  `try`/`catch`, and `.catch()` are only allowed in `*.adapter.ts` files.
- **Effects & React.** `useEffect*` hooks live only in `*.effect.ts(x)` files. No manual
  memoization (`useMemo`/`useCallback`/`memo`; React Compiler handles it). Style components only
  with `@detour/ui` design tokens—no Tailwind palette colors or raw lengths.
- **Contracts & boundaries.** New API procedures and expected errors start in `packages/contracts`.
  `apps/web` and `apps/extension` never import `apps/api` or `packages/db`. Import other API
  modules or web features only through their `index.ts`.
- **Dependencies.** Declare versions once in `pnpm-workspace.yaml#catalog`; `package.json` files
  use only `"catalog:"` or `"workspace:*"`, followed by `vp install`.
- **Extension (`apps/extension`).** Uses WXT with `imports: false` and `manifestVersion: 3`. Keep
  imports explicit and wrap `browser.*` calls in `*.adapter.ts`.
- **Internal packages.** Export TypeScript source directly; use explicit `.ts`/`.tsx` extensions on
  relative imports. Do not hand-edit generated files (`routeTree.gen.ts`, `.wxt/`, `migrations/`).

## Reference docs (read on demand)

- `BRIEF.md` — product spec, UX rules, and architecture overview
- `docs/adr/` — architecture decision records
- `docs/conventions.md` — full rule-to-tool mapping (start here if a guardrail is unclear)
- `docs/architecture.md`, `docs/errors.md`, `docs/backend.md`, `docs/react.md`, `docs/testing.md` —
  step-by-step recipes for tables, modules, features, errors, UI primitives, and tests
