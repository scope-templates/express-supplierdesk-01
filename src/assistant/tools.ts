import { z } from "zod";
import { FACT_FIELDS, type Db } from "../db.js";
import { Problem } from "../problem.js";
import { addNote, callsFor, entryNotes, entryRequests, factsFor, getSupplier, listEntry, logActivity, type ClientActor } from "../records.js";
import { id, text } from "../validate.js";
import type { ToolSpec } from "./model.js";

export interface ToolContext {
  db: Db;
  supplierId: number;
  actor: ClientActor;
  now: () => Date;
  signal: AbortSignal;
  noteSaved: boolean;
}

type ToolResult = Record<string, unknown>;

export interface Tool {
  spec: ToolSpec;
  args: z.ZodTypeAny;
  scopedToSupplier: boolean;
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<unknown>;
}

const MAX_WRITE_UP_CHARS = 3_000;
const MAX_FAILURE_CHARS = 300;
export const MAX_TOOL_RESULT_CHARS = 16_000;
export const CUT_MARKER = " [cut]";

export function cutTo(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= CUT_MARKER.length) return CUT_MARKER.slice(0, Math.max(limit, 0));
  const end = limit - CUT_MARKER.length;
  const last = text.charCodeAt(end - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end) + CUT_MARKER;
}

export function toolMessage(result: unknown): string {
  const text: string | undefined = JSON.stringify(result);
  if (text === undefined) throw new Error("The result has no JSON form.");
  return cutTo(text, MAX_TOOL_RESULT_CHARS);
}

function deskTool<S extends z.ZodRawShape>(
  name: string,
  description: string,
  shape: S,
  properties: Record<string, unknown>,
  required: string[],
  run: (ctx: ToolContext, args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>,
): [string, Tool] {
  return [
    name,
    {
      spec: {
        type: "function",
        function: {
          name,
          description,
          parameters: {
            type: "object",
            properties: { supplier_id: { type: "integer", description: "The supplier the question is about." }, ...properties },
            required,
            additionalProperties: false,
          },
        },
      },
      args: z.object({ supplier_id: id.optional(), ...shape }).strict(),
      scopedToSupplier: true,
      run: run as Tool["run"],
    },
  ];
}

export const TOOLS: Record<string, Tool> = Object.fromEntries([
  deskTool(
    "supplier_profile",
    "The supplier's row in the supplier file: name, kind, headquarters city and state, the plants it told us about, and when it was added.",
    {},
    {},
    [],
    async (ctx) => ({ supplier: getSupplier(ctx.db, ctx.supplierId) }),
  ),
  deskTool(
    "facts",
    "Fact rows on the supplier (ownership, parent company, headquarters, plants, headcount, chief executive, certifications, recent change), each with checked_on, checked_by and the analyst's note. Pass field to read one field.",
    { field: z.enum(FACT_FIELDS).optional() },
    { field: { type: "string", enum: [...FACT_FIELDS] } },
    [],
    async (ctx, args) => ({ facts: factsFor(ctx.db, ctx.supplierId, args.field).reverse() }),
  ),
  deskTool(
    "calls",
    "Tessary analysts' write-ups of calls with the supplier's contacts, with the contact's name and title and the date.",
    {},
    {},
    [],
    async (ctx) => ({
      calls: callsFor(ctx.db, ctx.supplierId).reverse().map((call) =>
        call.write_up.length > MAX_WRITE_UP_CHARS ? { ...call, write_up: call.write_up.slice(0, MAX_WRITE_UP_CHARS), write_up_trimmed: true } : call,
      ),
    }),
  ),
  deskTool(
    "our_history",
    "The asking client's entry for this supplier (status, spend band, when it was added and by whom), with its notes and its check requests.",
    {},
    {},
    [],
    async (ctx) => ({
      entry: listEntry(ctx.db, ctx.actor.client_id, ctx.supplierId),
      notes: entryNotes(ctx.db, ctx.actor.client_id, ctx.supplierId).reverse(),
      check_requests: entryRequests(ctx.db, ctx.actor.client_id, ctx.supplierId).reverse(),
    }),
  ),
  deskTool(
    "save_note",
    "Saves a note on the asking client's entry for this supplier under the name of the person asking.",
    { body: text(4000) },
    { body: { type: "string" } },
    ["body"],
    async (ctx, args) => {
      if (ctx.noteSaved) return { error: "note_already_saved", detail: "One note is saved per question." };
      const active = ctx.db
        .prepare(
          `SELECT 1 FROM client_users u JOIN clients c ON c.id = u.client_id
            WHERE u.id = ? AND u.client_id = ? AND u.deactivated_on IS NULL AND c.status = 'active'`,
        )
        .get(ctx.actor.id, ctx.actor.client_id);
      if (!active) return { error: "user_inactive", detail: "The person asking can no longer write notes." };
      const note = ctx.db.transaction(() => addNote(ctx.db, ctx.actor, ctx.actor.client_id, ctx.supplierId, args.body, ctx.now()))();
      ctx.noteSaved = true;
      return { saved: note };
    },
  ),
]);

export function toolSpecs(): ToolSpec[] {
  return Object.values(TOOLS).map((tool) => tool.spec);
}

function refuse(ctx: ToolContext, asked: string): ToolResult {
  logActivity(ctx.db, ctx.actor, "scope_refused", `supplier:${ctx.supplierId} asked ${asked}`, ctx.now());
  return { error: "scope_refused", detail: `This question is about supplier ${ctx.supplierId}; ${asked} is outside it.` };
}

export type ParsedArguments = { ok: true; value: unknown } | { ok: false; raw: string };

export function parseArguments(raw: string): ParsedArguments {
  try {
    return { ok: true, value: raw.trim() === "" ? {} : JSON.parse(raw) };
  } catch {
    return { ok: false, raw };
  }
}

export async function runTool(ctx: ToolContext, name: string, args: ParsedArguments): Promise<string> {
  const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name] : undefined;
  if (!tool) return JSON.stringify({ error: "unknown_tool", detail: `There is no tool named ${name}.` });
  if (!args.ok) return JSON.stringify({ error: "invalid_arguments", detail: "The arguments were not valid JSON." });
  const parsed = tool.args.safeParse(args.value);
  if (!parsed.success) {
    return JSON.stringify({ error: "invalid_arguments", detail: parsed.error.issues.map((i) => i.message).join("; ") });
  }
  const data = parsed.data as Record<string, unknown>;
  if (tool.scopedToSupplier && data.supplier_id !== undefined && data.supplier_id !== ctx.supplierId) {
    return JSON.stringify(refuse(ctx, `supplier:${data.supplier_id}`));
  }
  if (ctx.signal.aborted) return JSON.stringify({ error: "tool_failed", detail: `${name} was not run: the question ran out of time.` });
  try {
    return toolMessage(await untilAborted(ctx.signal, tool.run(ctx, data)));
  } catch (err) {
    let reason = "a value that cannot be read";
    try {
      if (err instanceof Problem) return JSON.stringify({ error: err.code, detail: err.message });
      reason = String(err instanceof Error ? err.message : err);
    } catch {
      // The thrown value cannot be read, so the failure says only that.
    }
    // A caller hanging up is not the tool failing; only a failure or the question's deadline is logged.
    const hungUp = ctx.signal.aborted && (ctx.signal.reason as Error | undefined)?.name !== "TimeoutError";
    if (!hungUp) logActivity(ctx.db, ctx.actor, "tool_failed", `supplier:${ctx.supplierId} ran ${name}`, ctx.now());
    return JSON.stringify({ error: "tool_failed", detail: `${name} did not finish: ${reason.slice(0, MAX_FAILURE_CHARS)}` });
  }
}

async function untilAborted<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
