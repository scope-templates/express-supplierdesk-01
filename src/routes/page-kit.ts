import type { NextFunction, Request, Response } from "express";
import type { Actor } from "../records.js";
import { sessionFromCookie } from "../session.js";
import type { AppContext } from "../app.js";

export function signedInPage({ db, sessionSecret, now }: AppContext, kind?: Actor["kind"]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = sessionFromCookie(db, sessionSecret, req.headers.cookie, now());
    if (!session || (kind && session.actor.kind !== kind)) {
      res.redirect(303, "/sign-in");
      return;
    }
    req.actor = session.actor;
    req.sessionId = session.id;
    next();
  };
}

const CSS = `
body { font: 15px/1.45 system-ui, sans-serif; margin: 0; color: #1f2427; background: #f4f5f2; }
header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px 20px; background: #2c3e50; color: #fff; }
header a { color: #fff; font-weight: 600; text-decoration: none; margin-right: 14px; }
header form { display: inline; margin-left: 12px; }
main { max-width: 1040px; margin: 0 auto; padding: 16px 20px 48px; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 18px; background: #fff; }
th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #dfe2dc; vertical-align: top; }
th { font-size: 13px; color: #59616a; }
h2 { margin-top: 28px; border-bottom: 2px solid #2c3e50; }
.meta { color: #59616a; }
.answer { background: #fff; border-left: 4px solid #2c3e50; padding: 10px 14px; white-space: pre-wrap; }
.problem { background: #fff2ee; border-left: 4px solid #a3402a; padding: 10px 14px; }
form.box { background: #fff; padding: 10px 14px; margin: 8px 0 16px; }
form.box label { display: inline-block; margin: 0 12px 6px 0; }
textarea { width: 100%; min-height: 60px; font: inherit; }
td form { display: inline; }
`;

export const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const label = (value: string) => value.replace(/_/g, " ");

const NAV = {
  client_user: [["/app", "My suppliers"]],
  staff: [
    ["/desk", "Check requests"],
    ["/desk/suppliers", "Supplier file"],
    ["/desk/additions", "Addition requests"],
    ["/desk/activity", "Activity"],
  ],
} as const;

export function page(title: string, actor: Actor | undefined, body: string): string {
  const nav = actor ? [...NAV[actor.kind], ["/password", "Password"]].map(([href, text]) => `<a href="${href}">${text}</a>`).join("") : "";
  const who = actor
    ? `<span>${esc(actor.name)}${actor.kind === "client_user" ? `, ${esc(actor.client_name)}` : ` (${esc(actor.role)})`}<form method="post" action="/sign-out"><button type="submit">Sign out</button></form></span>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - Tessary</title><style>${CSS}</style></head>
<body><header><span><strong>Tessary supplier desk</strong> ${nav}</span>${who}</header><main>${body}</main></body></html>`;
}

export function table(headings: string[], rows: unknown[][]): string {
  if (rows.length === 0) return `<p class="meta">None.</p>`;
  const head = headings.map((h) => `<th>${esc(h)}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function select(name: string, options: readonly string[], chosen?: string): string {
  const items = options.map((o) => `<option value="${esc(o)}"${o === chosen ? " selected" : ""}>${esc(label(o))}</option>`).join("");
  return `<select name="${name}">${items}</select>`;
}

export const field = (text: string, input: string) => `<label>${esc(text)} ${input}</label>`;

export const input = (name: string, extra = "") => `<input name="${name}" ${extra}>`;

export const form = (action: string, inner: string, button: string, cls = "box") =>
  `<form class="${cls}" method="post" action="${esc(action)}">${inner} <button type="submit">${esc(button)}</button></form>`;

export const stamp = (at: string) => esc(at.slice(0, 16).replace("T", " "));

export const words = (value: string) => esc(label(value));
