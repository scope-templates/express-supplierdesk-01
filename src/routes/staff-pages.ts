import { Router, type Request } from "express";
import { z } from "zod";
import { FACT_FIELDS, SUPPLIER_KINDS } from "../db.js";
import { requireStaff } from "../session.js";
import { dayOf, idParam } from "../validate.js";
import {
  FILE_KEEPERS,
  addCall,
  addFact,
  additionQueue,
  answerBody,
  answerCheck,
  assignBody,
  assignCheck,
  callBody,
  checkQueue,
  declineAddition,
  declineBody,
  factBody,
  linkAddition,
  linkBody,
  recentActivity,
  supplierBody,
  supplierDetail,
  supplierFile,
} from "./staff.js";
import { esc, field, form, input, page, select, signedInPage, stamp, table, words } from "./page-kit.js";
import type { AppContext } from "../app.js";

const searchQuery = z.object({ q: z.string().trim().max(160).optional() });

export function staffPages(ctx: AppContext): Router {
  const { db, now } = ctx;
  const router = Router({ caseSensitive: true });
  const me = (req: Request) => requireStaff(req, ["analyst", "lead", "admin"], "use the desk");
  router.use("/desk", signedInPage(ctx, "staff"));
  const keeper = (req: Request, doing: string) => requireStaff(req, FILE_KEEPERS, doing);

  router.get("/desk", (req, res) => {
    const actor = me(req);
    const analysts = db.prepare(`SELECT id, name FROM staff WHERE role IN ('analyst', 'lead') ORDER BY name`).all() as { id: number; name: string }[];
    const pick = `<select name="analyst_id">${analysts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>`;
    const open = checkQueue(db).filter((r) => r.status === "requested" || r.status === "assigned");
    const rows = open.map((r) => [
      esc(r.requested_on),
      esc(r.client),
      `<a href="/desk/suppliers/${r.supplier_id}">${esc(r.supplier)}</a>`,
      esc(r.requested_by_name),
      esc(r.question),
      esc(r.status),
      esc(r.assigned_to_name),
      r.status === "requested" && actor.role === "lead"
        ? form(`/desk/check-requests/${r.id}/assign`, pick, "Assign", "inline")
        : r.status === "assigned" && r.assigned_to === actor.id
          ? form(`/desk/check-requests/${r.id}/answer`, `<textarea name="note" required maxlength="4000" placeholder="Summary note for the client"></textarea>`, "Answer", "inline")
          : "",
    ]);
    const body = `<h1>Open check requests <span class="meta">(${open.length})</span></h1>${table(
      ["Asked", "Client", "Supplier", "By", "Question", "Status", "Analyst", ""],
      rows,
    )}`;
    res.type("html").send(page("Check requests", actor, body));
  });

  router.post("/desk/check-requests/:id/assign", (req, res) => {
    assignCheck(db, requireStaff(req, ["lead"], "assign check requests"), idParam(req.params.id), assignBody.parse(req.body).analyst_id, now());
    res.redirect(303, "/desk");
  });

  router.post("/desk/check-requests/:id/answer", (req, res) => {
    answerCheck(db, keeper(req, "answer check requests"), idParam(req.params.id), answerBody.parse(req.body).note, now());
    res.redirect(303, "/desk");
  });

  router.get("/desk/suppliers", (req, res) => {
    const { q } = searchQuery.parse(req.query);
    const rows = supplierFile(db, q || undefined).map((s) => [
      `<a href="/desk/suppliers/${s.id}">${esc(s.name)}</a>`,
      words(s.kind),
      `${esc(s.hq_city)}, ${esc(s.hq_state)}`,
      esc(s.fact_rows),
    ]);
    const search = `<form class="box" method="get" action="/desk/suppliers">${field("Name", `<input name="q" value="${esc(q)}">`)} <button type="submit">Search</button></form>`;
    res.type("html").send(page("Supplier file", me(req), `<h1>Supplier file</h1>${search}${table(["Supplier", "Kind", "Headquarters", "Fact rows"], rows)}`));
  });

  router.get("/desk/suppliers/:id", (req, res) => {
    const actor = me(req);
    const view = supplierDetail(db, idParam(req.params.id));
    const { supplier } = view;
    const base = `/desk/suppliers/${supplier.id}`;
    const canWrite = actor.role !== "admin";
    const changes = view.changes as { field: string; old_value: string; new_value: string; changed_at: string; by_name: string }[];
    const lists = view.lists as { client: string; status: string; spend_band: string; added_on: string }[];
    const body = `<h1>${esc(supplier.name)}</h1>
<p class="meta">${words(supplier.kind)} · ${esc(supplier.hq_city)}, ${esc(supplier.hq_state)} · in the file since ${esc(supplier.created_on)}</p>
${supplier.plants ? `<p>Plants: ${esc(supplier.plants)}</p>` : ""}
<h2>Facts</h2>${table(["Field", "Value", "Checked on", "Checked by", "Note"], view.facts.map((f) => [words(f.field), esc(f.value), esc(f.checked_on), esc(f.checked_by_name), esc(f.note)]))}
${canWrite ? form(`${base}/facts`, `${field("Field", select("field", FACT_FIELDS))}${field("Value", input("value", "required maxlength=1000 size=40"))}${field("Checked on", `<input type="date" name="checked_on" required value="${dayOf(now())}">`)}${field("How you know", input("note", "required maxlength=1000 size=30"))}`, "Add fact") : ""}
<h2>Calls</h2>${table(["Held on", "Contact", "By", "Write-up"], view.calls.map((c) => [esc(c.held_on), `${esc(c.contact_name)}, ${esc(c.contact_title)}`, esc(c.by_name), esc(c.write_up)]))}
${canWrite ? form(`${base}/calls`, `${field("Contact", input("contact_name", "required maxlength=120"))}${field("Title", input("contact_title", "required maxlength=120"))}${field("Held on", `<input type="date" name="held_on" required value="${dayOf(now())}">`)}<textarea name="write_up" required maxlength="20000"></textarea>`, "Add call") : ""}
<h2>Changes to this row</h2>${table(["When", "By", "Field", "From", "To"], changes.map((c) => [stamp(c.changed_at), esc(c.by_name), words(c.field), esc(c.old_value), esc(c.new_value)]))}
<h2>Client lists</h2>${table(["Client", "Status", "Spend", "Added"], lists.map((l) => [esc(l.client), words(l.status), words(l.spend_band), esc(l.added_on)]))}`;
    res.type("html").send(page(supplier.name, actor, body));
  });

  router.post("/desk/suppliers/:id/facts", (req, res) => {
    const supplierId = idParam(req.params.id);
    addFact(db, keeper(req, "add fact rows"), supplierId, factBody.parse(req.body), now());
    res.redirect(303, `/desk/suppliers/${supplierId}`);
  });

  router.post("/desk/suppliers/:id/calls", (req, res) => {
    const supplierId = idParam(req.params.id);
    addCall(db, keeper(req, "add call write-ups"), supplierId, callBody.parse(req.body), now());
    res.redirect(303, `/desk/suppliers/${supplierId}`);
  });

  router.get("/desk/additions", (req, res) => {
    const actor = me(req);
    const all = additionQueue(db);
    const open = all.filter((a) => a.status === "requested");
    const decided = all.filter((a) => a.status !== "requested").slice(0, 50);
    const actions = (a: (typeof all)[number]) =>
      actor.role === "admin"
        ? ""
        : form(`/desk/additions/${a.id}/link`, field("Supplier id", input("supplier_id", `required size=6 value="${esc(a.same_name_supplier_id ?? "")}"`)), "Link", "inline") +
          form(
            `/desk/additions/${a.id}/create`,
            `<input type="hidden" name="name" value="${esc(a.name)}"><input type="hidden" name="hq_city" value="${esc(a.city)}"><input type="hidden" name="hq_state" value="${esc(a.state)}">${select("kind", SUPPLIER_KINDS)}`,
            "Add to file and link",
            "inline",
          ) +
          form(`/desk/additions/${a.id}/decline`, input("decision_note", 'required maxlength=1000 placeholder="Why"'), "Decline", "inline");
    const body = `<h1>Addition requests</h1>${table(
      ["Asked", "Client", "By", "Name", "Where", "Note", "Same name in file", ""],
      open.map((a) => [
        esc(a.requested_on),
        esc(a.client),
        esc(a.requested_by_name),
        esc(a.name),
        `${esc(a.city)}, ${esc(a.state)}`,
        esc(a.note),
        a.same_name_supplier_id ? `<a href="/desk/suppliers/${a.same_name_supplier_id}">${a.same_name_supplier_id}</a>` : "",
        actions(a),
      ]),
    )}<h2>Decided</h2>${table(
      ["Asked", "Client", "Name", "Status", "Linked to"],
      decided.map((a) => [esc(a.requested_on), esc(a.client), esc(a.name), words(a.status), esc(a.supplier)]),
    )}`;
    res.type("html").send(page("Addition requests", actor, body));
  });

  router.post("/desk/additions/:id/link", (req, res) => {
    linkAddition(db, keeper(req, "link addition requests"), idParam(req.params.id), linkBody.parse(req.body), now());
    res.redirect(303, "/desk/additions");
  });

  router.post("/desk/additions/:id/create", (req, res) => {
    linkAddition(db, keeper(req, "add suppliers"), idParam(req.params.id), { supplier: supplierBody.parse(req.body) }, now());
    res.redirect(303, "/desk/additions");
  });

  router.post("/desk/additions/:id/decline", (req, res) => {
    declineAddition(db, keeper(req, "decline addition requests"), idParam(req.params.id), declineBody.parse(req.body).decision_note, now());
    res.redirect(303, "/desk/additions");
  });

  router.get("/desk/activity", (req, res) => {
    const rows = recentActivity(db).map((a) => [stamp(a.at), esc(a.actor), esc(a.client), esc(a.action), esc(a.subject)]);
    res.type("html").send(page("Activity", me(req), `<h1>Recent activity</h1>${table(["When", "Who", "Client", "Action", "Subject"], rows)}`));
  });

  return router;
}
