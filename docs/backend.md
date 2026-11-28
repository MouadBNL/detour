# Backend

How the API (`apps/api`) and the database (`packages/db`) fit together, and how to add to them.
Read `docs/errors.md` (errors as values) first. The first part describes what is in the template;
the sections marked **not in the template** describe patterns to add when the product needs them.
The step-by-step recipes (an API module, a table) are in `docs/architecture.md`.

## Request path

```
browser ─ /rpc/* ─> Worker (worker.ts) ─> Hono (app.ts) ─> oRPC handler ─> router ─> service ─> repo ─> @detour/db (Drizzle on D1)
```

The API is a Cloudflare Worker and Wrangler is its only runtime: `wrangler dev` (workerd and a
local D1) in development, `wrangler deploy` in production, configured in `apps/api/wrangler.jsonc`.
There is no Node server.

| File                                  | Role                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/api/wrangler.jsonc`             | The Worker: `main`, compatibility date/flags, the `DB` D1 binding, dev port    |
| `apps/api/src/worker.ts`              | Worker entry: parses the bindings, builds `Deps` (D1, WorkOS), runs the app    |
| `apps/api/src/env.ts`                 | The only reader of configuration: a Zod schema, `loadEnv(bindings)` → `Result` |
| `apps/api/src/app.ts`                 | `createApp(deps)`: oRPC on `/rpc` (`RPC_PREFIX`); the one place defects log    |
| `apps/api/src/context.ts`             | `Deps` (long-lived: `db`, `now`, `lifecycle`) and the per-request `Context`    |
| `apps/api/src/router.ts`              | The root router, one key per module, checked against the contract              |
| `apps/api/src/orpc/implementer.ts`    | `os`: the contract implemented with our `Context`                              |
| `apps/api/src/orpc/procedures.ts`     | `respond`: a service's `Result` to the output or a declared error              |
| `apps/api/src/orpc/result.adapter.ts` | `orThrow`: the one place that throws oRPC's declared errors                    |
| `apps/api/src/errors.ts`              | The errors every service shares: `Unavailable`, `unavailable(reason)`          |
| `packages/db/src/d1.ts`               | `createD1Db(env.DB)`: Drizzle over the D1 binding; `Db`, the type repos take   |
| `packages/db/src/query.adapter.ts`    | `tryQuery`: constraint violations and an unreachable database as `Result`      |
| `apps/api/src/testing/test-app.ts`    | `createTestApp()`: the whole API on a fresh database, for tests                |

## An API module

One folder per feature in `apps/api/src/modules/<name>/`; other code imports only its `index.ts`
(`repo/boundaries`). `modules/system` is the worked example; the recipe is
`docs/architecture.md`, "Recipe: an API module".

| File                               | Contains                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `packages/contracts/src/<name>.ts` | The procedures' input, output and errors. Written first.                    |
| `<name>.router.ts`                 | Handlers: call the service, `respond` with its result. One-liners.          |
| `<name>.service.ts`                | Business rules. Takes the context (or a `Pick` of it). Returns `Result`.    |
| `<name>.repo.ts`                   | Queries only. Takes `db` first. Returns `Result` (or `undefined` for none). |
| `<name>.test.ts`                   | Procedure tests through `createTestApp()`.                                  |
| `index.ts`                         | Exports the router (and what other modules may use).                        |

`modules/system` is small: its service is `health.ts` and its repo, `system.repo.ts`, pings the
database through `tryQuery`. Name files by role (`<name>.service.ts`) in a new module.

### Contract

Procedures are built with `oc` from `@orpc/contract`, in `packages/contracts/src/<name>.ts`, and
added to `contract` in `packages/contracts/src/index.ts`:

```ts
const health = oc.output(HealthStatus).errors({ SERVICE_UNAVAILABLE });
export const system = { health };
```

The contract package is pure (only `zod` and `@orpc/contract`, `repo/boundaries`): schemas
validate shape, never state. oRPC validates the input against the contract before the handler
runs, so a schema that looked something up would answer before any check the service makes; keep
validation pure and put every check that reads state in the service. Bounds (a title's length)
live in the input schema, and the web validates with the same schema (`docs/react.md`, "Forms").

### Router and `respond`

```ts
// apps/api/src/modules/system/system.router.ts
const health = os.system.health.handler(async ({ context, errors }) =>
  respond(await checkHealth(context), errors),
);
export const systemRouter = { health };
```

`respond(result, errors, own?)` (`orpc/procedures.ts`) returns the value, or throws the declared
error for the service's error. The errors every service shares (`SharedError` in
`apps/api/src/errors.ts`) are mapped by `respond` for every procedure; `own` maps only the
module's own errors, and the type checker demands it exactly when the service can return one (and
gives it only those). Give service functions an explicit `Promise<Result<T, A | B>>` return type:
inferred from several `return`s, `respond` sees only part of the error union. `docs/errors.md`
has the whole path and the recipes for a contract error and a shared error.

### Context

`Deps` (`apps/api/src/context.ts`) are the long-lived dependencies: `worker.ts` builds the real
ones (per request: a Worker has bindings, not a process environment), tests build their own through `createTestApp({...})`. `Context` is what each handler
receives (today `Context = Deps`; a per-request part such as a session is added as
`Deps & { ... }`). Services take the context, or a `Pick` of the fields they use
(`Pick<Context, "db" | "now">`), so tests can call them with less.

- **Time comes from the context** (`now()`), never from `new Date()` in a service or repo, so a
  test pins it (`createTestApp({ now: () => fixed })`). Writes take `now` and set `createdAt` /
  `updatedAt` from it; do not rely on database defaults or `$onUpdate` for timestamps.
- **Lifecycle** tells the health check the server is draining, and health then answers
  `SERVICE_UNAVAILABLE { reason: "shutting_down" }`. A Worker isolate never drains mid-request,
  so `worker.ts` passes `() => false`; tests still cover the branch.
- A new dependency (a mailer, a client for another service, a queue) is a field of `Deps` with a
  small interface of our own, built in `worker.ts`; `createTestApp` gives it a default, and tests
  pass a fake that implements it.

### Environment

Configuration arrives as Worker bindings: the secrets listed in `secrets.required` of
`wrangler.jsonc` (`wrangler secret put <NAME>` in `apps/api`; `wrangler deploy` refuses to ship
without them), and locally `apps/api/.dev.vars` (git-ignored; copy `.dev.vars.example`) or the
shell environment. `wrangler types` generates their TypeScript type, the global `Bindings`
interface, together with the workerd runtime types for the compatibility date and flags, into
`apps/api/worker-configuration.d.ts` (git-ignored; `check:static` and `pnpm dev` regenerate it,
`pnpm -C apps/api types` by hand after editing `wrangler.jsonc`). `apps/api/src/env.ts` is the only file that interprets them
(`repo/no-process-env`): `worker.ts` passes the bindings to `loadEnv`, which parses them with a Zod
schema into `Result<Env, InvalidEnv>`; on an error the Worker logs which variables are wrong and
answers 500. Add a variable there, with a default when development can do without it, document it
in `secrets.required` and `.dev.vars.example` (or `vars` in `wrangler.jsonc` when it is not a
secret), and pass the parsed value to what needs it. The settings today: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`,
`WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI`, all with dev defaults. The dev port is `dev.port`
in `wrangler.jsonc` (3001; the web proxy reads `API_PORT` from the root `.env`, keep them equal).
The e2e suite has its own `e2e/src/env.ts`.

## Database

Production and `pnpm dev` run on Cloudflare D1 (SQLite). `createD1Db(env.DB)` (`@detour/db`)
wraps the binding in Drizzle; `Db` is the type repos take. Everything the package root exports
is free of Node built-ins, so it bundles for workerd; the `node:sqlite` driver that tests use
lives under `packages/db/src/testing/` and is reachable only from `@detour/db/testing`.

Migrations live in `packages/db/migrations/<timestamp>_<name>/migration.sql`, generated by
`pnpm -C packages/db generate` from `packages/db/src/schema/` (recipe: `docs/architecture.md`,
"Recipe: a table and its first migration"). Wrangler applies them (`migrations_pattern` in
`wrangler.jsonc` points it at drizzle-kit's folder layout) and records them in `d1_migrations`:

```sh
pnpm -C apps/api db:migrate:local     # the local D1 of `pnpm dev` (apps/api/.wrangler, git-ignored)
pnpm -C apps/api db:migrate:remote    # the production D1 (needs `wrangler login`)
```

`pnpm dev` applies pending local migrations before `wrangler dev` starts, and `pnpm -C apps/api
ship` applies remote ones before it deploys (the script is not called `deploy`: `pnpm deploy` is a
pnpm built-in and would shadow it). Tests apply the same files to `node:sqlite`. Read
each generated migration and commit it; never edit one that has run anywhere else. Delete
`apps/api/.wrangler` to start the local database over.

### Repos

A repo function takes `db` first and only queries; the service decides what the answer means.
`tryQuery` (`@detour/db`) sorts what a query can throw in three:

- a declared constraint rejected the write: `Err<ConstraintViolation>`, `{ type:
  "unique_violation" | "foreign_key_violation" | "check_violation" | "not_null_violation",
  constraint, table, detail }`;
- the database cannot be reached (connection refused or lost, server shutting down):
  `Err<DbUnavailable>`, `{ type: "db_unavailable", cause }`;
- anything else (SQL error, missing table, a bug): a defect, rethrown. Do not catch it; `app.ts`
  logs it and answers 500.

Put every query whose failure the caller should see through `tryQuery` (reads too: a read on a
database that is down should answer `SERVICE_UNAVAILABLE`, not 500). A repo maps the result to
errors of its own; this one uses `unexpected()`, which the first repo adds
(`docs/errors.md`, "Recipe: a shared error"):

```ts
import {
  notes,
  NOTES_TITLE_UNIQUE,
  tryQuery,
  type Db,
  type NoteRow,
  type QueryFailure,
} from "@detour/db";
import { err, ok, type Err, type Result } from "@detour/result";
import { unavailable, unexpected, type Unavailable, type Unexpected } from "../../errors.ts";

export type TitleTaken = { readonly type: "title_taken" };

/** What no caller here expects: the database is down, or a constraint nobody maps. */
const otherwise = (failure: QueryFailure): Err<Unavailable | Unexpected> =>
  failure.type === "db_unavailable"
    ? unavailable("database_unavailable")
    : unexpected(failure.constraint);

export async function insertNote(
  db: Db,
  row: { readonly title: string; readonly body: string },
  now: Date,
): Promise<Result<NoteRow, TitleTaken | Unavailable | Unexpected>> {
  const inserted = await tryQuery(() =>
    db
      .insert(notes)
      .values({ ...row, createdAt: now })
      .returning(),
  );
  if (!inserted.ok) {
    const failure = inserted.error;
    if (failure.type === "unique_violation" && failure.constraint === NOTES_TITLE_UNIQUE)
      return err({ type: "title_taken" });
    return otherwise(failure);
  }
  const [note] = inserted.value;
  return note === undefined ? unexpected("notes: insert returned no row") : ok(note);
}
```

(`notes` is an example; the template has no tables.)

- **Compare `constraint` with the constant the schema exports** (`NOTES_TITLE_UNIQUE`), never a
  string literal, and check `failure.type` first: `DbUnavailable` has no `constraint`.
- **Missing is `undefined`.** A row looked up by its key and not there, and an update or delete
  that matched no row, return `undefined` (or `ok(undefined)`); the service decides what that
  means (usually a `not_found` error).
- **Never show `detail` to users**: it is the database's own text and can contain other users'
  data.
- **Rows are schema-inferred**: export `typeof notes.$inferSelect` from the schema file.

### Atomic writes (not in the template)

D1 has no interactive transactions: Drizzle's `db.transaction(...)` fails on it. Several writes
that must succeed or fail together go in one `db.batch([...])`, which D1 runs as a single
implicit transaction; a check whose answer decides a write cannot sit between them. So:

- **Make the write conditional** instead of checking first: `update ... where status =
  'pending'` and read the row count (`returning()`), or an insert a unique constraint rejects
  (`tryQuery` returns the `ConstraintViolation`). The row count or the violation is the answer.
- **Batch what belongs together** (`db.batch([insertA, updateB])`) behind a `tryQuery`, and keep
  read-then-decide logic in the service, before the batch.
- A test of such an invariant runs on `node:sqlite` in one process, so a race cannot show there:
  prove the conditional write by asserting the second attempt is rejected, not by timing.

## Tests

API tests call the real app in process: no port, no mocks.

```ts
import { isDefinedError, safe } from "@orpc/client";
import { describe, expect, it } from "vite-plus/test";
import { createTestApp } from "../../testing/test-app.ts";

it("returns the declared SERVICE_UNAVAILABLE error while shutting down", async () => {
  const t = await createTestApp({ lifecycle: { isShuttingDown: () => true } });
  const [error] = await safe(t.client.system.health());
  expect(isDefinedError(error)).toBe(true);
  expect(error).toMatchObject({ code: "SERVICE_UNAVAILABLE", data: { reason: "shutting_down" } });
});
```

- `t.client` is a typed oRPC client (`ApiClient`) whose `fetch` is `app.fetch`: HTTP, the
  serializer and the declared errors are all real.
- `createTestApp({...})` takes overrides for `Deps` (`now`, `lifecycle`, `db`) so a test pins
  time, simulates shutdown, or takes the database away (`db: unreachableDb()` from
  `@detour/db/testing`, which every query fails with `db_unavailable`).
- It calls `createTestDb()` from `@detour/db/testing`: every call empties the worker's database
  (about 1 ms). Call `createTestApp()` in every test, never share one across tests, never use
  `.concurrent`; `apps/api` and `packages/db` run Vitest with `isolate: false` to keep one
  database per worker (`docs/testing.md`).
- Test one declared error per test, by its code and data (`isDefinedError(error)`, then
  `toMatchObject({ code, status, data })`). Invalid input is answered `BAD_REQUEST` before the
  handler runs; one test of it per procedure is enough.
- Repo-level tests can use `createTestDb()` directly (`packages/db/src/query.adapter.test.ts`).

## Recipe: authentication (not in the template)

The template has no users. When the product needs them:

1. **Pick the library and wrap it.** Mount its HTTP handler in `app.ts` (for example on
   `/api/auth/*`) and add the path to the web dev server's proxy in `apps/web/vite.config.ts`
   (`proxy`, next to `/rpc`). Every call into its server API that can throw goes through an
   adapter (`apps/api/src/auth/*.adapter.ts`) that names the error codes it expects and returns
   them as tagged errors; any other rejection is a defect.
2. **Resolve the session per request** in `app.ts` and add it to `Context` as
   `session: Session | null` (`Context = Deps & { session }`). Services never read cookies or
   headers.
3. **A procedure base** in `apps/api/src/orpc/procedures.ts`: an oRPC middleware, declared with
   the errors it can return (`.errors({ UNAUTHORIZED })`), that turns `session === null` into
   `UNAUTHORIZED` and otherwise calls `next({ context: { user } })`. Export the context type it
   produces (`SignedInContext = Context & { user }`) for services. A base typed with its errors
   only compiles on a procedure whose contract declares them, so declare `UNAUTHORIZED` once in
   `packages/contracts/src/errors.ts` and list it in those procedures.
4. **Handlers** use it: `os.thing.get.use(authenticated).handler(...)`.
5. **Tests**: `createTestApp()` gains `signUp()` returning a user with a signed-in client; hash
   passwords cheaply in tests so a sign-up costs milliseconds.
6. **A refusal table**: one test that lists every procedure of the contract (typed from it, so a
   new procedure does not compile until listed) and calls each signed out, expecting
   `UNAUTHORIZED` or the public answer.

## Recipe: permissions (not in the template)

When different users may do different things:

1. **One pure function, shared.** A pure package (`packages/permissions`, added to
   `PURE_PACKAGES` in `vite.config.ts`) exports `can(access, action, resource)` returning
   `{ allowed: true }` or `{ allowed: false, reason }`, with `reason` from a closed list.
   `access` is a snapshot of the caller's roles, loaded once per request. The API enforces with
   it; the web gates controls with the same function, so the two cannot disagree. Type each
   action with its resource so `can(access, "thing.update", otherThing)` does not compile.
2. **The policy as tables.** Test `can()` with one table per role and action, checked against
   every combination; the test is the readable policy.
3. **Permission before any other check.** A service checks `can()` before validating anything
   that reads state, before a quota, before a conflict: a caller who may not act learns nothing
   about the data.
4. **Hidden answers like missing.** A row the caller may not see is answered `NOT_FOUND`, exactly
   as a row that does not exist, so callers cannot probe for existence. `FORBIDDEN` is for what
   they can see but not change.
5. **Lists filter in SQL.** Turn the visibility rules into `WHERE` conditions, never filter in
   memory; a property test generates data, filters it in the database and compares with
   `can(access, "<entity>.view", row)`.
6. **Check and write in one transaction.** When the permission depends on a row another request
   can change (a role, a membership), make the write conditional on what was checked
   (`update ... where role = 'admin'`) so the row count is the answer (see "Atomic writes").
7. **Errors.** `FORBIDDEN { reason }` is a shared contract error (`docs/errors.md`, "Recipe: a
   shared error"); `respond` maps a `{ type: "forbidden", reason }` service error to it.

## Recipe: live updates (not in the template)

When clients must see other users' changes without reloading:

1. **A stream procedure** in the contract (an oRPC event iterator) per subscriber, with its event
   union declared there, so the client's handler is an exhaustive switch over it.
2. **Every mutation publishes.** A service calls `context.events.publish(scope, change)` after its
   write committed, never before. Add a contract-wide test that lists every procedure (typed from
   the contract) as a read, a mutation with a call that must publish, or a mutation that changes
   nothing a client keeps, with the reason; a new procedure does not compile until it is listed.
3. **Who receives what is decided per subscriber, in one place**, with the same `can()` as
   everything else, never in the service. A change that alters the subscriber's own access tells
   them to refetch everything (`resync`) rather than computing a delta; no event ever names a row
   the subscriber could not load.
4. **Bounded queues.** A slow subscriber gets a `resync` instead of an unbounded backlog;
   publishing never waits for a subscriber; a heartbeat lets the client tell a dead connection
   from a quiet one, and it reconnects with backoff and a `resync`.
5. **Out of order is normal.** Two writes that waited for each other's locks can publish in either
   order: carry a version per row and drop older ones.
6. **One process first.** An in-process hub is enough for one API process; with several, `publish`
   also sends the change to the others (a Durable Object per scope, or an outbox table) and each
   process filters for its own subscribers. Services do not change.
