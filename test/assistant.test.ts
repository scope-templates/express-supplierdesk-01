import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  MAX_MODEL_CALLS,
  MAX_QUESTION_TOOL_CHARS,
  MAX_TOOL_CALLS_PER_QUESTION,
  askAboutSupplier,
} from "../src/assistant/loop.js";
import { ModelCallFailed, type ChatModel } from "../src/assistant/model.js";
import { QUESTIONS_PER_HOUR } from "../src/routes/assistant.js";
import { MAX_TOOL_RESULT_CHARS, TOOLS, toolMessage, toolSpecs } from "../src/assistant/tools.js";
import type { ClientActor } from "../src/records.js";
import { ANALYST, TODAY, count, openDesk, scriptedModel, toolCall, twoClients, type Desk } from "./helpers.js";

const TOOL_NAMES = ["supplier_profile", "facts", "calls", "our_history", "save_note"];

let desk: Desk | undefined;
afterEach(async () => {
  await desk?.close();
  desk = undefined;
});

async function ask(d: Desk, question: string, supplierId?: number) {
  const world = twoClients(d.db);
  const cookie = await d.signIn(world.a.buyer.email);
  const reply = await d.call("POST", `/assistant/suppliers/${supplierId ?? world.shared}`, { cookie, body: { question } });
  return { reply, world };
}

function addFacts(d: Desk, supplierId: number, n: number) {
  const insert = d.db.prepare(
    "INSERT INTO facts (supplier_id, field, value, checked_on, checked_by, note) VALUES (?, 'recent_change', ?, '2026-01-05', 2, 'trade show booth chat')",
  );
  for (let i = 0; i < n; i++) insert.run(supplierId, `Added a press line ${i} and a second shift at the stamping plant`);
}

describe("assistant route without model settings", () => {
  it("answers 503 assistant_unconfigured while every other route works", async () => {
    desk = await openDesk(null);
    const world = twoClients(desk.db);
    const cookie = await desk.signIn(world.a.buyer.email);
    const closed = await desk.call("POST", `/assistant/suppliers/${world.shared}`, { cookie, body: { question: "Who owns them?" } });
    expect(closed.status).toBe(503);
    expect(closed.headers["content-type"]).toContain("application/problem+json");
    expect(closed.body).toMatchObject({ status: 503, code: "assistant_unconfigured" });
    expect((await desk.call("GET", "/list", { cookie })).status).toBe(200);
    expect((await desk.call("GET", `/suppliers/${world.shared}`, { cookie })).status).toBe(200);
    expect((await desk.call("POST", `/suppliers/${world.shared}/notes`, { cookie, body: { body: "Fine." } })).status).toBe(201);
    const staff = await desk.signIn(ANALYST);
    const fact = await desk.call("POST", `/staff/suppliers/${world.shared}/facts`, {
      cookie: staff,
      body: { field: "ownership", value: "Family owned", checked_on: "2026-09-01", note: "state filing" },
    });
    expect(fact.status).toBe(201);
  });
});

describe("assistant loop", () => {
  it("offers the desk's tools and returns the answer with the tool calls it made", async () => {
    const { model, requests } = scriptedModel((_req, n) =>
      n === 1
        ? { content: null, tool_calls: [toolCall("a", "supplier_profile", {}), toolCall("b", "facts", { field: "ownership" })] }
        : { content: "Family owned, checked in 2026.", tool_calls: [] },
    );
    desk = await openDesk(model);
    const { reply, world } = await ask(desk, "Who owns them?");
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      answer: "Family owned, checked in 2026.",
      tool_calls: [
        { name: "supplier_profile", arguments: {} },
        { name: "facts", arguments: { field: "ownership" } },
      ],
    });
    for (const request of requests) {
      expect(request.tools.map((t) => t.function.name)).toEqual(expect.arrayContaining(TOOL_NAMES));
    }
    expect(requests[0]?.messages[0]).toMatchObject({ role: "system" });
    expect(requests[0]?.messages[0]?.content).toContain("Today is 2026-10-01.");
    const results = (requests[1]?.messages.filter((m) => m.role === "tool") ?? []).map((m) => JSON.parse(m.content));
    expect(results[0].supplier.id).toBe(world.shared);
    expect(results[1].facts.every((f: { field: string; checked_on: string; checked_by_name: string; note: string }) => f.field === "ownership" && f.checked_on && f.checked_by_name && f.note)).toBe(true);
  });

  it("makes at most six model calls; the sixth keeps the tools, sends tool_choice none, and its text is the answer", async () => {
    const { model, requests } = scriptedModel((req, n) =>
      req.tool_choice === "none"
        ? { content: "Here is what the supplier file says.", tool_calls: [] }
        : { content: null, tool_calls: [toolCall(`c${n}`, "calls", {})] },
    );
    desk = await openDesk(model);
    const { reply } = await ask(desk, "Summarize the calls.");
    expect(MAX_MODEL_CALLS).toBe(6);
    expect(requests).toHaveLength(6);
    expect(requests[5]?.tools.map((t) => t.function.name)).toEqual(expect.arrayContaining(TOOL_NAMES));
    expect(requests[5]?.tool_choice).toBe("none");
    expect(reply.body.answer).toBe("Here is what the supplier file says.");
    expect(reply.body.tool_calls).toHaveLength(5);
  });

  it("stops at six calls with a text answer when the model returns tool calls every time", async () => {
    const { model, requests } = scriptedModel((_req, n) => ({ content: `Pass ${n}.`, tool_calls: [toolCall(`c${n}`, "supplier_profile", {})] }));
    desk = await openDesk(model);
    const { reply } = await ask(desk, "Anything?");
    expect(requests).toHaveLength(6);
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ answer: "Pass 6." });
    expect(reply.body.tool_calls).toHaveLength(5);
  });

  it("answers 502 for an empty final answer and never falls back to an earlier turn's text", async () => {
    const { model } = scriptedModel((_req, n) =>
      n === 1 ? { content: "Looking at the facts first.", tool_calls: [toolCall("a", "facts", {})] } : { content: "  ", tool_calls: [] },
    );
    desk = await openDesk(model);
    const { reply } = await ask(desk, "Who runs it?");
    expect([reply.status, reply.body.code]).toEqual([502, "model_call_failed"]);
    expect(JSON.stringify(reply.body)).not.toContain("Looking at the facts first.");
  });

  it("answers 502 when the model endpoint fails", async () => {
    const failing: ChatModel = {
      async complete() {
        throw new ModelCallFailed("The model endpoint answered 500.");
      },
    };
    desk = await openDesk(failing);
    const { reply } = await ask(desk, "Anything?");
    expect([reply.status, reply.body.code]).toEqual([502, "model_call_failed"]);
  });

  it("stops before the next model call once the question's signal is aborted", async () => {
    const { model, requests } = scriptedModel(() => ({ content: null, tool_calls: [toolCall("a", "supplier_profile", {})] }));
    desk = await openDesk(model);
    const world = twoClients(desk.db);
    const actor: ClientActor = { kind: "client_user", ...world.a.buyer, role: "buyer", client_id: world.a.id, client_name: "A" };
    const ctx = { db: desk.db, supplierId: world.shared, actor, now: () => TODAY };
    await expect(askAboutSupplier(model, ctx, "Anything?", AbortSignal.abort())).rejects.toThrow(ModelCallFailed);
    expect(requests).toHaveLength(0);
  });

  it("refuses a tool call for another supplier, logs scope_refused with the asker as actor, and carries on", async () => {
    let errors: unknown;
    const { model, requests } = scriptedModel((req, n) => {
      if (n === 1) {
        return {
          content: null,
          tool_calls: [
            toolCall("x", "facts", { supplier_id: 1 }),
            toolCall("y", "our_history", { supplier_id: "1" }),
            toolCall("z", "supplier_profile", { supplier_id: 999999 }),
          ],
        };
      }
      errors = req.messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content).error);
      return { content: "Only this supplier's records were read.", tool_calls: [] };
    });
    desk = await openDesk(model);
    const { reply, world } = await ask(desk, "What about the other one?");
    expect(world.shared).not.toBe(1);
    expect(reply.status).toBe(200);
    expect(requests).toHaveLength(2);
    expect(errors).toEqual(["scope_refused", "scope_refused", "scope_refused"]);
    const logged = desk.db.prepare("SELECT actor_kind, client_user_id, client_id, subject FROM activity WHERE action = 'scope_refused' ORDER BY id").all();
    expect(logged).toEqual(
      [1, 1, 999999].map((id) => ({
        actor_kind: "client_user",
        client_user_id: world.a.buyer.id,
        client_id: world.a.id,
        subject: `supplier:${world.shared} asked supplier:${id}`,
      })),
    );
  });

  it("accepts the supplier's own id as a number or a numeric string", async () => {
    let results: unknown[] = [];
    const world = { shared: 0 };
    const { model } = scriptedModel((req, n) => {
      if (n === 1) {
        return {
          content: null,
          tool_calls: [toolCall("a", "supplier_profile", { supplier_id: world.shared }), toolCall("b", "supplier_profile", { supplier_id: String(world.shared) })],
        };
      }
      results = req.messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content).supplier?.id);
      return { content: "Done.", tool_calls: [] };
    });
    desk = await openDesk(model);
    world.shared = twoClients(desk.db).shared;
    await ask(desk, "Profile?");
    expect(results).toEqual([world.shared, world.shared]);
  });

  it("answers every tool call: unknown tools, unreadable arguments and arguments outside a tool's list get errors", async () => {
    let errors: unknown;
    const { model } = scriptedModel((req, n) => {
      if (n === 1) {
        return {
          content: null,
          tool_calls: [
            toolCall("u", "shipping_quote", {}),
            { id: "v", type: "function", function: { name: "facts", arguments: "{not json" } },
            toolCall("w", "facts", { field: "favorite_color" }),
            toolCall("x", "calls", { limit: 500 }),
          ],
        };
      }
      errors = req.messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content).error);
      return { content: "Done.", tool_calls: [] };
    });
    desk = await openDesk(model);
    const { reply } = await ask(desk, "Anything?");
    expect(errors).toEqual(["unknown_tool", "invalid_arguments", "invalid_arguments", "invalid_arguments"]);
    expect(reply.body.tool_calls[1]).toEqual({ name: "facts", arguments: "{not json" });
  });

  it("save_note writes one note per question on the asker's own entry; calls past eight in one reply are dropped, not sent back", async () => {
    let results: string[] = [];
    let kept: number | undefined;
    const { model, requests } = scriptedModel((req, n) => {
      if (n === 1) return { content: null, tool_calls: Array.from({ length: 10 }, (_, i) => toolCall(`s${i}`, "save_note", { body: `Note ${i}` })) };
      results = req.messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content).error ?? "saved");
      const assistant = req.messages.find((m) => m.role === "assistant");
      kept = assistant && "tool_calls" in assistant ? assistant.tool_calls?.length : undefined;
      return { content: "Saved.", tool_calls: [] };
    });
    desk = await openDesk(model);
    const before = count(desk.db, "notes");
    const { reply, world } = await ask(desk, "Save these.");
    expect(results).toEqual(["saved", ...Array.from({ length: 7 }, () => "note_already_saved")]);
    expect(kept).toBe(8);
    expect(reply.body.tool_calls).toHaveLength(8);
    expect(requests).toHaveLength(2);
    expect(count(desk.db, "notes")).toBe(before + 1);
    expect(desk.db.prepare("SELECT client_id, supplier_id, author_user_id, body FROM notes ORDER BY id DESC LIMIT 1").get()).toEqual({
      client_id: world.a.id,
      supplier_id: world.shared,
      author_user_id: world.a.buyer.id,
      body: "Note 0",
    });
    expect(desk.db.prepare("SELECT action, client_user_id FROM activity ORDER BY id DESC LIMIT 1").get()).toEqual({
      action: "note.added",
      client_user_id: world.a.buyer.id,
    });
  });

  it("runs at most the per-question total of tool calls, then makes its last call with tool use stopped", async () => {
    const { model, requests } = scriptedModel((req, n) =>
      req.tool_choice === "none"
        ? { content: "Done.", tool_calls: [] }
        : { content: null, tool_calls: Array.from({ length: 12 }, (_, i) => toolCall(`p${n}-${i}`, "supplier_profile", {})) },
    );
    desk = await openDesk(model);
    const { reply } = await ask(desk, "Again and again?");
    expect(reply.body.tool_calls).toHaveLength(MAX_TOOL_CALLS_PER_QUESTION);
    const last = requests.at(-1)!;
    expect(last.tool_choice).toBe("none");
    expect(last.messages.filter((m) => m.role === "tool")).toHaveLength(MAX_TOOL_CALLS_PER_QUESTION);
    expect(last.messages.filter((m) => m.role === "tool").every((m) => JSON.parse(m.content).supplier)).toBe(true);
    expect(requests).toHaveLength(4);
  });

  it("cuts large fact results, keeping the newest rows, and stops a question's tool results at its total", async () => {
    let sent: { facts?: { id: number }[]; trimmed?: boolean; error?: string }[] = [];
    const { model } = scriptedModel((req, n) => {
      if (n === 1) return { content: null, tool_calls: Array.from({ length: 8 }, (_, i) => toolCall(`f${i}`, "facts", {})) };
      sent = req.messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content));
      return { content: "Done.", tool_calls: [] };
    });
    desk = await openDesk(model);
    const world = twoClients(desk.db);
    addFacts(desk, world.shared, 400);
    await ask(desk, "What do we hold?");
    expect(sent[0]).toMatchObject({ trimmed: true });
    expect(JSON.stringify(sent[0]).length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    const newest = desk.db.prepare("SELECT max(id) AS id FROM facts").get() as { id: number };
    expect(sent[0]?.facts?.some((f) => f.id === newest.id)).toBe(true);
    expect(sent.at(-1)?.error).toBe("question_context_full");
    expect(MAX_QUESTION_TOOL_CHARS).toBeLessThan(8 * MAX_TOOL_RESULT_CHARS);
  });

  it("cuts a large tool result down before it goes back to the model", () => {
    const rows = Array.from({ length: 2_000 }, (_, i) => ({ id: i, value: "x".repeat(40) }));
    const text = toolMessage({ facts: rows });
    expect(text.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(JSON.parse(text)).toMatchObject({ trimmed: true });
    expect(toolMessage({ facts: rows.slice(0, 3) })).toBe(JSON.stringify({ facts: rows.slice(0, 3) }));
    expect(toolSpecs().map((t) => t.function.name)).toEqual(expect.arrayContaining(TOOL_NAMES));
  });

  it("aborts the model call when the caller hangs up", async () => {
    let aborted: (() => void) | undefined;
    const sawAbort = new Promise<void>((resolve) => (aborted = resolve));
    let started: (() => void) | undefined;
    const calling = new Promise<void>((resolve) => (started = resolve));
    const waiting: ChatModel = {
      complete({ signal }) {
        started?.();
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            aborted?.();
            reject(new ModelCallFailed("aborted"));
          });
        });
      },
    };
    desk = await openDesk(waiting);
    const world = twoClients(desk.db);
    const cookie = await desk.signIn(world.a.buyer.email);
    const payload = JSON.stringify({ question: "Anything?" });
    const req = httpRequest({
      host: "127.0.0.1",
      port: desk.port,
      method: "POST",
      path: `/assistant/suppliers/${world.shared}`,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), cookie },
    });
    req.on("error", () => {});
    req.end(payload);
    await calling;
    req.destroy();
    await sawAbort;
  });

  it("runs a tool outside the desk's five with its own arguments and no supplier scope check", async () => {
    TOOLS.lead_times = {
      spec: { type: "function", function: { name: "lead_times", description: "Quoted lead times.", parameters: { type: "object", properties: { supplier_id: { type: "integer" } } } } },
      args: z.object({ supplier_id: z.number() }).strict(),
      scopedToSupplier: false,
      run: async (_ctx, args) => ({ supplier_id: args.supplier_id, weeks: 6 }),
    };
    try {
      let result: unknown;
      const { model, requests } = scriptedModel((req, n) => {
        if (n === 1) return { content: null, tool_calls: [toolCall("l", "lead_times", { supplier_id: 1 })] };
        result = JSON.parse(req.messages.at(-1)?.content ?? "{}");
        return { content: "Six weeks.", tool_calls: [] };
      });
      desk = await openDesk(model);
      await ask(desk, "Lead times?");
      expect(result).toEqual({ supplier_id: 1, weeks: 6 });
      expect(requests[0]?.tools.map((t) => t.function.name)).toContain("lead_times");
      expect(count(desk.db, "activity WHERE action = 'scope_refused'")).toBe(0);
    } finally {
      delete TOOLS.lead_times;
    }
  });

  it("save_note writes nothing once the asking user has been deactivated", async () => {
    let result: unknown;
    const box = { db: undefined as Desk["db"] | undefined, userId: 0 };
    const { model } = scriptedModel((req, n) => {
      if (n === 1) {
        box.db!.prepare("UPDATE client_users SET deactivated_on = '2026-10-01' WHERE id = ?").run(box.userId);
        return { content: null, tool_calls: [toolCall("s", "save_note", { body: "Late note." })] };
      }
      result = JSON.parse(req.messages.at(-1)?.content ?? "{}");
      return { content: "Could not save.", tool_calls: [] };
    });
    desk = await openDesk(model);
    box.db = desk.db;
    box.userId = twoClients(desk.db).a.buyer.id;
    const before = count(desk.db, "notes");
    await ask(desk, "Save a note.");
    expect(result).toMatchObject({ error: "user_inactive" });
    expect(count(desk.db, "notes")).toBe(before);
  });

  it("answers 429 too_many_questions after thirty questions in an hour from one user", async () => {
    let clock = TODAY.getTime();
    const { model } = scriptedModel(() => ({ content: "Done.", tool_calls: [] }));
    desk = await openDesk(model, () => new Date(clock));
    const world = twoClients(desk.db);
    const cookie = await desk.signIn(world.a.buyer.email);
    const other = await desk.signIn(world.b.buyer.email);
    const askAs = (c: string) => desk!.call("POST", `/assistant/suppliers/${world.shared}`, { cookie: c, body: { question: "Anything?" } });
    for (let i = 0; i < QUESTIONS_PER_HOUR; i++) expect((await askAs(cookie)).status).toBe(200);
    const refused = await askAs(cookie);
    expect([refused.status, refused.body.code]).toEqual([429, "too_many_questions"]);
    expect((await askAs(other)).status).toBe(200);
    clock += 61 * 60 * 1000;
    expect((await askAs(cookie)).status).toBe(200);
  });
});
