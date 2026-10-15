import { z } from "zod";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  messages: Message[];
  tools: ToolSpec[];
  tool_choice?: "none";
  signal?: AbortSignal;
}

export interface ChatReply {
  content: string | null;
  tool_calls: ToolCall[];
}

export interface ChatModel {
  complete(request: ChatRequest): Promise<ChatReply>;
}

export interface ModelSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class ModelCallFailed extends Error {}

const replyMessage = z.object({
  content: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        type: z.literal("function").optional(),
        function: z.object({ name: z.string(), arguments: z.string() }),
      }),
    )
    .nullable()
    .optional(),
});

const MODEL_TIMEOUT_MS = 60_000;
const LOGGED_ERROR_CHARS = 500;

type Transport = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export function modelSettingsFrom(env: Record<string, string | undefined>): ModelSettings | null {
  const read = (name: string) => {
    const value = env[name]?.trim();
    return value && !value.startsWith("replace-with") ? value : undefined;
  };
  const baseUrl = read("MODEL_BASE_URL");
  const apiKey = read("MODEL_API_KEY");
  const model = read("MODEL_NAME");
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model };
}

export function chatCompletionsModel(settings: ModelSettings, transport: Transport = fetch): ChatModel {
  const url = `${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    async complete({ messages, tools, tool_choice, signal }) {
      let text: string;
      try {
        const response = await transport(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${settings.apiKey}` },
          body: JSON.stringify({ model: settings.model, messages, tools, ...(tool_choice ? { tool_choice } : {}) }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(MODEL_TIMEOUT_MS)]) : AbortSignal.timeout(MODEL_TIMEOUT_MS),
        });
        text = await response.text();
        if (!response.ok) {
          console.error(`model endpoint answered ${response.status}: ${text.slice(0, LOGGED_ERROR_CHARS)}`);
          throw new ModelCallFailed(`The model endpoint answered ${response.status}.`);
        }
      } catch (err) {
        if (err instanceof ModelCallFailed) throw err;
        throw new ModelCallFailed(`The model call did not complete: ${(err as Error).message}`);
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new ModelCallFailed("The model endpoint answered with something other than JSON.");
      }
      const message = replyMessage.safeParse((body as { choices?: { message?: unknown }[] } | null)?.choices?.[0]?.message);
      if (!message.success) throw new ModelCallFailed("The model endpoint answered without a readable message.");
      const toolCalls = (message.data.tool_calls ?? []).map((call) => ({ id: call.id, type: "function" as const, function: call.function }));
      return { content: message.data.content ?? null, tool_calls: toolCalls };
    },
  };
}
