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
  noteSaved: boolean;
}

type ToolResult = Record<string, unknown>;

export interface Tool {
  spec: ToolSpec;
  args: z.ZodTypeAny;
  scopedToSupplier: boolean;
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

const MAX_WRITE_UP_CHARS = 3_000;
export const MAX_TOOL_RESULT_CHARS = 16_000;

function arraysIn(value: unknown, found: unknown[][] = []): unknown[][] {
  if (Array.isArray(value)) {
    found.push(value);
    for (const item of value) arraysIn(item, found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) arraysIn(item, found);
  }
  return found;
}

export function toolMessage(result: ToolResult): string {
  let text = JSON.stringify(result);
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  const trimmed: ToolResult = { ...structuredClone(result), trimmed: true };
  while (text.length > MAX_TOOL_RESULT_CHARS) {
    const longest = arraysIn(trimmed).sort((a, b) => b.length - a.length)[0];
    if (!longest || longest.length <= 1) return JSON.stringify({ error: "result_too_large" });
    longest.splice(0, Math.ceil(longest.length / 2));
    text = JSON.stringify(trimmed);
  }
  return text;
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
    async (ctx, args) => ({ facts: factsFor(ctx.db, ctx.supplierId, args.field) }),
  ),
  deskTool(
    "calls",
    "Tessary analysts' write-ups of calls with the supplier's contacts, with the contact's name and title and the date.",
    {},
    {},
    [],
    async (ctx) => ({
      calls: callsFor(ctx.db, ctx.supplierId).map((call) =>
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
      notes: entryNotes(ctx.db, ctx.actor.client_id, ctx.supplierId),
      check_requests: entryRequests(ctx.db, ctx.actor.client_id, ctx.supplierId),
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

export async function runTool(ctx: ToolContext, name: string, args: ParsedArguments): Promise<ToolResult> {
  const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name] : undefined;
  if (!tool) return { error: "unknown_tool", detail: `There is no tool named ${name}.` };
  if (!args.ok) return { error: "invalid_arguments", detail: "The arguments were not valid JSON." };
  const parsed = tool.args.safeParse(args.value);
  if (!parsed.success) {
    return { error: "invalid_arguments", detail: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const data = parsed.data as Record<string, unknown>;
  if (tool.scopedToSupplier && data.supplier_id !== undefined && data.supplier_id !== ctx.supplierId) {
    return refuse(ctx, `supplier:${data.supplier_id}`);
  }
  try {
    return await tool.run(ctx, data);
  } catch (err) {
    if (err instanceof Problem) return { error: err.code, detail: err.message };
    throw err;
  }
}
