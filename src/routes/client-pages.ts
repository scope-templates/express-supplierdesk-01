import { Router, type Request, type Response } from "express";
import { LIST_STATUSES, SPEND_BANDS } from "../db.js";
import { Problem } from "../problem.js";
import { requireClientUser } from "../session.js";
import { idParam } from "../validate.js";
import { answerQuestion, questionBody } from "./assistant.js";
import {
  addClientNote,
  additionBody,
  cancelCheck,
  clientAdditions,
  clientEntries,
  entryChange,
  noteBody,
  requestAddition,
  requestBody,
  requestCheck,
  supplierView,
  updateEntry,
} from "./client.js";
import { esc, field, form, input, page, select, signedInPage, stamp, table, words } from "./page-kit.js";
import type { AppContext } from "../app.js";

const STATUS_LABELS: Record<(typeof LIST_STATUSES)[number], string> = {
  approved: "Approved",
  onboarding: "Onboarding",
  on_hold: "On hold",
  dropped: "Dropped",
};

const BAND_LABELS: Record<string, string> = {
  under_100k: "Under $100K",
  "100k_500k": "$100K to $500K",
  "500k_2m": "$500K to $2M",
  over_2m: "Over $2M",
};

const OPEN = ["requested", "assigned"];

export function clientPages(ctx: AppContext): Router {
  const { db, now } = ctx;
  const router = Router({ caseSensitive: true });
  const user = (req: Request) => requireClientUser(req, "use the client pages");
  router.use("/app", signedInPage(ctx, "client_user"));

  router.get("/app", (req, res) => {
    const actor = user(req);
    const entries = clientEntries(db, actor.client_id);
    const sections = (Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]).map((status) => {
      const rows = entries.filter((e) => e.status === status);
      return `<h2>${STATUS_LABELS[status]} <span class="meta">(${rows.length})</span></h2>${table(
        ["Supplier", "Kind", "Headquarters", "Spend", "Added", "Open requests"],
        rows.map((e) => [
          `<a href="/app/suppliers/${e.supplier_id}">${esc(e.name)}</a>`,
          words(e.kind),
          `${esc(e.hq_city)}, ${esc(e.hq_state)}`,
          esc(BAND_LABELS[e.spend_band]),
          esc(e.added_on),
          esc(e.open_requests || ""),
        ]),
      )}`;
    });
    const additions = table(
      ["Asked", "By", "Name", "Where", "Status", "Our note"],
      clientAdditions(db, actor.client_id).map(
        (a) => [esc(a.requested_on), esc(a.requested_by_name), esc(a.name), `${esc(a.city)}, ${esc(a.state)}`, words(a.status), esc(a.decision_note)],
      ),
    );
    const addForm = form(
      "/app/additions",
      `${field("Supplier name", input("name", "required maxlength=160"))}${field("City", input("city", "required maxlength=80"))}${field("State", input("state", 'required maxlength=2 size=3'))}${field("Spend", select("spend_band", SPEND_BANDS))}${field("Note for our analysts", input("note", "maxlength=1000 size=40"))}`,
      "Ask Tessary to add it",
    );
    const body = `<h1>${esc(actor.client_name)} suppliers</h1>${sections.join("")}
<h2>Add a supplier</h2><p class="meta">Give us the name and where they are; an analyst finds them in the supplier file or adds them, and they join your list as onboarding.</p>${addForm}${additions}`;
    res.type("html").send(page("My suppliers", actor, body));
  });

  router.post("/app/additions", (req, res) => {
    requestAddition(db, user(req), additionBody.parse(req.body), now());
    res.redirect(303, "/app");
  });

  function supplierPage(req: Request, res: Response, status: number, question = "", outcome = ""): void {
    const actor = user(req);
    const view = supplierView(db, actor, idParam(req.params.id));
    const { supplier, entry } = view;
    const base = `/app/suppliers/${supplier.id}`;
    const facts = table(
      ["Field", "Value", "Checked on", "Checked by", "Note"],
      view.facts.map((f) => [words(f.field), esc(f.value), esc(f.checked_on), esc(f.checked_by_name), esc(f.note)]),
    );
    const calls = table(
      ["Held on", "Contact", "By", "Write-up"],
      view.calls.map((c) => [esc(c.held_on), `${esc(c.contact_name)}, ${esc(c.contact_title)}`, esc(c.by_name), esc(c.write_up)]),
    );
    const notes = table(
      ["Written", "Author", "Note"],
      view.notes.map((n) => [stamp(n.written_at), `${esc(n.author)}${n.author_kind === "staff" ? " (Tessary)" : ""}`, esc(n.body)]),
    );
    const requests = table(
      ["Asked", "By", "Question", "Status", "Analyst", "Answered", ""],
      (view.check_requests as { id: number; requested_on: string; requested_by: number; requested_by_name: string; question: string; status: string; assigned_to_name: string | null; answered_on: string | null }[]).map((r) => [
        esc(r.requested_on),
        esc(r.requested_by_name),
        esc(r.question),
        esc(r.status),
        esc(r.assigned_to_name),
        esc(r.answered_on),
        OPEN.includes(r.status) && (actor.role === "client_admin" || r.requested_by === actor.id) ? form(`/app/check-requests/${r.id}/cancel`, "", "Cancel", "inline") : "",
      ]),
    );
    const body = `<h1>${esc(supplier.name)}</h1>
<p class="meta">${words(supplier.kind)} · ${esc(supplier.hq_city)}, ${esc(supplier.hq_state)} · on our list since ${esc(entry.added_on)}</p>
${supplier.plants ? `<p>Plants: ${esc(supplier.plants)}</p>` : ""}
${form(`${base}/entry`, `${field("Status", select("status", LIST_STATUSES, entry.status))}${field("Spend", select("spend_band", SPEND_BANDS, entry.spend_band))}`, "Save")}
<h2>Ask the assistant</h2>
<form class="box" method="post" action="${base}/ask"><textarea name="question" required maxlength="2000">${esc(question)}</textarea>
<button type="submit">Ask</button></form>${outcome}
<h2>Facts</h2>${facts}
<h2>Calls</h2>${calls}
<h2>Our notes</h2>${notes}${form(`${base}/notes`, `<textarea name="body" required maxlength="4000"></textarea>`, "Add note")}
<h2>Our check requests</h2>${requests}${form(`${base}/check-requests`, `<textarea name="question" required maxlength="2000"></textarea>`, "Ask Tessary to check")}`;
    res.status(status).type("html").send(page(supplier.name, actor, body));
  }

  router.get("/app/suppliers/:id", (req, res) => supplierPage(req, res, 200));

  router.post("/app/suppliers/:id/entry", (req, res) => {
    const supplierId = idParam(req.params.id);
    updateEntry(db, user(req), supplierId, entryChange.parse(req.body), now());
    res.redirect(303, `/app/suppliers/${supplierId}`);
  });

  router.post("/app/suppliers/:id/notes", (req, res) => {
    const supplierId = idParam(req.params.id);
    addClientNote(db, user(req), supplierId, noteBody.parse(req.body).body, now());
    res.redirect(303, `/app/suppliers/${supplierId}`);
  });

  router.post("/app/suppliers/:id/check-requests", (req, res) => {
    const supplierId = idParam(req.params.id);
    requestCheck(db, user(req), supplierId, requestBody.parse(req.body).question, now());
    res.redirect(303, `/app/suppliers/${supplierId}`);
  });

  router.post("/app/check-requests/:id/cancel", (req, res) => {
    const request = cancelCheck(db, user(req), idParam(req.params.id), now());
    res.redirect(303, `/app/suppliers/${request.supplier_id}`);
  });

  router.post("/app/suppliers/:id/ask", async (req, res) => {
    const parsed = questionBody.safeParse(req.body);
    if (!parsed.success) {
      const tooLong = parsed.error.issues.some((issue) => issue.code === "too_big");
      supplierPage(req, res, 400, "", `<p class="problem">${tooLong ? "Questions run up to 2,000 characters." : "Type a question first."}</p>`);
      return;
    }
    const { question } = parsed.data;
    try {
      const result = await answerQuestion(ctx, user(req), idParam(req.params.id), question, res);
      const calls = result.tool_calls.map((c) => `<li><code>${esc(c.name)} ${esc(JSON.stringify(c.arguments))}</code></li>`).join("");
      supplierPage(req, res, 200, question, `<div class="answer">${esc(result.answer)}</div>${calls ? `<p class="meta">Tool calls:</p><ul>${calls}</ul>` : ""}`);
    } catch (err) {
      if (!(err instanceof Problem) || err.status === 404) throw err;
      supplierPage(req, res, err.status, question, `<p class="problem">${esc(err.message)}</p>`);
    }
  });

  return router;
}
