import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { count, openDesk, twoClients, type Desk } from "./helpers.js";

let desk: Desk;
let world: ReturnType<typeof twoClients>;
let buyer: string;
let admin: string;
beforeEach(async () => {
  desk = await openDesk();
  world = twoClients(desk.db);
  buyer = await desk.signIn(world.a.buyer.email);
  admin = await desk.signIn(world.a.admin.email);
});
afterEach(() => desk.close());

const addition = { name: "Quenneville Box & Tray", city: "Harlan Mills", state: "oh", spend_band: "100k_500k", note: "Quoted us on cartons." };

describe("supplier list", () => {
  it("lists the client's suppliers and filters by status", async () => {
    const all = await desk.call("GET", "/list", { cookie: buyer });
    expect(all.status).toBe(200);
    expect(all.body.entries.length).toBe(count(desk.db, "supplier_list WHERE client_id = ?", world.a.id));
    const approved = await desk.call("GET", "/list?status=approved", { cookie: buyer });
    expect(approved.body.entries.every((e: { status: string }) => e.status === "approved")).toBe(true);
    expect((await desk.call("GET", "/list?status=pending", { cookie: buyer })).status).toBe(400);
  });

  it("asks Tessary to add a supplier by name and answers the same whether or not the file has it", async () => {
    const existing = desk.db.prepare("SELECT name FROM suppliers WHERE id = ?").get(world.onlyA) as { name: string };
    const other = await desk.signIn(world.b.buyer.email);
    const known = await desk.call("POST", "/list", { cookie: other, body: { ...addition, name: existing.name.toUpperCase() } });
    const unknown = await desk.call("POST", "/list", { cookie: other, body: addition });
    expect([known.status, unknown.status]).toEqual([201, 201]);
    const shape = (r: { body: { addition_request: Record<string, unknown> } }) => Object.keys(r.body.addition_request).sort();
    expect(shape(known)).toEqual(shape(unknown));
    expect(unknown.body.addition_request).toMatchObject({ status: "requested", state: "OH", requested_on: "2026-10-01" });
    expect(JSON.stringify(known.body)).not.toMatch(/supplier_id|kind|plants/);
    expect(count(desk.db, "suppliers")).toBe(260);
    expect(count(desk.db, "supplier_list WHERE client_id = ?", world.b.id)).toBe(count(desk.db, "supplier_list WHERE client_id = ? AND added_on < '2026-10-01'", world.b.id));
    expect(desk.db.prepare("SELECT action, client_user_id FROM activity ORDER BY id DESC LIMIT 1").get()).toEqual({ action: "addition.requested", client_user_id: world.b.buyer.id });
  });

  it("refuses a supplier already on the list and a second open request for the same name", async () => {
    const listed = desk.db.prepare("SELECT name FROM suppliers WHERE id = ?").get(world.onlyA) as { name: string };
    const already = await desk.call("POST", "/list", { cookie: buyer, body: { ...addition, name: listed.name.toLowerCase() } });
    expect([already.status, already.body.code]).toEqual([409, "already_on_list"]);
    await desk.call("POST", "/list", { cookie: buyer, body: addition });
    const twice = await desk.call("POST", "/list", { cookie: admin, body: { ...addition, name: addition.name.toUpperCase() } });
    expect([twice.status, twice.body.code]).toEqual([409, "request_open"]);
    const mine = await desk.call("GET", "/addition-requests", { cookie: admin });
    expect(mine.body.addition_requests[0]).toMatchObject({ name: addition.name, status: "requested" });
  });

  it("refuses blank or invisible text, unknown bands and states, and fields it does not take", async () => {
    for (const body of [
      { ...addition, name: "   " },
      { ...addition, name: "\u200B \uFEFF" },
      { ...addition, spend_band: "huge" },
      { ...addition, state: "Ohio" },
      { ...addition, state: "ZZ" },
      { ...addition, kind: "packaging" },
    ]) {
      const reply = await desk.call("POST", "/list", { cookie: buyer, body });
      expect(reply.status).toBe(400);
      expect(reply.body.code).toBe("invalid_request");
    }
  });

  it("moves an entry into each status and changes its spend band", async () => {
    for (const status of ["onboarding", "approved", "on_hold", "dropped"]) {
      const reply = await desk.call("PATCH", `/list/${world.onlyA}`, { cookie: buyer, body: { status } });
      expect(reply.status).toBe(200);
      expect(reply.body.entry.status).toBe(status);
    }
    const band = await desk.call("PATCH", `/list/${world.onlyA}`, { cookie: admin, body: { spend_band: "over_2m" } });
    expect(band.body.entry.spend_band).toBe("over_2m");
    expect((await desk.call("PATCH", `/list/${world.onlyA}`, { cookie: buyer, body: {} })).status).toBe(400);
    expect((await desk.call("PATCH", `/list/${world.onlyA}`, { cookie: buyer, body: { status: "archived" } })).status).toBe(400);
    expect((await desk.call("PATCH", `/list/${world.onlyA}`, { cookie: buyer, body: { added_on: "2020-01-01" } })).status).toBe(400);
  });
});

describe("supplier page data", () => {
  it("returns the profile, the shared facts and calls, and this client's entry, notes and requests", async () => {
    const reply = await desk.call("GET", `/suppliers/${world.shared}`, { cookie: buyer });
    expect(reply.status).toBe(200);
    expect(reply.body.supplier.id).toBe(world.shared);
    expect(reply.body.facts[0]).toEqual(
      expect.objectContaining({ field: expect.any(String), checked_on: expect.any(String), checked_by_name: expect.any(String), note: expect.any(String) }),
    );
    expect(reply.body.calls.length).toBeGreaterThan(0);
    expect(reply.body.entry.client_id).toBe(world.a.id);
  });

  it("answers 404 for path ids that are not positive whole numbers", async () => {
    for (const path of ["/suppliers/abc", "/suppliers/0", "/suppliers/-1", "/suppliers/99999999999"]) {
      expect((await desk.call("GET", path, { cookie: buyer })).status).toBe(404);
    }
  });
});

describe("notes", () => {
  it("adds a trimmed note with the signed-in user as author and logs it", async () => {
    const reply = await desk.call("POST", `/suppliers/${world.shared}/notes`, { cookie: buyer, body: { body: "  Lead time is six weeks.  " } });
    expect(reply.status).toBe(201);
    const row = desk.db.prepare("SELECT client_id, author_user_id, author_staff_id, body FROM notes ORDER BY id DESC LIMIT 1").get();
    expect(row).toEqual({ client_id: world.a.id, author_user_id: world.a.buyer.id, author_staff_id: null, body: "Lead time is six weeks." });
    expect(desk.db.prepare("SELECT action, subject FROM activity ORDER BY id DESC LIMIT 1").get()).toEqual({
      action: "note.added",
      subject: `supplier:${world.shared}`,
    });
    expect((await desk.call("POST", `/suppliers/${world.shared}/notes`, { cookie: buyer, body: { body: " " } })).status).toBe(400);
  });
});

describe("check requests from a client", () => {
  it("opens a request and refuses a second open one on the same supplier", async () => {
    const first = await desk.call("POST", `/suppliers/${world.onlyA}/check-requests`, { cookie: buyer, body: { question: "Who owns them now?" } });
    expect(first.status).toBe(201);
    expect(first.body.check_request).toMatchObject({ status: "requested", requested_by: world.a.buyer.id, requested_on: "2026-10-01", assigned_to: null });
    const second = await desk.call("POST", `/suppliers/${world.onlyA}/check-requests`, { cookie: admin, body: { question: "And their plants?" } });
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: "request_open", check_request_id: first.body.check_request.id });
  });
});

describe("client users", () => {
  const person = { name: "Odile Farrant", email: "Odile.Farrant@Example.test", password: "a-long-password", role: "buyer" };

  it("lets a client admin add a user who can then sign in", async () => {
    const reply = await desk.call("POST", "/client-users", { cookie: admin, body: person });
    expect(reply.status).toBe(201);
    expect(reply.body.user).toMatchObject({ email: "odile.farrant@example.test", role: "buyer", client_id: world.a.id });
    expect(JSON.stringify(reply.body)).not.toContain("password");
    await desk.signIn("odile.farrant@example.test", "a-long-password");
  });

  it("refuses buyers, short passwords and an email already in use by staff or another client", async () => {
    expect((await desk.call("POST", "/client-users", { cookie: buyer, body: person })).status).toBe(403);
    expect((await desk.call("POST", "/client-users", { cookie: admin, body: { ...person, password: "short" } })).status).toBe(400);
    for (const email of ["marcus@tessary.example", world.b.buyer.email]) {
      const taken = await desk.call("POST", "/client-users", { cookie: admin, body: { ...person, email } });
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe("email_taken");
    }
  });
});
