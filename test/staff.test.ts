import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADMIN, ANALYST, LEAD, count, openDesk, twoClients, type Desk } from "./helpers.js";

let desk: Desk;
let analyst: string;
beforeEach(async () => {
  desk = await openDesk();
  analyst = await desk.signIn(ANALYST);
});
afterEach(() => desk.close());

const fact = { field: "ownership", value: "Majority owned by Stonepath Capital Partners", checked_on: "2026-09-30", note: "state filing" };

describe("supplier file", () => {
  it("lists suppliers with a name search and kind filter", async () => {
    const all = await desk.call("GET", "/staff/suppliers", { cookie: analyst });
    expect(all.body.suppliers).toHaveLength(260);
    const one = desk.db.prepare("SELECT name, kind FROM suppliers WHERE id = 1").get() as { name: string; kind: string };
    const found = await desk.call("GET", `/staff/suppliers?q=${encodeURIComponent(one.name.slice(0, 6).toLowerCase())}`, { cookie: analyst });
    expect(found.body.suppliers.map((s: { name: string }) => s.name)).toContain(one.name);
    const row = all.body.suppliers.find((s: { id: number }) => s.id === 1);
    expect(row).toMatchObject({
      fact_rows: count(desk.db, "facts WHERE supplier_id = 1"),
      last_checked_on: (desk.db.prepare("SELECT max(checked_on) AS d FROM facts WHERE supplier_id = 1").get() as { d: string | null }).d,
      client_lists: count(desk.db, "supplier_list WHERE supplier_id = 1"),
    });
    const kind = await desk.call("GET", `/staff/suppliers?kind=${one.kind}`, { cookie: analyst });
    expect(kind.body.suppliers.every((s: { kind: string }) => s.kind === one.kind)).toBe(true);
  });

  it("adds a supplier and refuses a name already in the file, regardless of case", async () => {
    const body = { name: "Corvallin Gasket", kind: "components", hq_city: "Dunholm", hq_state: "WI", plants: "Dunholm, WI" };
    const made = await desk.call("POST", "/staff/suppliers", { cookie: analyst, body });
    expect(made.status).toBe(201);
    expect(made.body.supplier).toMatchObject({ ...body, created_on: "2026-10-01" });
    const again = await desk.call("POST", "/staff/suppliers", { cookie: analyst, body: { ...body, name: "CORVALLIN GASKET" } });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("supplier_exists");
    const admin = await desk.signIn(ADMIN);
    expect((await desk.call("POST", "/staff/suppliers", { cookie: admin, body: { ...body, name: "Other Gasket" } })).status).toBe(403);
  });

  it("changes a supplier's headquarters only with city and state together", async () => {
    const before = desk.db.prepare("SELECT hq_city, hq_state FROM suppliers WHERE id = 1").get() as { hq_city: string; hq_state: string };
    const moved = await desk.call("PATCH", "/staff/suppliers/1", { cookie: analyst, body: { hq_city: "Dunholm", hq_state: "WI" } });
    expect(moved.body.supplier).toMatchObject({ hq_city: "Dunholm", hq_state: "WI" });
    const recorded = desk.db.prepare("SELECT field, old_value, new_value, staff_id FROM supplier_changes WHERE supplier_id = 1 ORDER BY id DESC LIMIT 2").all();
    expect(recorded).toEqual(
      expect.arrayContaining([
        { field: "hq_city", old_value: before.hq_city, new_value: "Dunholm", staff_id: 2 },
        ...(before.hq_state === "WI" ? [] : [{ field: "hq_state", old_value: before.hq_state, new_value: "WI", staff_id: 2 }]),
      ]),
    );
    const detail = await desk.call("GET", "/staff/suppliers/1", { cookie: analyst });
    expect(detail.body.changes.at(-1)).toMatchObject({ new_value: expect.any(String), by_name: "Marcus Oyelaran" });
    expect((await desk.call("PATCH", "/staff/suppliers/1", { cookie: analyst, body: { hq_city: "Dunholm" } })).status).toBe(400);
    expect((await desk.call("PATCH", "/staff/suppliers/1", { cookie: analyst, body: { name: "New Name" } })).status).toBe(400);
    const admin = await desk.signIn(ADMIN);
    expect((await desk.call("PATCH", "/staff/suppliers/1", { cookie: admin, body: { plants: "Dunholm, WI" } })).status).toBe(403);
  });

  it("returns a supplier with its facts, calls and every client list it is on", async () => {
    const { shared, a, b } = twoClients(desk.db);
    const reply = await desk.call("GET", `/staff/suppliers/${shared}`, { cookie: analyst });
    expect(reply.body.facts.length).toBe(count(desk.db, "facts WHERE supplier_id = ?", shared));
    expect(reply.body.lists.map((l: { client_id: number }) => l.client_id)).toEqual(expect.arrayContaining([a.id, b.id]));
  });
});

describe("facts", () => {
  it("adds a fact with the signed-in analyst as checked_by and logs it", async () => {
    const reply = await desk.call("POST", "/staff/suppliers/5/facts", { cookie: analyst, body: fact });
    expect(reply.status).toBe(201);
    const row = desk.db.prepare("SELECT supplier_id, field, value, checked_on, checked_by, note FROM facts WHERE id = ?").get(reply.body.fact.id);
    expect(row).toEqual({ supplier_id: 5, ...fact, checked_by: 2 });
    expect(desk.db.prepare("SELECT actor_kind, staff_id, action FROM activity ORDER BY id DESC LIMIT 1").get()).toEqual({
      actor_kind: "staff",
      staff_id: 2,
      action: "fact.added",
    });
  });

  it("refuses a fact without checked_on or note, with a future checked_on, or with checked_by in the body", async () => {
    const { checked_on: _c, ...noDate } = fact;
    const { note: _n, ...noNote } = fact;
    for (const body of [noDate, noNote, { ...fact, value: "  " }, { ...fact, note: "" }, { ...fact, checked_on: "2026-02-30" }, { ...fact, checked_by: 3 }, { ...fact, field: "founded" }]) {
      const reply = await desk.call("POST", "/staff/suppliers/5/facts", { cookie: analyst, body });
      expect(reply.status).toBe(400);
    }
    const future = await desk.call("POST", "/staff/suppliers/5/facts", { cookie: analyst, body: { ...fact, checked_on: "2026-10-02" } });
    expect(future.status).toBe(400);
    expect(future.body.code).toBe("checked_on_in_future");
  });

  it("uses the company's Central-time day for today", async () => {
    await desk.close();
    desk = await openDesk(null, new Date("2026-10-02T03:00:00Z"));
    const cookie = await desk.signIn(ANALYST);
    const reply = await desk.call("POST", "/staff/suppliers/5/facts", { cookie, body: { ...fact, checked_on: "2026-10-02" } });
    expect(reply.body.code).toBe("checked_on_in_future");
  });

  it("lets only analysts and the lead add facts and calls", async () => {
    const admin = await desk.signIn(ADMIN);
    const lead = await desk.signIn(LEAD);
    expect((await desk.call("POST", "/staff/suppliers/5/facts", { cookie: admin, body: fact })).status).toBe(403);
    expect((await desk.call("POST", "/staff/suppliers/5/facts", { cookie: lead, body: fact })).status).toBe(201);
  });
});

describe("activity", () => {
  it("shows staff the most recent activity first", async () => {
    await desk.call("POST", "/staff/suppliers/5/facts", { cookie: analyst, body: fact });
    const reply = await desk.call("GET", "/staff/activity", { cookie: analyst });
    expect(reply.body.activity[0]).toMatchObject({ actor: "Marcus Oyelaran", action: "fact.added", subject: "supplier:5 ownership" });
    expect(reply.body.activity.length).toBe(100);
  });
});

describe("calls", () => {
  const call = { contact_name: "Rhea Tolkov", contact_title: "Plant Manager", held_on: "2026-09-29", write_up: "Walked the floor." };

  it("adds a call write-up by the signed-in analyst and refuses a future date", async () => {
    const reply = await desk.call("POST", "/staff/suppliers/5/calls", { cookie: analyst, body: call });
    expect(reply.status).toBe(201);
    expect(reply.body.call).toMatchObject({ supplier_id: 5, by_staff_id: 2, held_on: "2026-09-29" });
    const future = await desk.call("POST", "/staff/suppliers/5/calls", { cookie: analyst, body: { ...call, held_on: "2026-10-05" } });
    expect(future.body.code).toBe("held_on_in_future");
    expect((await desk.call("POST", "/staff/suppliers/5/calls", { cookie: analyst, body: { ...call, write_up: "  " } })).status).toBe(400);
    expect((await desk.call("POST", "/staff/suppliers/5/calls", { cookie: await desk.signIn(ADMIN), body: call })).status).toBe(403);
  });
});

describe("clients", () => {
  const client = {
    name: "Wendover Signal Products",
    industry: "Traffic signals",
    city: "Brackenridge",
    state: "KY",
    subscribed_on: "2026-09-15",
    admin: { name: "Lucille Pendarvis", email: "lucille@wendover.example", password: "first-admin-pass" },
  };

  it("lets the admin list clients, add one with its first client admin, and end one", async () => {
    const admin = await desk.signIn(ADMIN);
    const listed = await desk.call("GET", "/staff/clients", { cookie: admin });
    expect(listed.body.clients).toHaveLength(16);
    const made = await desk.call("POST", "/staff/clients", { cookie: admin, body: client });
    expect(made.status).toBe(201);
    expect(made.body.admin.role).toBe("client_admin");
    const userCookie = await desk.signIn("lucille@wendover.example", "first-admin-pass");
    expect((await desk.call("GET", "/list", { cookie: userCookie })).body.entries).toEqual([]);
    const ended = await desk.call("POST", `/staff/clients/${made.body.client.id}/end`, { cookie: admin });
    expect(ended.body.client.status).toBe("ended");
    expect((await desk.call("POST", `/staff/clients/${made.body.client.id}/end`, { cookie: admin })).body.code).toBe("status_changed");
    expect((await desk.call("GET", "/list", { cookie: userCookie })).status).toBe(401);
  });

  it("refuses duplicate names and emails, and non-admin staff", async () => {
    const admin = await desk.signIn(ADMIN);
    const existing = desk.db.prepare("SELECT name FROM clients WHERE id = 1").get() as { name: string };
    expect((await desk.call("POST", "/staff/clients", { cookie: admin, body: { ...client, name: existing.name } })).body.code).toBe("client_exists");
    const email = await desk.call("POST", "/staff/clients", { cookie: admin, body: { ...client, admin: { ...client.admin, email: ANALYST } } });
    expect(email.body.code).toBe("email_taken");
    expect((await desk.call("GET", "/staff/clients", { cookie: analyst })).status).toBe(403);
    expect((await desk.call("POST", "/staff/clients", { cookie: analyst, body: client })).status).toBe(403);
    expect((await desk.call("POST", "/staff/clients/1/end", { cookie: analyst })).status).toBe(403);
    expect(count(desk.db, "clients")).toBe(16);
  });
});
