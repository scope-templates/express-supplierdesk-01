import { readFileSync } from "node:fs";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import type { ChatModel, ChatReply, ChatRequest } from "../src/assistant/model.js";
import { loadSeedIfEmpty, openDatabase, readSeed, type Db } from "../src/db.js";

export const SEED_PATH = new URL("../data/seed.json", import.meta.url);
export const seed = readSeed(readFileSync(SEED_PATH, "utf8"));
export const TODAY = new Date("2026-10-01T15:00:00Z");
export const PASSWORD = "supplier-desk-local";

export const LEAD = "ingrid@tessary.example";
export const ANALYST = "marcus@tessary.example";
export const OTHER_ANALYST = "teresa@tessary.example";
export const ADMIN = "corinne@tessary.example";

export interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

export interface Desk {
  db: Db;
  port: number;
  call(method: string, path: string, options?: { body?: unknown; form?: Record<string, string>; cookie?: string; origin?: string | null }): Promise<Reply>;
  signIn(email: string, password?: string): Promise<string>;
  close(): Promise<void>;
}

export async function openDesk(model: ChatModel | null = null, at: Date | (() => Date) = TODAY, cookieSecure = false): Promise<Desk> {
  const db = openDatabase(":memory:");
  loadSeedIfEmpty(db, seed);
  const app = createApp({ db, sessionSecret: "test-secret", model, now: typeof at === "function" ? at : () => at, cookieSecure });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;

  const call: Desk["call"] = (method, path, options = {}) =>
    new Promise((resolve, reject) => {
      const payload = options.form
        ? new URLSearchParams(options.form).toString()
        : options.body === undefined
          ? undefined
          : JSON.stringify(options.body);
      const type = options.form ? "application/x-www-form-urlencoded" : "application/json";
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: {
            ...(payload !== undefined ? { "content-type": type, "content-length": Buffer.byteLength(payload) } : {}),
            ...(options.cookie ? { cookie: options.cookie } : {}),
            ...(options.form && options.origin !== null ? { origin: options.origin ?? `http://127.0.0.1:${port}` } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const json = String(res.headers["content-type"] ?? "").includes("json");
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: json && text ? JSON.parse(text) : text });
          });
        },
      );
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });

  return {
    db,
    port,
    call,
    async signIn(email, password = PASSWORD) {
      const reply = await call("POST", "/session", { body: { email, password } });
      const cookie = ([] as string[]).concat(reply.headers["set-cookie"] ?? [])[0];
      if (reply.status !== 200 || !cookie) throw new Error(`sign-in failed for ${email}: ${reply.status}`);
      return cookie.split(";")[0] as string;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export function userOf(db: Db, clientId: number, role: "buyer" | "client_admin" = "client_admin") {
  return db.prepare("SELECT id, email, name FROM client_users WHERE client_id = ? AND role = ? ORDER BY id LIMIT 1").get(clientId, role) as
    | { id: number; email: string; name: string }
    | undefined;
}

export function twoClients(db: Db) {
  const shared = db
    .prepare(
      `SELECT a.client_id AS a, b.client_id AS b, a.supplier_id AS supplier
         FROM supplier_list a JOIN supplier_list b ON b.supplier_id = a.supplier_id AND b.client_id > a.client_id
         JOIN clients ca ON ca.id = a.client_id AND ca.status = 'active'
         JOIN clients cb ON cb.id = b.client_id AND cb.status = 'active'
        WHERE EXISTS (SELECT 1 FROM facts f WHERE f.supplier_id = a.supplier_id)
          AND EXISTS (SELECT 1 FROM calls c WHERE c.supplier_id = a.supplier_id)
          AND EXISTS (SELECT 1 FROM client_users u WHERE u.client_id = a.client_id AND u.role = 'buyer')
          AND EXISTS (SELECT 1 FROM client_users u WHERE u.client_id = b.client_id AND u.role = 'buyer')
        ORDER BY a.supplier_id LIMIT 1`,
    )
    .get() as { a: number; b: number; supplier: number };
  const onlyA = db
    .prepare(
      `SELECT l.supplier_id AS id FROM supplier_list l
        WHERE l.client_id = ? AND l.status <> 'dropped'
          AND NOT EXISTS (SELECT 1 FROM check_requests r WHERE r.client_id = l.client_id AND r.supplier_id = l.supplier_id AND r.status IN ('requested', 'assigned'))
          AND NOT EXISTS (SELECT 1 FROM supplier_list o WHERE o.client_id = ? AND o.supplier_id = l.supplier_id)
          AND EXISTS (SELECT 1 FROM facts f WHERE f.supplier_id = l.supplier_id)
        ORDER BY l.supplier_id LIMIT 1`,
    )
    .get(shared.a, shared.b) as { id: number };
  return {
    shared: shared.supplier,
    onlyA: onlyA.id,
    a: { id: shared.a, admin: userOf(db, shared.a)!, buyer: userOf(db, shared.a, "buyer")! },
    b: { id: shared.b, admin: userOf(db, shared.b)!, buyer: userOf(db, shared.b, "buyer")! },
  };
}

export type SentRequest = Omit<ChatRequest, "signal">;

export function scriptedModel(script: (request: SentRequest, call: number) => ChatReply) {
  const requests: SentRequest[] = [];
  const model: ChatModel = {
    async complete({ signal: _signal, ...request }) {
      requests.push(structuredClone(request));
      return script(request, requests.length);
    },
  };
  return { model, requests };
}

export function toolCall(id: string, name: string, args: unknown): ChatReply["tool_calls"][number] {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

export function count(db: Db, sql: string, ...params: unknown[]): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${sql}`).get(...params) as { n: number }).n;
}
