import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRequest, moveRequest, type StaffActor } from "../src/records.js";
import { Problem } from "../src/problem.js";
import { ANALYST, LEAD, OTHER_ANALYST, TODAY, count, openDesk, twoClients, type Desk } from "./helpers.js";

let desk: Desk;
let world: ReturnType<typeof twoClients>;
let buyer: string;
let lead: string;
let analyst: string;
let requestId: number;
beforeEach(async () => {
  desk = await openDesk();
  world = twoClients(desk.db);
  buyer = await desk.signIn(world.a.buyer.email);
  lead = await desk.signIn(LEAD);
  analyst = await desk.signIn(ANALYST);
  const made = await desk.call("POST", `/suppliers/${world.onlyA}/check-requests`, { cookie: buyer, body: { question: "Who owns them?" } });
  requestId = made.body.check_request.id;
});
afterEach(() => desk.close());

const assign = (cookie: string, analystId = 2) => desk.call("POST", `/staff/check-requests/${requestId}/assign`, { cookie, body: { analyst_id: analystId } });
const answer = (cookie: string) =>
  desk.call("POST", `/staff/check-requests/${requestId}/answer`, { cookie, body: { note: "Owned by Kinlock Equity since March; checked the state filing." } });
const cancel = (cookie: string) => desk.call("POST", `/check-requests/${requestId}/cancel`, { cookie });

describe("check request status machine", () => {
  it("goes requested, assigned by the lead, answered by the assigned analyst with a note the client sees", async () => {
    const assigned = await assign(lead);
    expect(assigned.body.check_request).toMatchObject({ status: "assigned", assigned_to: 2 });
    const answered = await answer(analyst);
    expect(answered.status).toBe(200);
    expect(answered.body.check_request).toMatchObject({ status: "answered", answered_on: "2026-10-01" });
    expect(answered.body.note).toMatchObject({ author_kind: "staff", author_id: 2, client_id: world.a.id, supplier_id: world.onlyA });
    const page = await desk.call("GET", `/suppliers/${world.onlyA}`, { cookie: buyer });
    expect(page.body.notes.at(-1)).toMatchObject({ author_kind: "staff", body: "Owned by Kinlock Equity since March; checked the state filing." });
    const actions = desk.db.prepare("SELECT action FROM activity WHERE subject = ? ORDER BY id").all(`check_request:${requestId}`);
    expect(actions.map((a) => (a as { action: string }).action)).toEqual([
      "check_request.requested",
      "check_request.assigned",
      "check_request.answered",
    ]);
  });

  it("accepts the analyst id as a numeric string", async () => {
    const reply = await desk.call("POST", `/staff/check-requests/${requestId}/assign`, { cookie: lead, body: { analyst_id: "3" } });
    expect(reply.body.check_request.assigned_to).toBe(3);
  });

  it("lets only the lead assign, only to an analyst or the lead, and only once", async () => {
    expect((await assign(analyst)).status).toBe(403);
    const toAdmin = await assign(lead, 9);
    expect([toAdmin.status, toAdmin.body.code]).toEqual([400, "not_an_analyst"]);
    expect((await assign(lead)).status).toBe(200);
    const again = await assign(lead, 3);
    expect([again.status, again.body.code]).toEqual([409, "status_changed"]);
  });

  it("lets only the assigned analyst answer, only once, and never without a note", async () => {
    expect((await answer(analyst)).body.code).toBe("status_changed");
    await assign(lead);
    expect((await answer(await desk.signIn(OTHER_ANALYST))).status).toBe(403);
    const blank = await desk.call("POST", `/staff/check-requests/${requestId}/answer`, { cookie: analyst, body: { note: "  " } });
    expect(blank.status).toBe(400);
    expect((await answer(analyst)).status).toBe(200);
    expect((await answer(analyst)).body.code).toBe("status_changed");
    expect(count(desk.db, "notes WHERE author_staff_id = 2 AND written_at = ?", TODAY.toISOString())).toBe(1);
  });

  it("is cancelled by the requester or their client admin before it is answered, and not by another buyer", async () => {
    const clientAdmin = await desk.signIn(world.a.admin.email);
    const person = { name: "Ned Kasprzak", email: "ned.kasprzak@example.test", password: "another-long-one", role: "buyer" };
    expect((await desk.call("POST", "/client-users", { cookie: clientAdmin, body: person })).status).toBe(201);
    expect((await cancel(await desk.signIn(person.email, person.password))).status).toBe(403);
    await assign(lead);
    const cancelled = await cancel(clientAdmin);
    expect(cancelled.body.check_request.status).toBe("cancelled");
    expect((await cancel(buyer)).body.code).toBe("status_changed");
    expect((await answer(analyst)).body.code).toBe("status_changed");
  });

  it("refuses to cancel an answered request", async () => {
    await assign(lead);
    await answer(analyst);
    const reply = await cancel(buyer);
    expect([reply.status, reply.body.code]).toEqual([409, "status_changed"]);
  });

  it("gives the loser of two moves made from the same read 409 status_changed and writes nothing for it", () => {
    const seen = getRequest(desk.db, requestId)!;
    const leadActor: StaffActor = { kind: "staff", id: 1, name: "Ingrid Solberg", email: LEAD, role: "lead" };
    moveRequest(desk.db, leadActor, seen, "assigned", TODAY, { assigned_to: 2 });
    const activity = count(desk.db, "activity");
    let error: unknown;
    try {
      moveRequest(desk.db, leadActor, seen, "cancelled", TODAY);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Problem);
    expect((error as Problem).status).toBe(409);
    expect((error as Problem).code).toBe("status_changed");
    expect(getRequest(desk.db, requestId)).toMatchObject({ status: "assigned", assigned_to: 2 });
    expect(count(desk.db, "activity")).toBe(activity);
  });

  it("rolls back the answer note when the answer loses a race", () => {
    desk.db.prepare("UPDATE check_requests SET status = 'assigned', assigned_to = 2 WHERE id = ?").run(requestId);
    const seen = getRequest(desk.db, requestId)!;
    desk.db.prepare("UPDATE check_requests SET status = 'cancelled' WHERE id = ?").run(requestId);
    const notes = count(desk.db, "notes");
    const analystActor: StaffActor = { kind: "staff", id: 2, name: "Marcus Oyelaran", email: ANALYST, role: "analyst" };
    expect(() =>
      moveRequest(desk.db, analystActor, seen, "answered", TODAY, {}, () => {
        desk.db
          .prepare("INSERT INTO notes (client_id, supplier_id, author_staff_id, written_at, body) VALUES (?, ?, 2, ?, 'late')")
          .run(seen.client_id, seen.supplier_id, TODAY.toISOString());
      }),
    ).toThrow(/no longer assigned/);
    expect(count(desk.db, "notes")).toBe(notes);
  });

  it("lists requests for staff across clients, filtered by status", async () => {
    const all = await desk.call("GET", "/staff/check-requests", { cookie: analyst });
    expect(all.body.check_requests).toHaveLength(count(desk.db, "check_requests"));
    const open = await desk.call("GET", "/staff/check-requests?status=requested", { cookie: analyst });
    expect(open.body.check_requests.every((r: { status: string }) => r.status === "requested")).toBe(true);
    expect(new Set(all.body.check_requests.map((r: { client_id: number }) => r.client_id)).size).toBeGreaterThan(1);
  });
});
