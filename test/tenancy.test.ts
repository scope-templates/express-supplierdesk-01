import { afterEach, describe, expect, it } from "vitest";
import { ANALYST, count, openDesk, scriptedModel, toolCall, twoClients, type Desk } from "./helpers.js";

let desk: Desk | undefined;
afterEach(async () => {
  await desk?.close();
  desk = undefined;
});

async function setUp(model = scriptedModel(() => ({ content: "Done.", tool_calls: [] })).model) {
  desk = await openDesk(model);
  const world = twoClients(desk.db);
  const cookieA = await desk.signIn(world.a.buyer.email);
  const cookieB = await desk.signIn(world.b.buyer.email);
  const adminB = await desk.signIn(world.b.admin.email);
  return { d: desk, world, cookieA, cookieB, adminB };
}

describe("a second client's user", () => {
  it("gets the same 404 for a supplier on another client's list as for one that does not exist", async () => {
    const { d, world, cookieB } = await setUp();
    const hidden = await d.call("GET", `/suppliers/${world.onlyA}`, { cookie: cookieB });
    const missing = await d.call("GET", "/suppliers/999999", { cookie: cookieB });
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(hidden.body.code).toBe("not_found");
    expect(hidden.body.detail).toBe(`Supplier ${world.onlyA} was not found.`);
    expect(missing.body.detail).toBe("Supplier 999999 was not found.");
  });

  it("gets 404 from every supplier route for a supplier only on another client's list, and nothing is written", async () => {
    const { d, world, cookieB, adminB } = await setUp();
    const before = [count(d.db, "notes"), count(d.db, "check_requests"), count(d.db, "supplier_list"), count(d.db, "activity")];
    for (const cookie of [cookieB, adminB]) {
      for (const [method, path, body] of [
        ["GET", `/suppliers/${world.onlyA}`, undefined],
        ["POST", `/suppliers/${world.onlyA}/notes`, { body: "Looks fine." }],
        ["POST", `/suppliers/${world.onlyA}/check-requests`, { question: "Who owns them?" }],
        ["PATCH", `/list/${world.onlyA}`, { status: "approved" }],
        ["POST", `/assistant/suppliers/${world.onlyA}`, { question: "Who owns them?" }],
        ["GET", `/app/suppliers/${world.onlyA}`, undefined],
        ["POST", `/app/suppliers/${world.onlyA}/ask`, undefined],
      ] as const) {
        const reply = await d.call(method, path, path.startsWith("/app") ? { cookie, form: { question: "Who owns them?" } } : { cookie, body });
        expect([path, reply.status]).toEqual([path, 404]);
      }
    }
    expect([count(d.db, "notes"), count(d.db, "check_requests"), count(d.db, "supplier_list"), count(d.db, "activity")]).toEqual(before);
  });

  it("gets 404 cancelling another client's check request", async () => {
    const { d, world, cookieA, adminB } = await setUp();
    const made = await d.call("POST", `/suppliers/${world.onlyA}/check-requests`, { cookie: cookieA, body: { question: "Is their ISO certificate valid?" } });
    expect(made.status).toBe(201);
    const reply = await d.call("POST", `/check-requests/${made.body.check_request.id}/cancel`, { cookie: adminB });
    expect(reply.status).toBe(404);
    expect(d.db.prepare("SELECT status FROM check_requests WHERE id = ?").get(made.body.check_request.id)).toEqual({ status: "requested" });
  });

  it("sees only its own list", async () => {
    const { d, world, cookieB } = await setUp();
    const reply = await d.call("GET", "/list", { cookie: cookieB });
    const ids = reply.body.entries.map((e: { supplier_id: number }) => e.supplier_id);
    expect(ids).toHaveLength(count(d.db, "supplier_list WHERE client_id = ?", world.b.id));
    expect(ids).not.toContain(world.onlyA);
    expect(reply.body.client.id).toBe(world.b.id);
  });

  it("sees the shared file for a supplier both list, but only its own entry, notes and requests", async () => {
    const { d, world, cookieA, cookieB } = await setUp();
    await d.call("POST", `/suppliers/${world.shared}/notes`, { cookie: cookieA, body: { body: "Client A private note." } });
    await d.call("POST", `/suppliers/${world.shared}/check-requests`, { cookie: cookieA, body: { question: "Client A private question?" } });
    const reply = await d.call("GET", `/suppliers/${world.shared}`, { cookie: cookieB });
    expect(reply.status).toBe(200);
    expect(reply.body.facts.length).toBe(count(d.db, "facts WHERE supplier_id = ?", world.shared));
    expect(reply.body.calls.length).toBe(count(d.db, "calls WHERE supplier_id = ?", world.shared));
    expect(reply.body.entry.client_id).toBe(world.b.id);
    expect(reply.body.notes.length).toBe(count(d.db, "notes WHERE client_id = ? AND supplier_id = ?", world.b.id, world.shared));
    expect(reply.body.check_requests.length).toBe(count(d.db, "check_requests WHERE client_id = ? AND supplier_id = ?", world.b.id, world.shared));
    expect(JSON.stringify(reply.body)).not.toContain("Client A private");
  });

  it("adds users only to its own client and cannot name another client", async () => {
    const { d, world, adminB } = await setUp();
    const made = await d.call("POST", "/client-users", {
      cookie: adminB,
      body: { name: "Rosa Lindgard", email: "rosa.lindgard@example.test", password: "long-enough-pass", role: "buyer" },
    });
    expect(made.status).toBe(201);
    expect(made.body.user.client_id).toBe(world.b.id);
    const steered = await d.call("POST", "/client-users", {
      cookie: adminB,
      body: { name: "Rosa Two", email: "rosa.two@example.test", password: "long-enough-pass", role: "buyer", client_id: world.a.id },
    });
    expect(steered.status).toBe(400);
    expect(count(d.db, "client_users WHERE email = 'rosa.two@example.test'")).toBe(0);
  });

  it("cannot write facts or calls, even for a supplier on its list", async () => {
    const { d, world, cookieB } = await setUp();
    const fact = await d.call("POST", `/staff/suppliers/${world.shared}/facts`, {
      cookie: cookieB,
      body: { field: "ownership", value: "Family owned", checked_on: "2026-09-01", note: "our buyer" },
    });
    const call = await d.call("POST", `/staff/suppliers/${world.shared}/calls`, {
      cookie: cookieB,
      body: { contact_name: "Pat Doe", contact_title: "Sales", held_on: "2026-09-01", write_up: "Hello." },
    });
    expect([fact.status, call.status]).toEqual([403, 403]);
    for (const path of ["/staff/suppliers", "/staff/check-requests", "/staff/clients", `/staff/suppliers/${world.onlyA}`]) {
      expect((await d.call("GET", path, { cookie: cookieB })).status).toBe(403);
    }
  });

  it("asks the assistant about a shared supplier and its tools read and write only its own entry", async () => {
    let history: { entry: { client_id: number }; notes: unknown[]; check_requests: unknown[] } | undefined;
    const { model } = scriptedModel((req, n) => {
      if (n === 1) return { content: null, tool_calls: [toolCall("h", "our_history", {}), toolCall("s", "save_note", { body: "Asked about ownership." })] };
      history = JSON.parse(req.messages.find((m) => m.role === "tool")?.content ?? "{}");
      return { content: "Done.", tool_calls: [] };
    });
    const { d, world, cookieA, cookieB } = await setUp(model);
    await d.call("POST", `/suppliers/${world.shared}/notes`, { cookie: cookieA, body: { body: "Client A private note." } });
    const reply = await d.call("POST", `/assistant/suppliers/${world.shared}`, { cookie: cookieB, body: { question: "What do we have?" } });
    expect(reply.status).toBe(200);
    expect(history?.entry.client_id).toBe(world.b.id);
    expect(JSON.stringify(history)).not.toContain("Client A private");
    expect(d.db.prepare("SELECT client_id, author_user_id FROM notes ORDER BY id DESC LIMIT 1").get()).toEqual({
      client_id: world.b.id,
      author_user_id: world.b.buyer.id,
    });
  });

  it("is not a staff member: client routes refuse staff with 403 and staff see every client", async () => {
    const { d, world } = await setUp();
    const staff = await d.signIn(ANALYST);
    expect((await d.call("GET", "/list", { cookie: staff })).status).toBe(403);
    expect((await d.call("POST", `/assistant/suppliers/${world.shared}`, { cookie: staff, body: { question: "Hi?" } })).status).toBe(403);
    const file = await d.call("GET", `/staff/suppliers/${world.shared}`, { cookie: staff });
    expect(file.body.lists.map((l: { client_id: number }) => l.client_id)).toEqual(expect.arrayContaining([world.a.id, world.b.id]));
  });
});
