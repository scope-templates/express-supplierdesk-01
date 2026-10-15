import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSeed, seedJson } from "../scripts/seed/generate.js";
import { loadSeedIfEmpty, openDatabase } from "../src/db.js";
import { SEED_PATH, seed } from "./helpers.js";

describe("seed data", () => {
  it("the generator writes the committed file byte for byte", () => {
    expect(seedJson(generateSeed())).toBe(readFileSync(SEED_PATH, "utf8"));
  }, 30_000);

  it("loads into an empty store once", () => {
    const db = openDatabase(":memory:");
    expect(loadSeedIfEmpty(db, seed)).toBe(true);
    expect(loadSeedIfEmpty(db, seed)).toBe(false);
    expect((db.prepare("SELECT count(*) AS n FROM suppliers").get() as { n: number }).n).toBe(seed.suppliers.length);
  });

  it("follows the desk's own rules: facts are checked by staff, on or before the last seeded day", () => {
    const staff = new Set(seed.staff.map((s) => s.id));
    for (const fact of seed.facts) {
      expect(staff.has(fact.checked_by)).toBe(true);
      expect(fact.checked_on <= "2026-09-30").toBe(true);
      expect(fact.note.trim()).not.toBe("");
    }
  });

  it("follows the desk's own rules: client records are written by that client's own users", () => {
    const clientOf = new Map(seed.client_users.map((u) => [u.id, u.client_id]));
    for (const entry of seed.supplier_list) expect(clientOf.get(entry.added_by)).toBe(entry.client_id);
    for (const request of seed.check_requests) expect(clientOf.get(request.requested_by)).toBe(request.client_id);
    for (const note of seed.notes.filter((n) => n.author_user_id !== null)) expect(clientOf.get(note.author_user_id as number)).toBe(note.client_id);
  });

  it("follows the desk's own rules: at most one open check request per client and supplier, none for the ended client", () => {
    const ended = new Set(seed.clients.filter((c) => c.status === "ended").map((c) => c.id));
    const open = seed.check_requests.filter((r) => r.status === "requested" || r.status === "assigned");
    const keys = open.map((r) => `${r.client_id}:${r.supplier_id}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(open.some((r) => ended.has(r.client_id))).toBe(false);
  });

  it("records every seeded write from the activity log's start in the activity log", () => {
    const logged = new Set(seed.activity.map((a) => `${a.action}|${a.subject}`));
    for (const f of seed.facts.filter((f) => f.checked_on >= "2026-04-01")) expect(logged.has(`fact.added|supplier:${f.supplier_id} ${f.field}`)).toBe(true);
    for (const c of seed.calls.filter((c) => c.held_on >= "2026-04-01")) expect(logged.has(`call.added|supplier:${c.supplier_id}`)).toBe(true);
    for (const r of seed.check_requests.filter((r) => r.requested_on >= "2026-04-01")) expect(logged.has(`check_request.requested|check_request:${r.id}`)).toBe(true);
    expect(seed.activity.every((a) => a.at >= "2026-04-01")).toBe(true);
  });

  it("links every list entry added since addition requests began to a linked request from the same user", () => {
    const linked = seed.addition_requests.filter((a) => a.status === "linked");
    for (const entry of seed.supplier_list.filter((e) => e.added_on >= "2026-03-02")) {
      expect(linked.some((a) => a.client_id === entry.client_id && a.supplier_id === entry.supplier_id && a.requested_by === entry.added_by && a.decided_on === entry.added_on)).toBe(true);
    }
    expect(new Set(seed.addition_requests.map((a) => a.status))).toEqual(new Set(["requested", "linked", "declined"]));
  });

  it("keeps each supplier row's headquarters as the last change an analyst made to it", () => {
    for (const supplier of seed.suppliers) {
      const last = seed.supplier_changes.filter((c) => c.supplier_id === supplier.id && c.field === "hq_city").at(-1);
      if (last) expect(supplier.hq_city).toBe(last.new_value);
    }
  });
});
