import { afterEach, describe, expect, it, vi } from "vitest";
import { problemFrom } from "../src/problem.js";
import { ADMIN, ANALYST, PASSWORD, TODAY, count, openDesk, twoClients, type Desk } from "./helpers.js";

let desk: Desk | undefined;
afterEach(async () => {
  await desk?.close();
  desk = undefined;
});

const cookieOf = (reply: { headers: Record<string, string | string[] | undefined> }) => String(([] as string[]).concat(reply.headers["set-cookie"] ?? [])[0]);

describe("sessions", () => {
  it("signs in staff and client users by email and password into a stored session", async () => {
    desk = await openDesk();
    const staff = await desk.call("POST", "/session", { body: { email: ANALYST, password: PASSWORD } });
    expect(staff.status).toBe(200);
    expect(staff.body.user).toMatchObject({ kind: "staff", name: "Marcus Oyelaran", role: "analyst" });
    expect(cookieOf(staff)).toContain("HttpOnly; SameSite=Lax");
    expect(cookieOf(staff)).not.toContain("Secure");
    expect(count(desk.db, "sessions WHERE staff_id = 2 AND ended_at IS NULL")).toBe(1);
    const { a } = twoClients(desk.db);
    const client = await desk.call("POST", "/session", { body: { email: a.buyer.email.toUpperCase(), password: PASSWORD } });
    expect(client.body.user).toMatchObject({ kind: "client_user", client_id: a.id, role: "buyer" });
    expect(JSON.stringify(client.body)).not.toContain("scrypt");
  });

  it("adds Secure to the cookie when COOKIE_SECURE is on", async () => {
    desk = await openDesk(null, TODAY, true);
    const reply = await desk.call("POST", "/session", { body: { email: ANALYST, password: PASSWORD } });
    expect(cookieOf(reply)).toContain("; Secure");
  });

  it("answers a wrong password and an unknown email the same way", async () => {
    desk = await openDesk();
    const wrong = await desk.call("POST", "/session", { body: { email: ANALYST, password: "not-the-password" } });
    const unknown = await desk.call("POST", "/session", { body: { email: "nobody@elsewhere.test", password: PASSWORD } });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.code).toBe("bad_credentials");
  });

  it("refuses an email for a few minutes after five failed sign-ins, even with the right password", async () => {
    let clock = TODAY.getTime();
    desk = await openDesk(null, () => new Date(clock));
    for (let i = 0; i < 5; i++) {
      expect((await desk.call("POST", "/session", { body: { email: ANALYST, password: "wrong-password" } })).status).toBe(401);
    }
    const locked = await desk.call("POST", "/session", { body: { email: ANALYST, password: PASSWORD } });
    expect([locked.status, locked.body.code]).toEqual([429, "too_many_attempts"]);
    expect((await desk.call("POST", "/session", { body: { email: ADMIN, password: PASSWORD } })).status).toBe(200);
    clock += 6 * 60 * 1000;
    expect((await desk.call("POST", "/session", { body: { email: ANALYST, password: PASSWORD } })).status).toBe(200);
  });

  it("refuses sign-in for users of an ended client", async () => {
    desk = await openDesk();
    const ended = desk.db.prepare("SELECT u.email FROM client_users u JOIN clients c ON c.id = u.client_id WHERE c.status = 'ended' LIMIT 1").get() as {
      email: string;
    };
    const reply = await desk.call("POST", "/session", { body: { email: ended.email, password: PASSWORD } });
    expect([reply.status, reply.body.code]).toEqual([403, "client_ended"]);
  });

  it("ends a client user's sessions when their client is ended", async () => {
    desk = await openDesk();
    const { a } = twoClients(desk.db);
    const cookie = await desk.signIn(a.buyer.email);
    expect((await desk.call("GET", "/list", { cookie })).status).toBe(200);
    await desk.call("POST", `/staff/clients/${a.id}/end`, { cookie: await desk.signIn(ADMIN) });
    expect((await desk.call("GET", "/list", { cookie })).status).toBe(401);
    expect(count(desk.db, "sessions s JOIN client_users u ON u.id = s.client_user_id WHERE u.client_id = ? AND s.ended_at IS NULL", a.id)).toBe(0);
  });

  it("ends the session on DELETE /session so the cookie stops working", async () => {
    desk = await openDesk();
    const cookie = await desk.signIn(ANALYST);
    const reply = await desk.call("DELETE", "/session", { cookie });
    expect(reply.status).toBe(204);
    expect(cookieOf(reply)).toContain("Max-Age=0");
    expect((await desk.call("GET", "/staff/suppliers", { cookie })).status).toBe(401);
  });

  it("refuses requests without a session, with an unknown token, or after twelve hours", async () => {
    let clock = TODAY.getTime();
    desk = await openDesk(null, () => new Date(clock));
    const cookie = await desk.signIn(ANALYST);
    const forged = cookie.replace(/=.{5}/, "=AAAAA");
    for (const [method, path] of [
      ["GET", "/list"],
      ["GET", "/suppliers/1"],
      ["GET", "/staff/suppliers"],
      ["POST", "/staff/suppliers/1/facts"],
      ["POST", "/assistant/suppliers/1"],
    ] as const) {
      for (const c of [undefined, forged, "tessary_session=short"]) {
        expect((await desk.call(method, path, { body: {}, cookie: c })).status).toBe(401);
      }
    }
    clock += 11 * 3_600_000;
    expect((await desk.call("GET", "/staff/suppliers", { cookie })).status).toBe(200);
    clock += 2 * 3_600_000;
    expect((await desk.call("GET", "/staff/suppliers", { cookie })).status).toBe(401);
  });
});

describe("passwords and users", () => {
  it("changes a password when given the old one, ending the user's other sessions", async () => {
    desk = await openDesk();
    const first = await desk.signIn(ANALYST);
    const second = await desk.signIn(ANALYST);
    const wrong = await desk.call("POST", "/session/password", { cookie: first, body: { password: "nope", new_password: "a-brand-new-pass" } });
    expect([wrong.status, wrong.body.code]).toEqual([403, "wrong_password"]);
    const short = await desk.call("POST", "/session/password", { cookie: first, body: { password: PASSWORD, new_password: "short" } });
    expect(short.status).toBe(400);
    const ok = await desk.call("POST", "/session/password", { cookie: first, body: { password: PASSWORD, new_password: "a-brand-new-pass" } });
    expect(ok.status).toBe(200);
    expect((await desk.call("GET", "/staff/suppliers", { cookie: first })).status).toBe(200);
    expect((await desk.call("GET", "/staff/suppliers", { cookie: second })).status).toBe(401);
    expect((await desk.call("POST", "/session", { body: { email: ANALYST, password: PASSWORD } })).status).toBe(401);
    await desk.signIn(ANALYST, "a-brand-new-pass");
  });

  it("lets a client admin deactivate a user in their client, ending that user's sessions", async () => {
    desk = await openDesk();
    const { a, b } = twoClients(desk.db);
    const admin = await desk.signIn(a.admin.email);
    const buyer = await desk.signIn(a.buyer.email);
    expect((await desk.call("POST", `/client-users/${b.buyer.id}/deactivate`, { cookie: admin })).status).toBe(404);
    expect((await desk.call("POST", `/client-users/${a.admin.id}/deactivate`, { cookie: admin })).body.code).toBe("cannot_deactivate_self");
    expect((await desk.call("POST", `/client-users/${a.admin.id}/deactivate`, { cookie: buyer })).status).toBe(403);
    const reply = await desk.call("POST", `/client-users/${a.buyer.id}/deactivate`, { cookie: admin });
    expect(reply.body.user.deactivated_on).toBe("2026-10-01");
    expect((await desk.call("GET", "/list", { cookie: buyer })).status).toBe(401);
    expect(count(desk.db, "sessions WHERE client_user_id = ? AND ended_at IS NULL", a.buyer.id)).toBe(0);
    const again = await desk.call("POST", "/session", { body: { email: a.buyer.email, password: PASSWORD } });
    expect([again.status, again.body.code]).toEqual([403, "user_deactivated"]);
    expect((await desk.call("POST", `/client-users/${a.buyer.id}/deactivate`, { cookie: admin })).body.code).toBe("status_changed");
    expect((await desk.call("GET", "/client-users", { cookie: await desk.signIn(b.buyer.email) })).status).toBe(403);
    const users = await desk.call("GET", "/client-users", { cookie: admin });
    expect(users.body.users.map((u: { email: string }) => u.email)).not.toContain(b.buyer.email);
  });
});

describe("problems", () => {
  it("answers an oversized body with 413 and a form-encoded body on a JSON route with 400", async () => {
    desk = await openDesk();
    const cookie = await desk.signIn(ANALYST);
    const big = await desk.call("POST", "/staff/suppliers", { cookie, body: { name: "x".repeat(70_000) } });
    expect([big.status, big.body.code]).toEqual([413, "invalid_request"]);
    const form = await desk.call("POST", "/staff/suppliers", { cookie, form: { name: "Formed Co", kind: "freight", hq_city: "Gable Mills", hq_state: "KY" } });
    expect(form.status).toBe(400);
  });

  it("answers problems as application/problem+json, including unknown routes", async () => {
    desk = await openDesk();
    const cookie = await desk.signIn(ANALYST);
    const reply = await desk.call("GET", "/staff/suppliers/999999", { cookie });
    expect(reply.status).toBe(404);
    expect(reply.headers["content-type"]).toContain("application/problem+json");
    expect(reply.body).toMatchObject({ status: 404, code: "not_found" });
    expect((await desk.call("GET", "/nowhere", { cookie })).body.code).toBe("not_found");
  });

  it("turns an unexpected error into 500 internal_error", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const problem = problemFrom(new TypeError("boom"));
    expect([problem.status, problem.code]).toEqual([500, "internal_error"]);
    expect(problem.message).not.toContain("boom");
    logged.mockRestore();
  });
});
