import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  LAST_CALL_MS,
  MAX_MODEL_CALLS,
  MAX_QUESTION_TOOL_CHARS,
  MAX_TOOL_CALLS_PER_QUESTION,
  MIN_ROOM_TO_RUN_TOOL,
  QUESTION_DEADLINE_MS,
  askAboutSupplier,
} from "../src/assistant/loop.js";
import { ModelCallFailed, type ChatModel } from "../src/assistant/model.js";
import { QUESTIONS_PER_HOUR } from "../src/routes/assistant.js";
import { CUT_MARKER, MAX_TOOL_RESULT_CHARS, TOOLS, toolMessage, type Tool, type ToolContext } from "../src/assistant/tools.js";
import { getSupplier, type ClientActor } from "../src/records.js";
import { ANALYST, TODAY, count, openDesk, scriptedModel, toolCall, twoClients, type Desk } from "./helpers.js";

const TOOL_NAMES = ["supplier_profile", "facts", "calls", "our_history", "save_note"];

let desk: Desk | undefined;
afterEach(async () => {
  delete TOOLS.lookup;
  await desk?.close();
  desk = undefined;
});

function addLookup(run: Tool["run"]) {
  TOOLS.lookup = {
    spec: { type: "function", function: { name: "lookup", description: "Looks a value up.", parameters: { type: "object", properties: {} } } },
    args: z.object({ wait: z.boolean().optional() }).strict(),
    scopedToSupplier: false,
    run,
  };
}

const toolResults = (messages: { role: string; content: string | null }[]) =>
  messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content ?? "{}"));

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
    expect(reply.body).toMatchObject({
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
    const supplier = getSupplier(desk.db, world.shared);
    for (const part of [supplier.name, supplier.hq_city, supplier.hq_state]) expect(requests[0]?.messages[0]?.content).toContain(part);
    const results = (requests[1]?.messages.filter((m) => m.role === "tool") ?? []).map((m) => JSON.parse(m.content));
    expect(results[0].supplier.id).toBe(world.shared);
    expect(results[1].facts.every((f: { field: string; checked_on: string; checked_by_name: string; note: string }) => f.field === "ownership" && f.checked_on && f.checked_by_name && f.note)).toBe(true);
  });

  it("makes at most its model-call limit; the last call keeps the tools, sends tool_choice none, and its text is the answer", async () => {
    const { model, requests } = scriptedModel((req, n) =>
      req.tool_choice === "none"
        ? { content: "Here is what the supplier file says.", tool_calls: [] }
        : { content: null, tool_calls: [toolCall(`c${n}`, "calls", {})] },
    );
    desk = await openDesk(model);
    const { reply } = await ask(desk, "Summarize the calls.");
    expect(requests).toHaveLength(MAX_MODEL_CALLS);
    expect(requests.at(-1)?.tools.map((t) => t.function.name)).toEqual(expect.arrayContaining(TOOL_NAMES));
    expect(requests.at(-1)?.tool_choice).toBe("none");
    expect(reply.body.answer).toBe("Here is what the supplier file says.");
    expect(reply.body.tool_calls).toHaveLength(MAX_MODEL_CALLS - 1);
  });

  it("stops at its model-call limit with a text answer when the model returns tool calls every time", async () => {
    const { model, requests } = scriptedModel((_req, n) => ({ content: `Pass ${n}.`, tool_calls: [toolCall(`c${n}`, "supplier_profile", {})] }));
    desk = await openDesk(model);
    const { reply } = await ask(desk, "Anything?");
    expect(requests).toHaveLength(MAX_MODEL_CALLS);
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ answer: `Pass ${MAX_MODEL_CALLS}.` });
    expect(reply.body.tool_calls).toHaveLength(MAX_MODEL_CALLS - 1);
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
    let sent: string[] = [];
    const { model } = scriptedModel((req, n) => {
      if (n === 1) return { content: null, tool_calls: Array.from({ length: 8 }, (_, i) => toolCall(`f${i}`, "facts", {})) };
      sent = req.messages.filter((m) => m.role === "tool").map((m) => m.content ?? "");
      return { content: "Done.", tool_calls: [] };
    });
    desk = await openDesk(model);
    const world = twoClients(desk.db);
    addFacts(desk, world.shared, 400);
    await ask(desk, "What do we hold?");
    expect(sent[0]?.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(sent[0]?.endsWith(CUT_MARKER)).toBe(true);
    const newest = desk.db.prepare("SELECT max(id) AS id FROM facts").get() as { id: number };
    expect(sent[0]).toContain(`"id":${newest.id},`);
    expect(sent[0]).not.toContain(`"id":${newest.id - 399},`);
    expect(JSON.parse(sent.at(-1) ?? "{}").error).toBe("question_context_full");
    expect(MAX_QUESTION_TOOL_CHARS).toBeLessThan(8 * MAX_TOOL_RESULT_CHARS);
  });

  it("lists calls, notes and check requests newest first", async () => {
    let sent: unknown[] = [];
    const { model } = scriptedModel((req, n) => {
      if (n === 1) return { content: null, tool_calls: [toolCall("c", "calls", {}), toolCall("h", "our_history", {})] };
      sent = toolResults(req.messages);
      return { content: "Done.", tool_calls: [] };
    });
    desk = await openDesk(model);
    const world = twoClients(desk.db);
    const cookie = await desk.signIn(world.a.buyer.email);
    for (const body of ["First.", "Second."]) await desk.call("POST", `/suppliers/${world.shared}/notes`, { cookie, body: { body } });
    const first = await desk.call("POST", `/suppliers/${world.shared}/check-requests`, { cookie, body: { question: "Who owns them now?" } });
    await desk.call("POST", `/check-requests/${first.body.check_request.id}/cancel`, { cookie });
    await desk.call("POST", `/suppliers/${world.shared}/check-requests`, { cookie, body: { question: "And their plants?" } });
    await ask(desk, "What happened lately?");
    type Row = { id: number } & Record<string, unknown>;
    const newestFirst = (rows: Row[], key: string) =>
      rows.slice(1).every((row, i) => {
        const prev = rows[i]!;
        return String(prev[key]) > String(row[key]) || (prev[key] === row[key] && prev.id > row.id);
      });
    const [{ calls }, { notes, check_requests }] = sent as [{ calls: Row[] }, { notes: Row[]; check_requests: Row[] }];
    expect(calls.length).toBeGreaterThan(1);
    expect(notes.length).toBeGreaterThan(1);
    expect(check_requests.length).toBeGreaterThan(1);
    expect(newestFirst(calls, "held_on")).toBe(true);
    expect(newestFirst(notes, "written_at")).toBe(true);
    expect(newestFirst(check_requests, "requested_on")).toBe(true);
  });

  it("does not run a tool once the question's tool results are full, and cuts the last one to the room left", async () => {
    let sent: string[] = [];
    const { model } = scriptedModel((req, n) => {
      if (n === 1) {
        const big = Array.from({ length: 3 }, (_, i) => toolCall(`f${i}`, "facts", {}));
        return { content: null, tool_calls: [toolCall("p", "supplier_profile", {}), ...big, toolCall("n", "save_note", { body: "Late note." })] };
      }
      sent = req.messages.filter((m) => m.role === "tool").map((m) => m.content ?? "");
      return { content: "Done.", tool_calls: [] };
    });
    desk = await openDesk(model);
    const world = twoClients(desk.db);
    addFacts(desk, world.shared, 400);
    await ask(desk, "What do we hold?");
    expect(sent.slice(0, 4).reduce((total, text) => total + text.length, 0)).toBe(MAX_QUESTION_TOOL_CHARS);
    expect(sent[3]?.endsWith(CUT_MARKER)).toBe(true);
    expect(JSON.parse(sent[4] ?? "{}").error).toBe("question_context_full");
    expect(count(desk.db, "notes WHERE body = 'Late note.'")).toBe(0);
  });

  it("does not run a tool when less than its minimum of room is left in the question's tool results", async () => {
    addLookup(async () => "x".repeat(15_898));
    let sent: string[] = [];
    const { model } = scriptedModel((req, n) => {
      if (n === 1) {
        const lookups = Array.from({ length: 3 }, (_, i) => toolCall(`l${i}`, "lookup", {}));
        return { content: null, tool_calls: [...lookups, toolCall("n", "save_note", { body: "Late note." })] };
      }
      sent = req.messages.filter((m) => m.role === "tool").map((m) => m.content ?? "");
      return { content: "Done.", tool_calls: [] };
    });
    desk = await openDesk(model);
    await ask(desk, "Look it up?");
    expect(MAX_QUESTION_TOOL_CHARS - sent.slice(0, 3).reduce((total, text) => total + text.length, 0)).toBeLessThan(MIN_ROOM_TO_RUN_TOOL);
    expect(JSON.parse(sent[3] ?? "{}").error).toBe("question_context_full");
    expect(count(desk.db, "notes WHERE body = 'Late note.'")).toBe(0);
  });

  it("cuts a result over the limit, whatever its shape, to the start of its JSON and a marker, in well under a second", () => {
    const shapes: Record<string, unknown> = {
      "just over the limit": { t: "a".repeat(MAX_TOOL_RESULT_CHARS - 7) },
      "many small lists": Object.fromEntries(Array.from({ length: 50_000 }, (_, i) => [`k${i}`, [i, i + 1]])),
      "wide object": Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`k${i}`, "y".repeat(40)])),
      "escaped long text": { id: 3, text: 'Line "one" of C:\\desk\\notes\n\ttab\u0001'.repeat(25_000) },
      "bare string": "Plain words and more words. ".repeat(36_000),
      "bare array": Array.from({ length: 25_000 }, (_, i) => ({ id: i, value: "x".repeat(40) })),
    };
    for (const [shape, result] of Object.entries(shapes)) {
      const whole = JSON.stringify(result);
      expect(whole.length, shape).toBeGreaterThan(shape === "just over the limit" ? MAX_TOOL_RESULT_CHARS : 1_000_000);
      const started = performance.now();
      const text = toolMessage(result);
      expect(performance.now() - started, shape).toBeLessThan(1_000);
      expect(text.length, shape).toBe(MAX_TOOL_RESULT_CHARS);
      expect(text.endsWith(CUT_MARKER), shape).toBe(true);
      expect(whole.startsWith(text.slice(0, -CUT_MARKER.length)), shape).toBe(true);
    }
  });

  it("returns a result exactly at the limit unchanged and never cuts between the halves of a character", () => {
    const exact = { t: "a".repeat(MAX_TOOL_RESULT_CHARS - 8) };
    expect(JSON.stringify(exact)).toHaveLength(MAX_TOOL_RESULT_CHARS);
    expect(toolMessage(exact)).toBe(JSON.stringify(exact));
    const text = toolMessage({ t: `a${"\u{1F600}".repeat(10_000)}` });
    expect(text).toHaveLength(MAX_TOOL_RESULT_CHARS - 1);
    expect(text.slice(0, -CUT_MARKER.length).endsWith("\u{1F600}")).toBe(true);
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

  it("answers a tool that throws with tool_failed, logs it, and carries on", async () => {
    addLookup(async () => {
      throw new Error("lookup broke");
    });
    let results: unknown[] = [];
    const { model, requests } = scriptedModel((req, n) => {
      if (n === 1) return { content: null, tool_calls: [toolCall("l", "lookup", {}), toolCall("p", "supplier_profile", {})] };
      results = toolResults(req.messages);
      return { content: "The profile came back.", tool_calls: [] };
    });
    desk = await openDesk(model);
    const { reply, world } = await ask(desk, "Look it up?");
    expect(reply.status).toBe(200);
    expect(requests).toHaveLength(2);
    expect(results[0]).toMatchObject({ error: "tool_failed" });
    expect((results[0] as { detail: string }).detail).toContain("lookup broke");
    expect(results[1]).toMatchObject({ supplier: { id: world.shared } });
    expect(desk.db.prepare("SELECT client_user_id, subject FROM activity WHERE action = 'tool_failed'").all()).toEqual([
      { client_user_id: world.a.buyer.id, subject: `supplier:${world.shared} ran lookup` },
    ]);
  });

  it.each([
    ["resolves to nothing", (): unknown => undefined],
    ["returns a BigInt", (): unknown => ({ total: 1n })],
    [
      "returns an object that holds itself",
      (): unknown => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      },
    ],
    [
      "throws a value that cannot be written as text",
      (): unknown => {
        throw Object.create(null);
      },
    ],
  ])("answers a tool that %s with tool_failed, logs it, and answers the question", async (_case, make) => {
    addLookup(async () => make());
    let results: unknown[] = [];
    const { model } = scriptedModel((req, n) => {
      if (n === 1) return { content: null, tool_calls: [toolCall("l", "lookup", {})] };
      results = toolResults(req.messages);
      return { content: "It failed.", tool_calls: [] };
    });
    desk = await openDesk(model);
    const { reply } = await ask(desk, "Look it up?");
    expect(reply.status).toBe(200);
    expect(results[0]).toMatchObject({ error: "tool_failed" });
    expect(desk.db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action = 'tool_failed'").get()).toEqual({ n: 1 });
  });

  it("gives tools the question's signal", async () => {
    let seen: AbortSignal | undefined;
    addLookup(async (ctx) => {
      seen = ctx.signal;
      return { value: 1 };
    });
    const { model } = scriptedModel((_req, n) => (n === 1 ? { content: null, tool_calls: [toolCall("l", "lookup", {})] } : { content: "One.", tool_calls: [] }));
    desk = await openDesk(model);
    await ask(desk, "Look it up?");
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
  });

  it("keeps the results that finished when the deadline passes during a round, and makes the last call", async () => {
    let clock = TODAY.getTime();
    const { model, requests } = scriptedModel((req, n) => {
      if (n === 1) {
        clock += QUESTION_DEADLINE_MS + 1;
        return { content: null, tool_calls: [toolCall("a", "facts", {}), toolCall("b", "supplier_profile", {})] };
      }
      return { content: req.tool_choice === "none" ? "From what came back." : "", tool_calls: [] };
    });
    desk = await openDesk(model, () => new Date(clock));
    const { reply, world } = await ask(desk, "What do we hold?");
    expect(reply.status).toBe(200);
    expect(reply.body.answer).toBe("From what came back.");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.tool_choice).toBe("none");
    const results = toolResults(requests[1]!.messages);
    expect(results[0].facts.length).toBeGreaterThan(0);
    expect(results[1]).toMatchObject({ supplier: { id: world.shared } });
  });

  it("answers a tool still running when the question's time runs out with tool_failed, then makes the last call", async () => {
    let clock = TODAY.getTime();
    let runs = 0;
    let abandoned: ToolContext | undefined;
    addLookup((ctx, args) => {
      runs += 1;
      if (!args.wait) return Promise.resolve({ value: 1 });
      abandoned = ctx;
      return new Promise(() => {});
    });
    const scripted = scriptedModel((req, n) => {
      if (req.tool_choice === "none") return { content: "One value came back.", tool_calls: [] };
      if (n === 1) {
        clock += QUESTION_DEADLINE_MS - 50;
        return { content: null, tool_calls: [toolCall("l1", "lookup", {})] };
      }
      return { content: null, tool_calls: [toolCall("l2", "lookup", { wait: true }), toolCall("l3", "lookup", {})] };
    });
    let lastCallOpen: boolean | undefined;
    const model: ChatModel = {
      complete(request) {
        if (request.tool_choice === "none") lastCallOpen = request.signal?.aborted === false;
        return scripted.model.complete(request);
      },
    };
    desk = await openDesk(model, () => new Date(clock));
    const { reply } = await ask(desk, "Look it up?");
    expect(reply.status).toBe(200);
    expect(reply.body.answer).toBe("One value came back.");
    const { requests } = scripted;
    expect(requests).toHaveLength(3);
    expect(requests[2]?.tool_choice).toBe("none");
    expect(toolResults(requests[2]!.messages)).toMatchObject([{ value: 1 }, { error: "tool_failed" }, { error: "tool_failed" }]);
    expect(runs).toBe(2);
    expect(lastCallOpen).toBe(true);
    expect(abandoned?.signal.aborted).toBe(true);
    expect(count(desk.db, "activity WHERE action = 'tool_failed'")).toBe(1);
  });

  it("follows a model call cut off at the deadline with the last call, tool use stopped and its signal open", async () => {
    let clock = TODAY.getTime();
    const sent: { tool_choice?: string; open: boolean }[] = [];
    const model: ChatModel = {
      async complete({ tool_choice, signal }) {
        sent.push({ tool_choice, open: signal?.aborted === false });
        if (tool_choice === "none") return { content: "From the profile.", tool_calls: [] };
        if (sent.length === 1) {
          clock += QUESTION_DEADLINE_MS - 50;
          return { content: null, tool_calls: [toolCall("p", "supplier_profile", {})] };
        }
        return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new ModelCallFailed("aborted"))));
      },
    };
    desk = await openDesk(model, () => new Date(clock));
    const { reply } = await ask(desk, "Who are they?");
    expect(reply.status).toBe(200);
    expect(reply.body.answer).toBe("From the profile.");
    expect(sent).toEqual([{ open: true }, { open: true }, { tool_choice: "none", open: true }]);
  });

  it("gives the last call at least its own minimum of time when the deadline has passed", async () => {
    let clock = TODAY.getTime();
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    try {
      const { model, requests } = scriptedModel((req, n) => {
        if (n === 1) {
          clock += QUESTION_DEADLINE_MS + 1;
          return { content: null, tool_calls: [toolCall("p", "supplier_profile", {})] };
        }
        return { content: req.tool_choice === "none" ? "From the profile." : "", tool_calls: [] };
      });
      desk = await openDesk(model, () => new Date(clock));
      const { reply } = await ask(desk, "Who are they?");
      expect(reply.status).toBe(200);
      expect(requests.at(-1)?.tool_choice).toBe("none");
      expect(timeouts.mock.calls.at(-1)?.[0]).toBeGreaterThanOrEqual(LAST_CALL_MS);
    } finally {
      timeouts.mockRestore();
    }
  });

  it("logs no tool_failed and runs no further tools when the caller hangs up during a tool", async () => {
    const question = new AbortController();
    let runs = 0;
    addLookup(() => {
      runs += 1;
      setTimeout(() => question.abort(), 0);
      return new Promise(() => {});
    });
    const { model, requests } = scriptedModel(() => ({ content: null, tool_calls: [toolCall("l1", "lookup", {}), toolCall("l2", "lookup", {})] }));
    desk = await openDesk(model);
    const world = twoClients(desk.db);
    const actor: ClientActor = { kind: "client_user", ...world.a.buyer, role: "buyer", client_id: world.a.id, client_name: "A" };
    const ctx = { db: desk.db, supplierId: world.shared, actor, now: () => TODAY };
    await expect(askAboutSupplier(model, ctx, "Look it up?", question.signal)).rejects.toThrow(ModelCallFailed);
    expect(requests).toHaveLength(1);
    expect(runs).toBe(1);
    expect(count(desk.db, "activity WHERE action = 'tool_failed'")).toBe(0);
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
