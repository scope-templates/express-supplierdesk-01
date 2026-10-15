import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { MIGRATIONS, SCHEMA_VERSION, migrate } from "../src/db.js";
import { ANALYST, openDesk, type Desk } from "./helpers.js";

let desk: Desk;
beforeEach(async () => {
  desk = await openDesk();
  const cookie = await desk.signIn(ANALYST);
  await desk.call("POST", "/staff/suppliers/5/facts", {
    cookie,
    body: { field: "headcount", value: "About 300", checked_on: "2026-09-01", note: "careers page" },
  });
});
afterEach(() => desk.close());

describe("append-only history", () => {
  for (const table of ["activity", "notes", "facts", "calls", "supplier_changes"]) {
    it(`${table} rows cannot be changed, removed or replaced by an insert over their id`, () => {
      const row = desk.db.prepare(`SELECT * FROM ${table} ORDER BY id LIMIT 1`).get() as Record<string, unknown>;
      const columns = Object.keys(row);
      expect(() => desk.db.prepare(`UPDATE ${table} SET id = id WHERE id = ?`).run(row.id)).toThrow(/append-only/);
      expect(() => desk.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.id)).toThrow(/append-only/);
      expect(() =>
        desk.db.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})`).run(row),
      ).toThrow(/append-only/);
      expect(desk.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id)).toEqual(row);
    });
  }

  it("check requests cannot be replaced by an insert over their id", () => {
    const row = desk.db.prepare("SELECT * FROM check_requests ORDER BY id LIMIT 1").get() as Record<string, unknown>;
    expect(() =>
      desk.db
        .prepare(
          "INSERT OR REPLACE INTO check_requests (id, client_id, supplier_id, requested_by, requested_on, question, status) VALUES (@id, @client_id, @supplier_id, @requested_by, @requested_on, 'x', 'requested')",
        )
        .run(row),
    ).toThrow(/status moves/);
    expect(desk.db.prepare("SELECT * FROM check_requests WHERE id = ?").get(row.id)).toEqual(row);
  });
});

describe("actors", () => {
  it("an activity row names exactly one actor who exists, of the kind it says", () => {
    const insert = desk.db.prepare("INSERT INTO activity (actor_kind, staff_id, client_user_id, action, subject, at) VALUES (?, ?, ?, 'x', 'y', 'z')");
    expect(() => insert.run("staff", null, null)).toThrow(/CHECK/);
    expect(() => insert.run("staff", 1, 1)).toThrow(/CHECK/);
    expect(() => insert.run("client_user", 1, null)).toThrow(/CHECK/);
    expect(() => insert.run("staff", 999, null)).toThrow(/FOREIGN KEY/);
    expect(() => insert.run("client_user", null, 9999)).toThrow(/FOREIGN KEY/);
  });

  it("a note has exactly one author, and a fact is always checked by staff on a date", () => {
    const entry = desk.db.prepare("SELECT client_id, supplier_id FROM supplier_list LIMIT 1").get() as { client_id: number; supplier_id: number };
    const note = desk.db.prepare("INSERT INTO notes (client_id, supplier_id, author_staff_id, author_user_id, written_at, body) VALUES (?, ?, ?, ?, 'z', 'b')");
    expect(() => note.run(entry.client_id, entry.supplier_id, null, null)).toThrow(/CHECK/);
    expect(() => note.run(entry.client_id, entry.supplier_id, 1, 1)).toThrow(/CHECK/);
    const fact = desk.db.prepare("INSERT INTO facts (supplier_id, field, value, checked_on, checked_by, note) VALUES (1, 'ownership', 'v', ?, ?, 'n')");
    expect(() => fact.run(null, 1)).toThrow(/NOT NULL/);
    expect(() => fact.run("last spring", 1)).toThrow(/CHECK/);
    expect(() => fact.run("2026-01-05", null)).toThrow(/NOT NULL/);
    expect(() => fact.run("2026-01-05", 999)).toThrow(/FOREIGN KEY/);
  });
});

describe("status rules in the store", () => {
  it("list entries are never deleted or replaced; they move to dropped", () => {
    const entry = desk.db.prepare("SELECT * FROM supplier_list LIMIT 1").get() as Record<string, unknown>;
    expect(() => desk.db.prepare("DELETE FROM supplier_list WHERE client_id = ? AND supplier_id = ?").run(entry.client_id, entry.supplier_id)).toThrow(/dropped/);
    expect(() =>
      desk.db
        .prepare("INSERT OR REPLACE INTO supplier_list (client_id, supplier_id, added_on, added_by, status, spend_band) VALUES (@client_id, @supplier_id, @added_on, @added_by, 'approved', 'over_2m')")
        .run(entry),
    ).toThrow(/dropped/);
  });

  it("check requests move only requested to assigned or cancelled, and assigned to answered or cancelled", () => {
    const pick = (status: string) => (desk.db.prepare("SELECT id FROM check_requests WHERE status = ? LIMIT 1").get(status) as { id: number }).id;
    const move = (id: number, sql: string) => () => desk.db.prepare(`UPDATE check_requests SET ${sql} WHERE id = ?`).run(id);
    expect(move(pick("answered"), "status = 'assigned'")).toThrow(/status moves/);
    expect(move(pick("cancelled"), "status = 'requested'")).toThrow(/status moves/);
    expect(move(pick("requested"), "status = 'answered', assigned_to = 2, answered_on = '2026-10-01'")).toThrow(/status moves/);
    expect(move(pick("assigned"), "assigned_to = 3")).toThrow(/status moves/);
    expect(move(pick("requested"), "question = 'changed'")).toThrow(/status moves/);
    expect(() => desk.db.prepare("DELETE FROM check_requests WHERE id = ?").run(pick("answered"))).toThrow(/status moves/);
    expect(move(pick("requested"), "status = 'assigned', assigned_to = 2")).not.toThrow();
  });

  it("one open check request per client and supplier, even when written straight to the store", () => {
    const open = desk.db.prepare("SELECT client_id, supplier_id, requested_by FROM check_requests WHERE status = 'requested' LIMIT 1").get() as Record<string, number>;
    expect(() =>
      desk.db
        .prepare("INSERT INTO check_requests (client_id, supplier_id, requested_by, requested_on, question, status) VALUES (@client_id, @supplier_id, @requested_by, '2026-10-01', 'again', 'requested')")
        .run(open),
    ).toThrow(/UNIQUE/);
  });

  it("addition requests move only from requested to linked or declined", () => {
    const pick = (status: string) => (desk.db.prepare("SELECT id FROM addition_requests WHERE status = ? LIMIT 1").get(status) as { id: number }).id;
    expect(() => desk.db.prepare("UPDATE addition_requests SET status = 'requested', supplier_id = NULL, decided_by = NULL, decided_on = NULL WHERE id = ?").run(pick("linked"))).toThrow(/status moves/);
    expect(() => desk.db.prepare("UPDATE addition_requests SET name = 'Other' WHERE id = ?").run(pick("requested"))).toThrow(/status moves/);
    expect(() => desk.db.prepare("UPDATE addition_requests SET status = 'linked' WHERE id = ?").run(pick("requested"))).toThrow(/CHECK/);
  });
});

describe("schema version", () => {
  it("records the number of migrations applied and brings an older store forward", () => {
    expect(desk.db.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
    const older = new Database(":memory:");
    migrate(older, 3);
    expect(older.pragma("user_version", { simple: true })).toBe(3);
    expect(older.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'activity'").get()).toEqual({ n: 0 });
    migrate(older);
    expect(older.pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
    expect(older.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('activity', 'sessions', 'addition_requests')").get()).toEqual({ n: 3 });
  });
});
