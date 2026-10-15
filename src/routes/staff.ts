import { Router } from "express";
import { z } from "zod";
import { ADDITION_STATUSES, FACT_FIELDS, REQUEST_STATUSES, SUPPLIER_KINDS, type Db } from "../db.js";
import { hashPassword } from "../passwords.js";
import { Problem, notFound } from "../problem.js";
import { addNote, callsFor, factsFor, getRequest, getSupplier, logActivity, moveRequest, type StaffActor } from "../records.js";
import { emailTaken, endSessions, requireStaff } from "../session.js";
import { dayOf, id, idParam, isoDate, refuseFutureDate, stateCode, text } from "../validate.js";
import type { AppDeps } from "../app.js";

export const FILE_KEEPERS = ["analyst", "lead"] as const;
const ALL_STAFF = ["analyst", "lead", "admin"] as const;

export const supplierBody = z
  .object({ name: text(160), kind: z.enum(SUPPLIER_KINDS), hq_city: text(80), hq_state: stateCode, plants: z.string().trim().max(1000).default("") })
  .strict();

const supplierChange = z
  .object({ kind: z.enum(SUPPLIER_KINDS), hq_city: text(80), hq_state: stateCode, plants: z.string().trim().max(1000) })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "name at least one of kind, hq_city, hq_state, plants")
  .refine((body) => (body.hq_city === undefined) === (body.hq_state === undefined), "hq_city and hq_state change together");

const supplierQuery = z.object({ q: z.string().trim().max(160).optional(), kind: z.enum(SUPPLIER_KINDS).optional() });
export const factBody = z.object({ field: z.enum(FACT_FIELDS), value: text(1000), checked_on: isoDate, note: text(1000) }).strict();
export const callBody = z.object({ contact_name: text(120), contact_title: text(120), held_on: isoDate, write_up: text(20000) }).strict();
const requestQuery = z.object({ status: z.enum(REQUEST_STATUSES).optional() });
const additionQuery = z.object({ status: z.enum(ADDITION_STATUSES).optional() });
export const assignBody = z.object({ analyst_id: id }).strict();
export const answerBody = z.object({ note: text(4000) }).strict();
export const linkBody = z.union([z.object({ supplier_id: id }).strict(), z.object({ supplier: supplierBody }).strict()]);
export const declineBody = z.object({ decision_note: text(1000) }).strict();

const newClient = z
  .object({
    name: text(160),
    industry: text(120),
    city: text(80),
    state: stateCode,
    subscribed_on: isoDate,
    admin: z.object({ name: text(120), email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(10).max(200) }).strict(),
  })
  .strict();

export function supplierFile(db: Db, q?: string, kind?: string) {
  return db
    .prepare(
      `SELECT s.*, (SELECT count(*) FROM facts f WHERE f.supplier_id = s.id) AS fact_rows,
              (SELECT max(f.checked_on) FROM facts f WHERE f.supplier_id = s.id) AS last_checked_on,
              (SELECT count(*) FROM supplier_list l WHERE l.supplier_id = s.id) AS client_lists
         FROM suppliers s
        WHERE (? IS NULL OR instr(lower(s.name), lower(?)) > 0) AND (? IS NULL OR s.kind = ?) ORDER BY s.name`,
    )
    .all(q ?? null, q ?? null, kind ?? null, kind ?? null) as { id: number; name: string; kind: string; hq_city: string; hq_state: string; fact_rows: number }[];
}

export function supplierDetail(db: Db, supplierId: number) {
  const supplier = getSupplier(db, supplierId);
  return {
    supplier,
    facts: factsFor(db, supplier.id),
    calls: callsFor(db, supplier.id),
    changes: db
      .prepare("SELECT c.field, c.old_value, c.new_value, c.changed_at, s.name AS by_name FROM supplier_changes c JOIN staff s ON s.id = c.staff_id WHERE c.supplier_id = ? ORDER BY c.id")
      .all(supplier.id),
    lists: db
      .prepare("SELECT l.client_id, c.name AS client, l.status, l.spend_band, l.added_on FROM supplier_list l JOIN clients c ON c.id = l.client_id WHERE l.supplier_id = ? ORDER BY c.name")
      .all(supplier.id),
  };
}

function createSupplier(db: Db, actor: StaffActor, body: z.infer<typeof supplierBody>, at: Date): number {
  if (db.prepare("SELECT 1 FROM suppliers WHERE name = ? COLLATE NOCASE").get(body.name)) {
    throw new Problem(409, "supplier_exists", `${body.name} is already in the supplier file.`);
  }
  const { lastInsertRowid } = db
    .prepare("INSERT INTO suppliers (name, kind, hq_city, hq_state, plants, created_on) VALUES (?, ?, ?, ?, ?, ?)")
    .run(body.name, body.kind, body.hq_city, body.hq_state, body.plants, dayOf(at));
  logActivity(db, actor, "supplier.added", `supplier:${lastInsertRowid}`, at);
  return Number(lastInsertRowid);
}

export function addFact(db: Db, actor: StaffActor, supplierId: number, body: z.infer<typeof factBody>, at: Date) {
  const supplier = getSupplier(db, supplierId);
  refuseFutureDate(body.checked_on, at, "checked_on");
  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO facts (supplier_id, field, value, checked_on, checked_by, note) VALUES (?, ?, ?, ?, ?, ?)")
      .run(supplier.id, body.field, body.value, body.checked_on, actor.id, body.note);
    logActivity(db, actor, "fact.added", `supplier:${supplier.id} ${body.field}`, at);
    return { id: Number(lastInsertRowid), supplier_id: supplier.id, checked_by: actor.id, ...body };
  })();
}

export function addCall(db: Db, actor: StaffActor, supplierId: number, body: z.infer<typeof callBody>, at: Date) {
  const supplier = getSupplier(db, supplierId);
  refuseFutureDate(body.held_on, at, "held_on");
  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO calls (supplier_id, contact_name, contact_title, held_on, by_staff_id, write_up) VALUES (?, ?, ?, ?, ?, ?)")
      .run(supplier.id, body.contact_name, body.contact_title, body.held_on, actor.id, body.write_up);
    logActivity(db, actor, "call.added", `supplier:${supplier.id}`, at);
    return { id: Number(lastInsertRowid), supplier_id: supplier.id, by_staff_id: actor.id, ...body };
  })();
}

export function checkQueue(db: Db, status?: string) {
  return db
    .prepare(
      `SELECT r.*, c.name AS client, s.name AS supplier, u.name AS requested_by_name, a.name AS assigned_to_name
         FROM check_requests r JOIN clients c ON c.id = r.client_id JOIN suppliers s ON s.id = r.supplier_id
         JOIN client_users u ON u.id = r.requested_by LEFT JOIN staff a ON a.id = r.assigned_to
        WHERE (? IS NULL OR r.status = ?) ORDER BY r.requested_on DESC, r.id DESC`,
    )
    .all(status ?? null, status ?? null) as {
    id: number;
    client: string;
    supplier: string;
    supplier_id: number;
    requested_by_name: string;
    requested_on: string;
    question: string;
    status: string;
    assigned_to: number | null;
    assigned_to_name: string | null;
  }[];
}

function readRequest(db: Db, requestId: number) {
  const request = getRequest(db, requestId);
  if (!request) throw notFound(`Check request ${requestId}`);
  return request;
}

export function assignCheck(db: Db, actor: StaffActor, requestId: number, analystId: number, at: Date) {
  const request = readRequest(db, requestId);
  const analyst = db.prepare("SELECT role FROM staff WHERE id = ?").get(analystId) as { role: string } | undefined;
  if (analyst?.role !== "analyst" && analyst?.role !== "lead") throw new Problem(400, "not_an_analyst", `Staff ${analystId} is not an analyst.`);
  if (request.status !== "requested") {
    throw new Problem(409, "status_changed", `Check request ${request.id} is ${request.status}; only requested ones are assigned.`);
  }
  return moveRequest(db, actor, request, "assigned", at, { assigned_to: analystId });
}

export function answerCheck(db: Db, actor: StaffActor, requestId: number, note: string, at: Date) {
  const request = readRequest(db, requestId);
  if (request.status !== "assigned") {
    throw new Problem(409, "status_changed", `Check request ${request.id} is ${request.status}; only assigned ones are answered.`);
  }
  if (request.assigned_to !== actor.id) throw new Problem(403, "forbidden", "Only the analyst the request is assigned to can answer it.");
  let saved: ReturnType<typeof addNote> | undefined;
  const answered = moveRequest(db, actor, request, "answered", at, {}, () => {
    saved = addNote(db, actor, request.client_id, request.supplier_id, note, at);
  });
  return { check_request: answered, note: saved };
}

export function additionQueue(db: Db, status?: string) {
  return db
    .prepare(
      `SELECT a.*, c.name AS client, u.name AS requested_by_name, s.name AS supplier,
              (SELECT f.id FROM suppliers f WHERE f.name = a.name COLLATE NOCASE) AS same_name_supplier_id
         FROM addition_requests a JOIN clients c ON c.id = a.client_id JOIN client_users u ON u.id = a.requested_by
         LEFT JOIN suppliers s ON s.id = a.supplier_id
        WHERE (? IS NULL OR a.status = ?) ORDER BY a.requested_on DESC, a.id DESC`,
    )
    .all(status ?? null, status ?? null) as {
    id: number;
    client: string;
    requested_by_name: string;
    requested_on: string;
    name: string;
    city: string;
    state: string;
    note: string;
    status: string;
    same_name_supplier_id: number | null;
    supplier: string | null;
  }[];
}

function openAddition(db: Db, requestId: number) {
  const request = db.prepare("SELECT * FROM addition_requests WHERE id = ?").get(requestId) as
    | { id: number; client_id: number; requested_by: number; spend_band: string; status: string }
    | undefined;
  if (!request) throw notFound(`Addition request ${requestId}`);
  if (request.status !== "requested") throw new Problem(409, "status_changed", `Addition request ${requestId} is ${request.status}.`);
  return request;
}

export function linkAddition(db: Db, actor: StaffActor, requestId: number, body: z.infer<typeof linkBody>, at: Date) {
  return db.transaction(() => {
    const request = openAddition(db, requestId);
    const supplierId = "supplier_id" in body ? getSupplier(db, body.supplier_id).id : createSupplier(db, actor, body.supplier, at);
    if (db.prepare("SELECT 1 FROM supplier_list WHERE client_id = ? AND supplier_id = ?").get(request.client_id, supplierId)) {
      throw new Problem(409, "already_on_list", `Supplier ${supplierId} is already on that client's list.`);
    }
    const { changes } = db
      .prepare("UPDATE addition_requests SET status = 'linked', supplier_id = ?, decided_by = ?, decided_on = ? WHERE id = ? AND status = 'requested'")
      .run(supplierId, actor.id, dayOf(at), request.id);
    if (changes === 0) throw new Problem(409, "status_changed", `Addition request ${requestId} was decided by someone else.`);
    db.prepare("INSERT INTO supplier_list (client_id, supplier_id, added_on, added_by, status, spend_band) VALUES (?, ?, ?, ?, 'onboarding', ?)").run(
      request.client_id,
      supplierId,
      dayOf(at),
      request.requested_by,
      request.spend_band,
    );
    logActivity(db, actor, "addition.linked", `addition_request:${request.id} supplier:${supplierId}`, at, request.client_id);
    return db.prepare("SELECT * FROM addition_requests WHERE id = ?").get(request.id);
  })();
}

export function declineAddition(db: Db, actor: StaffActor, requestId: number, note: string, at: Date) {
  return db.transaction(() => {
    const request = openAddition(db, requestId);
    const { changes } = db
      .prepare("UPDATE addition_requests SET status = 'declined', decided_by = ?, decided_on = ?, decision_note = ? WHERE id = ? AND status = 'requested'")
      .run(actor.id, dayOf(at), note, request.id);
    if (changes === 0) throw new Problem(409, "status_changed", `Addition request ${requestId} was decided by someone else.`);
    logActivity(db, actor, "addition.declined", `addition_request:${request.id}`, at, request.client_id);
    return db.prepare("SELECT * FROM addition_requests WHERE id = ?").get(request.id);
  })();
}

export function recentActivity(db: Db, limit = 100) {
  return db
    .prepare(
      `SELECT a.id, a.at, a.actor_kind, coalesce(s.name, u.name) AS actor, c.name AS client, a.action, a.subject
         FROM activity a LEFT JOIN staff s ON s.id = a.staff_id LEFT JOIN client_users u ON u.id = a.client_user_id
         LEFT JOIN clients c ON c.id = a.client_id ORDER BY a.at DESC, a.id DESC LIMIT ?`,
    )
    .all(limit) as { id: number; at: string; actor_kind: string; actor: string; client: string | null; action: string; subject: string }[];
}

export function staffRoutes({ db, now }: AppDeps): Router {
  const router = Router({ caseSensitive: true });
  const staff = (req: Parameters<typeof requireStaff>[0], doing: string) => requireStaff(req, FILE_KEEPERS, doing);

  router.get("/staff/suppliers", (req, res) => {
    requireStaff(req, ALL_STAFF, "read the supplier file");
    const { q, kind } = supplierQuery.parse(req.query);
    res.json({ suppliers: supplierFile(db, q, kind) });
  });

  router.post("/staff/suppliers", (req, res) => {
    const actor = staff(req, "add suppliers");
    const body = supplierBody.parse(req.body);
    const supplierId = db.transaction(() => createSupplier(db, actor, body, now()))();
    res.status(201).json({ supplier: getSupplier(db, supplierId) });
  });

  router.get("/staff/suppliers/:id", (req, res) => {
    requireStaff(req, ALL_STAFF, "read the supplier file");
    res.json(supplierDetail(db, idParam(req.params.id)));
  });

  router.patch("/staff/suppliers/:id", (req, res) => {
    const actor = staff(req, "change suppliers");
    const supplier = getSupplier(db, idParam(req.params.id));
    const changes = supplierChange.parse(req.body);
    const at = now();
    db.transaction(() => {
      const record = db.prepare(
        "INSERT INTO supplier_changes (supplier_id, staff_id, field, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)",
      );
      let changed = false;
      for (const [column, value] of Object.entries(changes) as [keyof typeof changes, string][]) {
        if (supplier[column] === value) continue;
        db.prepare(`UPDATE suppliers SET ${column} = ? WHERE id = ?`).run(value, supplier.id);
        record.run(supplier.id, actor.id, column, supplier[column], value, at.toISOString());
        changed = true;
      }
      if (changed) logActivity(db, actor, "supplier.updated", `supplier:${supplier.id}`, at);
    })();
    res.json({ supplier: getSupplier(db, supplier.id) });
  });

  router.post("/staff/suppliers/:id/facts", (req, res) => {
    const actor = staff(req, "add fact rows");
    res.status(201).json({ fact: addFact(db, actor, idParam(req.params.id), factBody.parse(req.body), now()) });
  });

  router.post("/staff/suppliers/:id/calls", (req, res) => {
    const actor = staff(req, "add call write-ups");
    res.status(201).json({ call: addCall(db, actor, idParam(req.params.id), callBody.parse(req.body), now()) });
  });

  router.get("/staff/check-requests", (req, res) => {
    requireStaff(req, ALL_STAFF, "read check requests");
    res.json({ check_requests: checkQueue(db, requestQuery.parse(req.query).status) });
  });

  router.post("/staff/check-requests/:id/assign", (req, res) => {
    const actor = requireStaff(req, ["lead"], "assign check requests");
    const requestId = idParam(req.params.id);
    res.json({ check_request: assignCheck(db, actor, requestId, assignBody.parse(req.body).analyst_id, now()) });
  });

  router.post("/staff/check-requests/:id/answer", (req, res) => {
    const actor = staff(req, "answer check requests");
    const requestId = idParam(req.params.id);
    res.json(answerCheck(db, actor, requestId, answerBody.parse(req.body).note, now()));
  });

  router.get("/staff/addition-requests", (req, res) => {
    requireStaff(req, ALL_STAFF, "read addition requests");
    res.json({ addition_requests: additionQueue(db, additionQuery.parse(req.query).status) });
  });

  router.post("/staff/addition-requests/:id/link", (req, res) => {
    const actor = staff(req, "link addition requests");
    const requestId = idParam(req.params.id);
    res.json({ addition_request: linkAddition(db, actor, requestId, linkBody.parse(req.body), now()) });
  });

  router.post("/staff/addition-requests/:id/decline", (req, res) => {
    const actor = staff(req, "decline addition requests");
    const requestId = idParam(req.params.id);
    res.json({ addition_request: declineAddition(db, actor, requestId, declineBody.parse(req.body).decision_note, now()) });
  });

  router.get("/staff/activity", (req, res) => {
    requireStaff(req, ALL_STAFF, "read activity");
    res.json({ activity: recentActivity(db) });
  });

  router.get("/staff/clients", (req, res) => {
    requireStaff(req, ["admin"], "manage clients");
    const clients = db
      .prepare(
        `SELECT c.*, (SELECT count(*) FROM client_users u WHERE u.client_id = c.id) AS users,
                (SELECT count(*) FROM supplier_list l WHERE l.client_id = c.id) AS list_entries
           FROM clients c ORDER BY c.name`,
      )
      .all();
    res.json({ clients });
  });

  router.post("/staff/clients", async (req, res) => {
    const actor = requireStaff(req, ["admin"], "manage clients");
    const body = newClient.parse(req.body);
    const at = now();
    refuseFutureDate(body.subscribed_on, at, "subscribed_on");
    const hash = await hashPassword(body.admin.password);
    const created = db.transaction(() => {
      if (db.prepare("SELECT 1 FROM clients WHERE name = ? COLLATE NOCASE").get(body.name)) {
        throw new Problem(409, "client_exists", `${body.name} is already a client.`);
      }
      if (emailTaken(db, body.admin.email)) throw new Problem(409, "email_taken", `${body.admin.email} already signs in here.`);
      const clientId = Number(
        db
          .prepare("INSERT INTO clients (name, industry, city, state, subscribed_on, status) VALUES (?, ?, ?, ?, ?, 'active')")
          .run(body.name, body.industry, body.city, body.state, body.subscribed_on).lastInsertRowid,
      );
      const userId = Number(
        db
          .prepare("INSERT INTO client_users (client_id, name, email, role, password_hash) VALUES (?, ?, ?, 'client_admin', ?)")
          .run(clientId, body.admin.name, body.admin.email, hash).lastInsertRowid,
      );
      logActivity(db, actor, "client.added", `client:${clientId}`, at, clientId);
      logActivity(db, actor, "client_user.added", `client_user:${userId}`, at, clientId);
      const { admin: _admin, ...client } = body;
      return { client: { id: clientId, ...client, status: "active" }, admin: { id: userId, name: body.admin.name, email: body.admin.email, role: "client_admin" } };
    })();
    res.status(201).json(created);
  });

  router.post("/staff/clients/:id/end", (req, res) => {
    const actor = requireStaff(req, ["admin"], "manage clients");
    const clientId = idParam(req.params.id);
    const at = now();
    db.transaction(() => {
      if (!db.prepare("SELECT 1 FROM clients WHERE id = ?").get(clientId)) throw notFound(`Client ${clientId}`);
      const { changes } = db.prepare("UPDATE clients SET status = 'ended' WHERE id = ? AND status = 'active'").run(clientId);
      if (changes === 0) throw new Problem(409, "status_changed", `Client ${clientId} has already ended.`);
      endSessions(db, at, { clientId });
      logActivity(db, actor, "client.ended", `client:${clientId}`, at, clientId);
    })();
    res.json({ client: db.prepare("SELECT * FROM clients WHERE id = ?").get(clientId) });
  });

  return router;
}
