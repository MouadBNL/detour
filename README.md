# Detour

A Chrome and Firefox MV3 browser extension that intercepts visits to distracting websites, asks for
a reason, and responds with a **grant**, **hold**, or **deny**—turning mindless habits into
conscious choices and local-first self-reflection.

See [BRIEF.md](./BRIEF.md) for the full product and technical brief.

## Workspace

- `apps/extension` — Chrome + Firefox MV3 extension (WXT, React 19, Tailwind v4)
- `apps/api` — Hono + oRPC + Drizzle backend on Cloudflare Workers + D1 (Wrangler: `dev`, migrations, `deploy`)
- `apps/web` — React 19 + TanStack Router web app
- `packages/ui` — shared Tailwind v4 design tokens and Base UI primitives
- `packages/contracts` — shared Zod + oRPC API contracts
- `packages/db` — Drizzle schema, migrations, and the D1 client (`node:sqlite` for tests)
- `packages/result` — `Result` type utilities

## Quick start

Requires [Vite+](https://viteplus.dev) (`vp`), which manages the pinned Node and pnpm versions.

```sh
vp install                                 # install dependencies and pre-commit hook
pnpm check                                 # format, lint, types, tests, canary, Knip, duplicates
pnpm dev                                   # run API, web, and extension dev builds in parallel
```

### Building the extension

```sh
vp -C apps/extension run build             # Chrome MV3 -> apps/extension/.output/chrome-mv3
vp -C apps/extension run build:firefox     # Firefox MV3 -> apps/extension/.output/firefox-mv3
vp -C apps/extension run zip               # Chrome zip
vp -C apps/extension run zip:firefox       # Firefox zip + sources
```

During `pnpm dev` (or `vp -C apps/extension run dev` / `dev:firefox`), load
`apps/extension/.output/chrome-mv3-dev` or `apps/extension/.output/firefox-mv3-dev` as an unpacked
extension in your browser.

## Docs

- [BRIEF.md](./BRIEF.md) — product vision, UX mechanics, and v1 scope
- [AGENTS.md](./AGENTS.md) — concise agent guardrails and workflow invariants
- [docs/adr/](./docs/adr) — architecture decision records
- [docs/](./docs) — conventions, recipes, error handling, backend, React, and testing guides
