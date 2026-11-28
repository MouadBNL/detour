import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { assert, beforeEach, describe, expect, it } from "vite-plus/test";
import type { Db } from "./d1.ts";
import { tryQuery } from "./query.adapter.ts";
import { createTestDb, unreachableDb } from "./testing.ts";

/**
 * A table of the test's own, with one constraint of each kind. `createTestDb()` empties this one
 * like any other table in the database.
 */
const probes = sqliteTable("probes", {
  id: integer("id").primaryKey(),
  parentId: integer("parent_id").references((): AnySQLiteColumn => probes.id),
  name: text("name").notNull(),
  size: integer("size"),
});

const CREATE_PROBES = sql`create table if not exists probes (
  id integer primary key,
  parent_id integer references probes (id),
  name text not null,
  size integer check (size >= 0)
)`;

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await db.run(CREATE_PROBES);
});

describe("tryQuery (SQLite / D1)", () => {
  it("returns the query's value when nothing fails", async () => {
    const inserted = await tryQuery(() =>
      db.insert(probes).values({ id: 1, name: "a" }).returning({ id: probes.id }),
    );
    expect(inserted).toEqual({ ok: true, value: [{ id: 1 }] });
  });

  it("turns a unique violation into an Err naming table.column", async () => {
    await db.insert(probes).values({ id: 1, name: "a" });
    const duplicate = await tryQuery(() => db.insert(probes).values({ id: 1, name: "b" }));
    expect(duplicate).toMatchObject({
      ok: false,
      error: { type: "unique_violation", constraint: "probes.id", table: "probes" },
    });
  });

  it("turns a foreign key violation into an Err", async () => {
    const orphan = await tryQuery(() =>
      db.insert(probes).values({ id: 1, parentId: 99, name: "a" }),
    );
    expect(orphan).toMatchObject({
      ok: false,
      error: { type: "foreign_key_violation", constraint: "foreign_key" },
    });
  });

  it("turns a check violation into an Err", async () => {
    const negative = await tryQuery(() => db.insert(probes).values({ id: 1, name: "a", size: -1 }));
    expect(negative).toMatchObject({
      ok: false,
      error: { type: "check_violation" },
    });
  });

  it("turns a not-null violation into an Err naming table.column", async () => {
    const unnamed = await tryQuery(() => db.run(sql`insert into probes (id) values (1)`));
    expect(unnamed).toMatchObject({
      ok: false,
      error: { type: "not_null_violation", constraint: "probes.name", table: "probes" },
    });
  });

  it("turns an unavailable D1/SQLite database into db_unavailable", async () => {
    const pinged = await tryQuery(() => unreachableDb().run(sql`select 1`));
    expect(pinged).toMatchObject({ ok: false, error: { type: "db_unavailable" } });
  });

  it("rethrows anything else (a defect), wrapped by Drizzle as on D1", async () => {
    const defect: unknown = await tryQuery(() => db.all(sql`select * from no_such_table`)).then(
      () => null,
      (error: unknown) => error,
    );
    assert(defect instanceof Error && defect.cause instanceof Error);
    expect(defect.cause.message).toMatch(/no such table/i);
  });

  it("keeps a defect whose text only mentions reset or internal a defect", async () => {
    await expect(
      tryQuery(() => Promise.reject(new Error("D1_ERROR: no such column: reset_at: SQLITE_ERROR"))),
    ).rejects.toThrow(/reset_at/);
    const transient = await tryQuery(() =>
      Promise.reject(new Error("D1_ERROR: D1 DB is overloaded. Requests queued for too long.")),
    );
    expect(transient).toMatchObject({ ok: false, error: { type: "db_unavailable" } });
  });
});

describe("createTestDb", () => {
  it("returns an empty database each time, in well under 10 ms", async () => {
    await db.insert(probes).values([
      { id: 1, name: "parent" },
      { id: 2, parentId: 1, name: "child" },
    ]);
    const runs = 20;
    const start = performance.now();
    for (let i = 0; i < runs; i += 1) await createTestDb();
    const perDatabase = (performance.now() - start) / runs;
    const fresh = await createTestDb();
    expect(await fresh.select().from(probes)).toEqual([]);
    expect(perDatabase).toBeLessThan(10);
  });
});
