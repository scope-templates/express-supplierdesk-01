import { afterEach, describe, expect, it } from "vitest";
import { ANALYST, LEAD, PASSWORD, count, openDesk, scriptedModel, toolCall, twoClients, type Desk } from "./helpers.js";

let desk: Desk | undefined;
afterEach(async () => {
  await desk?.close();
  desk = undefined;
});

async function signInByForm(d: Desk, email: string, home: string, password = PASSWORD): Promise<string> {
  const reply = await d.call("POST", "/sign-in", { form: { email, password } });
  expect([reply.status, reply.headers.location]).toEqual([303, home]);
  return String(([] as string[]).concat(reply.headers["set-cookie"] ?? [])[0]).split(";")[0] as string;
}

const html = (reply: { headers: Record<string, unknown> }) => expect(String(reply.headers["content-type"])).toContain("text/html");

describe("sign-in pages", () => {
  it("sends / and unsigned pages to sign-in", async () => {
    desk = await openDesk();
    for (const path of ["/", "/app", "/desk", "/password"]) {
      const reply = await desk.call("GET", path);
      expect([reply.status, reply.headers.location]).toEqual([303, "/sign-in"]);
    }
    expect((await desk.call("GET", "/sign-in")).body).toContain('action="/sign-in"');
  });

  it("signs client users in to /app and staff to /desk, and keeps each out of the other's pages", async () => {
    desk = await openDesk();
    const world = twoClients(desk.db);
    const client = await signInByForm(desk, world.a.buyer.email, "/app");
    const staff = await signInByForm(desk, ANALYST, "/desk");
    expect((await desk.call("GET", "/desk", { cookie: client })).headers.location).toBe("/sign-in");
    expect((await desk.call("GET", "/app", { cookie: staff })).headers.location).toBe("/sign-in");
    const wrong = await desk.call("POST", "/sign-in", { form: { email: world.a.buyer.email, password: "wrong-password" } });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toContain("That email and password do not match a user.");
  });

  it("refuses form posts that come from another site or say nothing about where they come from", async () => {
    desk = await openDesk();
    for (const origin of [null, "http://elsewhere.test"]) {
      const reply = await desk.call("POST", "/sign-in", { form: { email: ANALYST, password: PASSWORD }, origin });
      expect(reply.status).toBe(403);
      html(reply);
      expect(reply.body).toContain("This form was posted from another site.");
    }
  });

  it("changes a password from the password page and signs out", async () => {
    desk = await openDesk();
    const cookie = await signInByForm(desk, ANALYST, "/desk");
    const changed = await desk.call("POST", "/password", { cookie, form: { password: PASSWORD, new_password: "page-changed-pass" } });
    expect(changed.body).toContain("Password changed.");
    const out = await desk.call("POST", "/sign-out", { cookie, form: {} });
    expect([out.status, out.headers.location]).toEqual([303, "/sign-in"]);
    expect((await desk.call("GET", "/desk", { cookie })).headers.location).toBe("/sign-in");
    await signInByForm(desk, ANALYST, "/desk", "page-changed-pass");
  });
});

describe("client pages", () => {
  it("lists the client's suppliers by status and asks Tessary to add a supplier", async () => {
    desk = await openDesk();
    const world = twoClients(desk.db);
    const cookie = await signInByForm(desk, world.a.buyer.email, "/app");
    const list = await desk.call("GET", "/app", { cookie });
    for (const heading of ["Approved", "Onboarding", "On hold", "Dropped", "Add a supplier"]) expect(list.body).toContain(`<h2>${heading}`);
    expect(list.body.match(/href="\/app\/suppliers\/\d+"/g)).toHaveLength(count(desk.db, "supplier_list WHERE client_id = ?", world.a.id));
    const added = await desk.call("POST", "/app/additions", { cookie, form: { name: "Rennick Tube Works", city: "Gable Mills", state: "KY", spend_band: "under_100k", note: "" } });
    expect([added.status, added.headers.location]).toEqual([303, "/app"]);
    expect((await desk.call("GET", "/app", { cookie })).body).toContain("Rennick Tube Works");
  });

  it("shows a supplier and acts on it: status, note, check request, cancel", async () => {
    desk = await openDesk();
    const world = twoClients(desk.db);
    const cookie = await signInByForm(desk, world.a.buyer.email, "/app");
    const base = `/app/suppliers/${world.onlyA}`;
    const shown = await desk.call("GET", base, { cookie });
    expect(shown.body).toContain("<th>Checked on</th>");
    expect(shown.body).toContain(`action="${base}/ask"`);
    expect((await desk.call("POST", `${base}/entry`, { cookie, form: { status: "on_hold", spend_band: "over_2m" } })).headers.location).toBe(base);
    await desk.call("POST", `${base}/notes`, { cookie, form: { body: "<b>bold</b>" } });
    await desk.call("POST", `${base}/check-requests`, { cookie, form: { question: "Who owns them?" } });
    const after = await desk.call("GET", base, { cookie });
    expect(after.body).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(after.body).toContain('<option value="on_hold" selected>');
    const request = desk.db.prepare("SELECT id FROM check_requests WHERE client_id = ? AND supplier_id = ? AND status = 'requested'").get(world.a.id, world.onlyA) as { id: number };
    expect(after.body).toContain(`action="/app/check-requests/${request.id}/cancel"`);
    await desk.call("POST", `/app/check-requests/${request.id}/cancel`, { cookie, form: {} });
    expect(desk.db.prepare("SELECT status FROM check_requests WHERE id = ?").get(request.id)).toEqual({ status: "cancelled" });
  });

  it("answers page errors as HTML: an off-list supplier, a missing page, a refused move", async () => {
    desk = await openDesk();
    const world = twoClients(desk.db);
    const cookie = await signInByForm(desk, world.b.buyer.email, "/app");
    for (const [method, path] of [
      ["GET", `/app/suppliers/${world.onlyA}`],
      ["POST", `/app/suppliers/${world.onlyA}/notes`],
      ["GET", "/app/nowhere"],
    ] as const) {
      const reply = await desk.call(method, path, { cookie, form: method === "POST" ? { body: "x" } : undefined });
      expect(reply.status).toBe(404);
      html(reply);
    }
    for (const reply of [await desk.call("GET", "/sign-in/elsewhere"), await desk.call("GET", "/password/x", { cookie })]) {
      expect(reply.status).toBe(404);
      html(reply);
    }
    const json = await desk.call("POST", "/app/additions", { cookie, body: { name: "Json Co" } });
    expect(json.status).toBe(403);
    html(json);
    const bad = await desk.call("POST", `/app/suppliers/${world.shared}/entry`, { cookie, form: { status: "archived", spend_band: "over_2m" } });
    expect(bad.status).toBe(400);
    html(bad);
  });

  it("posts a question to the assistant and shows the answer and the tool calls under it", async () => {
    const { model } = scriptedModel((_req, n) =>
      n === 1 ? { content: null, tool_calls: [toolCall("f", "facts", { field: "plants" })] } : { content: "Two plants, checked in 2026.", tool_calls: [] },
    );
    desk = await openDesk(model);
    const world = twoClients(desk.db);
    const cookie = await signInByForm(desk, world.a.buyer.email, "/app");
    const reply = await desk.call("POST", `/app/suppliers/${world.shared}/ask`, { cookie, form: { question: "Where are the plants?" } });
    expect(reply.status).toBe(200);
    expect(reply.body).toContain('<div class="answer">Two plants, checked in 2026.</div>');
    expect(reply.body).toContain("<code>facts {&quot;field&quot;:&quot;plants&quot;}</code>");
    const long = await desk.call("POST", `/app/suppliers/${world.shared}/ask`, { cookie, form: { question: "x".repeat(2_001) } });
    expect([long.status, long.body.includes("Questions run up to 2,000 characters.")]).toEqual([400, true]);
  });

  it("shows the assistant's 503 when model settings are unset", async () => {
    desk = await openDesk(null);
    const world = twoClients(desk.db);
    const cookie = await signInByForm(desk, world.a.buyer.email, "/app");
    const reply = await desk.call("POST", `/app/suppliers/${world.shared}/ask`, { cookie, form: { question: "Anything?" } });
    expect(reply.status).toBe(503);
    expect(reply.body).toContain("The assistant needs MODEL_BASE_URL, MODEL_API_KEY and MODEL_NAME set.");
  });
});

describe("staff pages", () => {
  it("lets the lead assign and the assigned analyst answer from the queue", async () => {
    desk = await openDesk();
    const world = twoClients(desk.db);
    const client = await desk.signIn(world.a.buyer.email);
    const made = await desk.call("POST", `/suppliers/${world.onlyA}/check-requests`, { cookie: client, body: { question: "Plants?" } });
    const id = made.body.check_request.id;
    const lead = await signInByForm(desk, LEAD, "/desk");
    const analyst = await signInByForm(desk, ANALYST, "/desk");
    expect((await desk.call("GET", "/desk", { cookie: lead })).body).toContain(`action="/desk/check-requests/${id}/assign"`);
    const refused = await desk.call("POST", `/desk/check-requests/${id}/assign`, { cookie: analyst, form: { analyst_id: "2" } });
    expect(refused.status).toBe(403);
    html(refused);
    await desk.call("POST", `/desk/check-requests/${id}/assign`, { cookie: lead, form: { analyst_id: "2" } });
    expect((await desk.call("GET", "/desk", { cookie: analyst })).body).toContain(`action="/desk/check-requests/${id}/answer"`);
    await desk.call("POST", `/desk/check-requests/${id}/answer`, { cookie: analyst, form: { note: "Three plants, per their plant manager." } });
    expect(desk.db.prepare("SELECT status FROM check_requests WHERE id = ?").get(id)).toEqual({ status: "answered" });
  });

  it("searches the file, adds a fact and a call from a supplier page, and shows recent activity", async () => {
    desk = await openDesk();
    const cookie = await signInByForm(desk, ANALYST, "/desk");
    const name = (desk.db.prepare("SELECT name FROM suppliers WHERE id = 3").get() as { name: string }).name;
    expect((await desk.call("GET", `/desk/suppliers?q=${encodeURIComponent(name)}`, { cookie })).body).toContain('href="/desk/suppliers/3"');
    await desk.call("POST", "/desk/suppliers/3/facts", { cookie, form: { field: "headcount", value: "About 210", checked_on: "2026-09-30", note: "careers page" } });
    await desk.call("POST", "/desk/suppliers/3/calls", { cookie, form: { contact_name: "Ada Brisk", contact_title: "Plant Manager", held_on: "2026-09-30", write_up: "Short call." } });
    const page = await desk.call("GET", "/desk/suppliers/3", { cookie });
    expect(page.body).toContain("About 210");
    expect(page.body).toContain("Ada Brisk, Plant Manager");
    const activity = await desk.call("GET", "/desk/activity", { cookie });
    expect(activity.body).toContain("call.added");
    expect(activity.body).toContain("Marcus Oyelaran");
  });

  it("links, adds and declines addition requests from the additions page", async () => {
    desk = await openDesk();
    const world = twoClients(desk.db);
    const client = await desk.signIn(world.b.buyer.email);
    const ask = (name: string) => desk!.call("POST", "/list", { cookie: client, body: { name, city: "Gable Mills", state: "KY", spend_band: "under_100k" } });
    const existing = (desk.db.prepare("SELECT name FROM suppliers WHERE id = ?").get(world.onlyA) as { name: string }).name;
    const [linkId, createId, declineId] = [(await ask(existing)).body, (await ask("Brightmoor Twine")).body, (await ask("Not A Real Shop")).body].map((b) => b.addition_request.id);
    const cookie = await signInByForm(desk, ANALYST, "/desk");
    const queue = await desk.call("GET", "/desk/additions", { cookie });
    expect(queue.body).toContain(`value="${world.onlyA}"`);
    await desk.call("POST", `/desk/additions/${linkId}/link`, { cookie, form: { supplier_id: String(world.onlyA) } });
    await desk.call("POST", `/desk/additions/${createId}/create`, { cookie, form: { name: "Brightmoor Twine", kind: "packaging", hq_city: "Gable Mills", hq_state: "KY" } });
    await desk.call("POST", `/desk/additions/${declineId}/decline`, { cookie, form: { decision_note: "No such business in Kentucky." } });
    const statuses = desk.db.prepare("SELECT status FROM addition_requests WHERE id IN (?, ?, ?) ORDER BY id").all(linkId, createId, declineId);
    expect(statuses).toEqual([{ status: "linked" }, { status: "linked" }, { status: "declined" }]);
    expect(count(desk.db, "supplier_list l JOIN suppliers s ON s.id = l.supplier_id WHERE l.client_id = ? AND s.name IN (?, 'Brightmoor Twine')", world.b.id, existing)).toBe(2);
  });
});
