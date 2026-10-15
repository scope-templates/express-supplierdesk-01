import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelCallFailed, chatCompletionsModel, modelSettingsFrom } from "../src/assistant/model.js";
import { toolSpecs } from "../src/assistant/tools.js";

const ALL = { MODEL_BASE_URL: "http://model.test/v1/", MODEL_API_KEY: "k", MODEL_NAME: "m" };
const settings = () => modelSettingsFrom(ALL)!;

afterEach(() => vi.restoreAllMocks());

describe("model settings", () => {
  it("are read only when all three are set to real values", () => {
    expect(modelSettingsFrom(ALL)).toEqual({ baseUrl: "http://model.test/v1/", apiKey: "k", model: "m" });
    for (const name of Object.keys(ALL)) {
      expect(modelSettingsFrom({ ...ALL, [name]: undefined })).toBeNull();
      expect(modelSettingsFrom({ ...ALL, [name]: "  " })).toBeNull();
      expect(modelSettingsFrom({ ...ALL, [name]: "replace-with-something" })).toBeNull();
    }
  });
});

describe("chat-completions model", () => {
  type Init = { method: string; headers: Record<string, string>; body: string; signal: AbortSignal };
  function recording(reply: { ok: boolean; status: number; body: unknown }) {
    const sent: { url: string; init: Init }[] = [];
    const transport = async (url: string, init: Init) => {
      sent.push({ url, init });
      return { ok: reply.ok, status: reply.status, text: async () => (typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body)) };
    };
    return { sent, transport };
  }

  it("posts model, messages and tools to /chat/completions and reads tool_calls back", async () => {
    const toolCalls = [{ id: "1", type: "function", function: { name: "facts", arguments: "{}" } }];
    const { sent, transport } = recording({
      ok: true,
      status: 200,
      body: { choices: [{ message: { content: null, tool_calls: toolCalls } }] },
    });
    const reply = await chatCompletionsModel(settings(), transport).complete({
      messages: [{ role: "user", content: "hi" }],
      tools: toolSpecs(),
    });

    expect(reply).toMatchObject({ content: null, tool_calls: toolCalls });
    expect(sent[0]?.url).toBe("http://model.test/v1/chat/completions");
    expect(sent[0]?.init.method).toBe("POST");
    expect(sent[0]?.init.headers.authorization).toBe("Bearer k");
    expect(JSON.parse(sent[0]?.init.body ?? "")).toMatchObject({ model: "m", messages: [{ role: "user", content: "hi" }], tools: toolSpecs() });
  });

  it("accepts tool calls that leave out type", async () => {
    const { transport } = recording({
      ok: true,
      status: 200,
      body: { choices: [{ message: { content: null, tool_calls: [{ id: "1", function: { name: "facts", arguments: "{}" } }] } }] },
    });
    const reply = await chatCompletionsModel(settings(), transport).complete({ messages: [], tools: toolSpecs() });
    expect(reply.tool_calls).toEqual([{ id: "1", type: "function", function: { name: "facts", arguments: "{}" } }]);
  });

  it("joins content sent as a list of text parts", async () => {
    const { transport } = recording({
      ok: true,
      status: 200,
      body: { choices: [{ message: { content: [{ type: "text", text: "First half, " }, { type: "other" }, { type: "text", text: "second half." }] } }] },
    });
    const reply = await chatCompletionsModel(settings(), transport).complete({ messages: [], tools: toolSpecs() });
    expect(reply.content).toBe("First half, second half.");
  });

  it("skips tool-call entries of a kind other than function and keeps the function calls", async () => {
    const { transport } = recording({
      ok: true,
      status: 200,
      body: {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "h", type: "other", other: {} },
                { id: "1", type: "function", function: { name: "facts", arguments: "{}" } },
              ],
            },
          },
        ],
      },
    });
    const reply = await chatCompletionsModel(settings(), transport).complete({ messages: [], tools: toolSpecs() });
    expect(reply.tool_calls).toEqual([{ id: "1", type: "function", function: { name: "facts", arguments: "{}" } }]);
  });

  it("sends tool_choice none with the tools when asked", async () => {
    const { sent, transport } = recording({ ok: true, status: 200, body: { choices: [{ message: { content: "ok" } }] } });
    const reply = await chatCompletionsModel(settings(), transport).complete({
      messages: [{ role: "user", content: "hi" }],
      tools: toolSpecs(),
      tool_choice: "none",
    });
    expect(reply).toMatchObject({ content: "ok", tool_calls: [] });
    expect(JSON.parse(sent[0]?.init.body ?? "")).toMatchObject({ tools: toolSpecs(), tool_choice: "none" });
  });

  it("passes the question's abort signal on to the call", async () => {
    const { sent, transport } = recording({ ok: true, status: 200, body: { choices: [{ message: { content: "ok" } }] } });
    const question = new AbortController();
    await chatCompletionsModel(settings(), transport).complete({ messages: [], tools: toolSpecs(), signal: question.signal });
    expect(sent[0]?.init.signal.aborted).toBe(false);
    question.abort();
    expect(sent[0]?.init.signal.aborted).toBe(true);
  });

  it("logs a slice of a provider's error body and keeps it out of the error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { transport } = recording({ ok: false, status: 500, body: `quota exceeded ${"z".repeat(2_000)}` });
    const failure = await chatCompletionsModel(settings(), transport).complete({ messages: [], tools: toolSpecs() }).catch((e) => e);
    expect(failure).toBeInstanceOf(ModelCallFailed);
    expect(failure.message).toBe("The model endpoint answered 500.");
    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).toContain("quota exceeded");
    expect(line.length).toBeLessThan(600);
  });

  it("throws ModelCallFailed when the call fails or the reply has the wrong shape", async () => {
    const broken = async () => {
      throw new TypeError("Failed to parse URL");
    };
    await expect(chatCompletionsModel(settings(), broken).complete({ messages: [], tools: toolSpecs() })).rejects.toThrow(ModelCallFailed);
    for (const body of [
      { choices: [] },
      "not json",
      { choices: [{ message: { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "facts", arguments: {} } }] } }] },
    ]) {
      const { transport } = recording({ ok: true, status: 200, body });
      await expect(chatCompletionsModel(settings(), transport).complete({ messages: [], tools: toolSpecs() })).rejects.toThrow(ModelCallFailed);
    }
  });
});
