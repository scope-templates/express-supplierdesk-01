import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ADMIN, ANALYST, count, openDesk, twoClients, type Desk } from "./helpers.js";

let desk: Desk;
let world: ReturnType<typeof twoClients>;
let clientB: string;
let analyst: string;
beforeEach(async () => {
  desk = await openDesk();
  world = twoClients(desk.db);
  clientB = await desk.signIn(world.b.buyer.email);
  analyst = await desk.signIn(ANALYST);
});
afterEach(() => desk.close());

async function ask(name: string, band = "500k_2m") {
  const reply = await desk.call("POST", "/list", { cookie: clientB, body: { name, city: "Gable Mills", state: "KY", spend_band: band } });
  expect(reply.status).toBe(201);
  return reply.body.addition_request.id as number;
}

const nameOf = (id: number) => (desk.db.prepare("SELECT name FROM suppliers WHERE id = ?").get(id) as { name: string }).name;

describe("addition requests", () => {
  it("are linked by an analyst to a supplier in the file, which joins the client's list as onboarding", async () => {
    const id = await ask(nameOf(world.onlyA));
    const reply = await desk.call("POST", `/staff/addition-requests/${id}/link`, { cookie: analyst, body: { supplier_id: String(world.onlyA) } });
    expect(reply.body.addition_request).toMatchObject({ status: "linked", supplier_id: world.onlyA, decided_by: 2, decided_on: "2026-10-01" });
    const entry = desk.db.prepare("SELECT status, spend_band, added_by, added_on FROM supplier_list WHERE client_id = ? AND supplier_id = ?").get(world.b.id, world.onlyA);
    expect(entry).toEqual({ status: "onboarding", spend_band: "500k_2m", added_by: world.b.buyer.id, added_on: "2026-10-01" });
    expect((await desk.call("GET", `/suppliers/${world.onlyA}`, { cookie: clientB })).status).toBe(200);
    const again = await desk.call("POST", `/staff/addition-requests/${id}/decline`, { cookie: analyst, body: { decision_note: "Too late." } });
    expect([again.status, again.body.code]).toEqual([409, "status_changed"]);
  });

  it("are linked to a new supplier the analyst adds to the file", async () => {
    const id = await ask("Brightmoor Twine");
    const supplier = { name: "Brightmoor Twine", kind: "packaging", hq_city: "Gable Mills", hq_state: "KY", plants: "Gable Mills, KY" };
    const reply = await desk.call("POST", `/staff/addition-requests/${id}/link`, { cookie: analyst, body: { supplier } });
    const created = desk.db.prepare("SELECT id, created_on FROM suppliers WHERE name = 'Brightmoor Twine'").get() as { id: number; created_on: string };
    expect(reply.body.addition_request).toMatchObject({ status: "linked", supplier_id: created.id });
    expect(created.created_on).toBe("2026-10-01");
    const actions = desk.db.prepare("SELECT action, staff_id FROM activity WHERE staff_id IS NOT NULL ORDER BY id DESC LIMIT 2").all();
    expect(actions).toEqual([
      { action: "addition.linked", staff_id: 2 },
      { action: "supplier.added", staff_id: 2 },
    ]);
  });

  it("refuse adding a supplier whose name is already in the file", async () => {
    const id = await ask("Brightmoor Twine");
    const supplier = { name: nameOf(world.onlyA).toUpperCase(), kind: "packaging", hq_city: "Gable Mills", hq_state: "KY" };
    const reply = await desk.call("POST", `/staff/addition-requests/${id}/link`, { cookie: analyst, body: { supplier } });
    expect([reply.status, reply.body.code]).toEqual([409, "supplier_exists"]);
  });

  it("are declined with a note the client sees", async () => {
    const id = await ask("Not A Real Shop");
    expect((await desk.call("POST", `/staff/addition-requests/${id}/decline`, { cookie: analyst, body: { decision_note: " " } })).status).toBe(400);
    await desk.call("POST", `/staff/addition-requests/${id}/decline`, { cookie: analyst, body: { decision_note: "No such business in Kentucky." } });
    const mine = await desk.call("GET", "/addition-requests", { cookie: clientB });
    expect(mine.body.addition_requests[0]).toMatchObject({ id, status: "declined", decision_note: "No such business in Kentucky." });
  });

  it("refuse linking to a supplier already on that client's list, and leave the request open", async () => {
    const id = await ask("Brightmoor Twine");
    const reply = await desk.call("POST", `/staff/addition-requests/${id}/link`, { cookie: analyst, body: { supplier_id: world.shared } });
    expect([reply.status, reply.body.code]).toEqual([409, "already_on_list"]);
    expect(desk.db.prepare("SELECT status FROM addition_requests WHERE id = ?").get(id)).toEqual({ status: "requested" });
  });

  it("are decided only by analysts and the lead, and seen only by the asking client", async () => {
    const id = await ask("Brightmoor Twine");
    const admin = await desk.signIn(ADMIN);
    const clientA = await desk.signIn(world.a.admin.email);
    expect((await desk.call("POST", `/staff/addition-requests/${id}/decline`, { cookie: admin, body: { decision_note: "No." } })).status).toBe(403);
    expect((await desk.call("POST", `/staff/addition-requests/${id}/link`, { cookie: clientA, body: { supplier_id: world.onlyA } })).status).toBe(403);
    expect((await desk.call("GET", "/staff/addition-requests", { cookie: clientA })).status).toBe(403);
    const seen = await desk.call("GET", "/addition-requests", { cookie: clientA });
    expect(seen.body.addition_requests.some((a: { id: number }) => a.id === id)).toBe(false);
    expect(seen.body.addition_requests.length).toBe(count(desk.db, "addition_requests WHERE client_id = ?", world.a.id));
    expect((await desk.call("GET", "/addition-requests", { cookie: admin })).status).toBe(403);
    expect((await desk.call("GET", "/staff/activity", { cookie: clientA })).status).toBe(403);
    const queue = await desk.call("GET", "/staff/addition-requests?status=requested", { cookie: admin });
    expect(queue.body.addition_requests.some((a: { id: number }) => a.id === id)).toBe(true);
  });
});
