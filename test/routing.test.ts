import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANALYST, openDesk, twoClients, type Desk } from "./helpers.js";

let desk: Desk;
let world: ReturnType<typeof twoClients>;
beforeEach(async () => {
  desk = await openDesk();
  world = twoClients(desk.db);
});
afterEach(() => desk.close());

const otherClients = (d: Desk, clientId: number) =>
  (d.db.prepare("SELECT name FROM clients WHERE id <> ?").all(clientId) as { name: string }[]).map((c) => c.name);

describe("paths are matched with their case, and each page and route group serves only its own kind of user", () => {
  it("a client user gets no staff page or staff route under any spelling", async () => {
    const cookie = await desk.signIn(world.a.buyer.email);
    const hidden = otherClients(desk, world.a.id);
    for (const path of ["/desk", "/Desk", "/DESK", "/Desk/suppliers", "/Desk/suppliers/11", "/Desk/additions", "/dEsK/activity", "/desk/activity", "/desk/suppliers/11"]) {
      const reply = await desk.call("GET", path, { cookie });
      expect([path, reply.status === 303 || reply.status === 404]).toEqual([path, true]);
      expect(hidden.some((name) => String(JSON.stringify(reply.body)).includes(name))).toBe(false);
    }
    for (const path of ["/Staff/suppliers", "/STAFF/clients", "/staff/Activity", "/staff/activity", "/staff/suppliers/11"]) {
      const reply = await desk.call("GET", path, { cookie });
      expect([path, reply.status === 403 || reply.status === 404]).toEqual([path, true]);
    }
    for (const path of ["/Desk/check-requests/1/assign", "/DESK/additions/1/decline"]) {
      const reply = await desk.call("POST", path, { cookie, form: { analyst_id: "2", decision_note: "x" } });
      expect([path, reply.status === 303 || reply.status === 404]).toEqual([path, true]);
    }
  });

  it("a staff member gets no client page or client route under any spelling, and never a 500", async () => {
    const cookie = await desk.signIn(ANALYST);
    for (const path of ["/app", "/App", "/APP", "/App/suppliers/11", "/aPp/suppliers/11"]) {
      const reply = await desk.call("GET", path, { cookie });
      expect([path, reply.status === 303 || reply.status === 404]).toEqual([path, true]);
    }
    for (const path of ["/App/additions", "/app/additions", "/APP/suppliers/11/notes"]) {
      const reply = await desk.call("POST", path, { cookie, form: { name: "Odd Co", city: "Gable Mills", state: "KY", spend_band: "under_100k", body: "x" } });
      expect([path, reply.status === 303 || reply.status === 404]).toEqual([path, true]);
    }
    for (const [method, path] of [
      ["GET", "/List"],
      ["GET", "/list"],
      ["GET", "/Suppliers/11"],
      ["POST", "/Assistant/suppliers/11"],
      ["POST", "/assistant/suppliers/11"],
      ["GET", "/Addition-requests"],
    ] as const) {
      const reply = await desk.call(method, path, { cookie, body: { question: "Hi?" } });
      expect([path, reply.status === 403 || reply.status === 404]).toEqual([path, true]);
    }
  });

  it("a path spelled with other capitals is not the same page or route", async () => {
    const staff = await desk.signIn(ANALYST);
    expect((await desk.call("GET", "/desk", { cookie: staff })).status).toBe(200);
    expect((await desk.call("GET", "/DESK", { cookie: staff })).status).toBe(404);
    expect((await desk.call("GET", "/staff/suppliers", { cookie: staff })).status).toBe(200);
    expect((await desk.call("GET", "/Staff/Suppliers", { cookie: staff })).status).toBe(404);
  });

  it("a buyer cannot reach client-admin routes under another spelling", async () => {
    const cookie = await desk.signIn(world.a.buyer.email);
    for (const path of ["/Client-users", "/client-users"]) {
      const reply = await desk.call("GET", path, { cookie });
      expect([path, reply.status === 403 || reply.status === 404]).toEqual([path, true]);
    }
  });
});
