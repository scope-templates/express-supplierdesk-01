import { getSupplier, type SupplierRow } from "../records.js";
import { dayOf } from "../validate.js";
import { ModelCallFailed, type ChatModel, type ChatReply, type Message } from "./model.js";
import { cutTo, parseArguments, runTool, toolSpecs, type ToolContext } from "./tools.js";

export const MAX_MODEL_CALLS = 6;
export const MAX_TOOL_CALLS_PER_REPLY = 8;
export const MAX_TOOL_CALLS_PER_QUESTION = 20;
export const MAX_QUESTION_TOOL_CHARS = 48_000;
export const MIN_ROOM_TO_RUN_TOOL = 512;
export const QUESTION_DEADLINE_MS = 120_000;
export const LAST_CALL_MS = 30_000;

function systemPrompt(today: string, clientName: string, supplier: SupplierRow): string {
  return [
    "You answer questions for the Tessary supplier desk, where procurement staff at Tessary's client manufacturers keep their supplier lists.",
    `Today is ${today}. The person asking works at ${clientName}.`,
    `Each question is about one supplier on their list; this one is about supplier ${supplier.id}: ${supplier.name} (${supplier.hq_city}, ${supplier.hq_state}).`,
    "supplier_profile reads the supplier's row in the supplier file; facts reads its fact rows, each with the date it was checked, who checked it and their note; calls reads Tessary analysts' write-ups of calls with the supplier's contacts; our_history reads this client's entry for the supplier, its notes and its check requests; save_note saves a note on this client's entry under the asker's name.",
    "Keep answers short and plain, and give dates with facts.",
  ].join(" ");
}

export interface AssistantAnswer {
  answer: string;
  tool_calls: { name: string; arguments: unknown }[];
}

export async function askAboutSupplier(
  model: ChatModel,
  ctx: Omit<ToolContext, "noteSaved" | "signal">,
  question: string,
  signal: AbortSignal,
): Promise<AssistantAnswer> {
  const endsAt = ctx.now().getTime() + QUESTION_DEADLINE_MS;
  const messages: Message[] = [
    { role: "system", content: systemPrompt(dayOf(ctx.now()), ctx.actor.client_name, getSupplier(ctx.db, ctx.supplierId)) },
    { role: "user", content: `Supplier ${ctx.supplierId}. ${question}` },
  ];
  const toolCalls: AssistantAnswer["tool_calls"] = [];
  let toolChars = 0;
  let outOfTime = false;
  let noteSaved = false;

  for (let call = 1; call <= MAX_MODEL_CALLS; call++) {
    if (signal.aborted) throw new ModelCallFailed("The question was canceled.");
    const left = endsAt - ctx.now().getTime();
    const last = call === MAX_MODEL_CALLS || toolCalls.length >= MAX_TOOL_CALLS_PER_QUESTION || outOfTime || left <= 0;
    const time = AbortSignal.timeout(last ? Math.max(left, LAST_CALL_MS) : left);
    const round = AbortSignal.any([signal, time]);
    const tools = toolSpecs();
    let reply: ChatReply;
    try {
      reply = await model.complete(last ? { messages, tools, tool_choice: "none", signal: round } : { messages, tools, signal: round });
    } catch (err) {
      if (last || signal.aborted || !time.aborted) throw err;
      outOfTime = true;
      continue;
    }
    if (last || reply.tool_calls.length === 0) {
      const answer = reply.content?.trim();
      if (!answer) throw new ModelCallFailed("The model returned an empty answer.");
      return { answer, tool_calls: toolCalls };
    }
    const kept = reply.tool_calls.slice(0, Math.min(MAX_TOOL_CALLS_PER_REPLY, MAX_TOOL_CALLS_PER_QUESTION - toolCalls.length));
    messages.push({ role: "assistant", content: reply.content, tool_calls: kept });
    for (const toolCall of kept) {
      if (signal.aborted) throw new ModelCallFailed("The question was canceled.");
      const args = parseArguments(toolCall.function.arguments);
      toolCalls.push({ name: toolCall.function.name, arguments: args.ok ? args.value : args.raw });
      // Each call keeps the signal of its own round; the one-note rule spans the question.
      const callContext: ToolContext = {
        ...ctx,
        signal: round,
        get noteSaved() {
          return noteSaved;
        },
        set noteSaved(saved) {
          noteSaved = saved;
        },
      };
      const room = MAX_QUESTION_TOOL_CHARS - toolChars;
      const content =
        room >= MIN_ROOM_TO_RUN_TOOL
          ? cutTo(await runTool(callContext, toolCall.function.name, args), room)
          : JSON.stringify({ error: "question_context_full", detail: `Tool results for one question stop at ${MAX_QUESTION_TOOL_CHARS} characters.` });
      toolChars += content.length;
      messages.push({ role: "tool", tool_call_id: toolCall.id, content });
    }
    outOfTime = time.aborted;
  }
  throw new Error("unreachable: the loop returns on its last call");
}
