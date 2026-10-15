import { Router } from "express";
import { z } from "zod";
import { CLIENT_ROLES, LIST_STATUSES, SPEND_BANDS, type Db } from "../db.js";
import { hashPassword } from "../passwords.js";
import { Problem, notFound } from "../problem.js";
import {
  OPEN_REQUEST_STATUSES,
  addNote,
  callsFor,
  entryNotes,
  entryRequests,
  factsFor,
  getRequest,
  listEntry,
  listedSupplier,
  logActivity,
  moveRequest,
  type ClientActor,
} from "../records.js";
import { emailTaken, endSessions, requireClientUser } from "../session.js";
import { dayOf, idParam, stateCode, text } from "../validate.js";
import type { AppDeps } from "../app.js";

export const additionBody = z
  .object({ name: text(160), city: text(80), state: stateCode, note: z.string().trim().max(1000).default(""), spend_band: z.enum(SPEND_BANDS) })
  .strict();

export const entryChange = z
  .object({ status: z.enum(LIST_STATUSES), spend_band: z.enum(SPEND_BANDS) })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "name status or spend_band");

const listQuery = z.object({ status: z.enum(LIST_STATUSES).optional() });
export const noteBody = z.object({ body: text(4000) }).strict();
export const requestBody = z.object({ question: text(2000) }).strict();
const newClientUser = z
  .object({ name: text(120), email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(10).max(200), role: z.enum(CLIENT_ROLES) })
  .strict();

export function clientEntries(db: Db, clientId: number) {
  return db
    .prepare(
      `SELECT l.supplier_id, s.name, s.kind, s.hq_city, s.hq_state, l.status, l.spend_band, l.added_on,
              (SELECT count(*) FROM check_requests r WHERE r.client_id = l.client_id AND r.supplier_id = l.supplier_id
                  AND r.status IN ('requested', 'assigned')) AS open_requests
         FROM supplier_list l JOIN suppliers s ON s.id = l.supplier_id WHERE l.client_id = ? ORDER BY s.name`,
    )
    .all(clientId) as {
    supplier_id: number;
    name: string;
    kind: string;
    hq_city: string;
    hq_state: string;
    status: (typeof LIST_STATUSES)[number];
    spend_band: string;
    added_on: string;
    open_requests: number;
  }[];
}

export function clientAdditions(db: Db, clientId: number) {
  return db
    .prepare(
      `SELECT a.id, a.requested_on, u.name AS requested_by_name, a.name, a.city, a.state, a.note, a.spend_band, a.status,
              a.supplier_id, a.decided_on, a.decision_note
         FROM addition_requests a JOIN client_users u ON u.id = a.requested_by WHERE a.client_id = ? ORDER BY a.requested_on DESC, a.id DESC`,
    )
    .all(clientId) as {
    id: number;
    requested_on: string;
    requested_by_name: string;
    name: string;
    city: string;
    state: string;
    status: string;
    decision_note: string | null;
  }[];
}

export function requestAddition(db: Db, actor: ClientActor, body: z.infer<typeof additionBody>, at: Date) {
  return db.transaction(() => {
    const listed = db
      .prepare("SELECT s.id FROM supplier_list l JOIN suppliers s ON s.id = l.supplier_id WHERE l.client_id = ? AND s.name = ? COLLATE NOCASE")
      .get(actor.client_id, body.name);
    if (listed) throw new Problem(409, "already_on_list", `${body.name} is already on your list.`);
    const open = db
      .prepare("SELECT id FROM addition_requests WHERE client_id = ? AND lower(name) = lower(?) AND status = 'requested'")
      .get(actor.client_id, body.name) as { id: number } | undefined;
    if (open) throw new Problem(409, "request_open", `Your request to add ${body.name} is open.`, { addition_request_id: open.id });
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO addition_requests (client_id, requested_by, requested_on, name, city, state, note, spend_band, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'requested')`,
      )
      .run(actor.client_id, actor.id, dayOf(at), body.name, body.city, body.state, body.note, body.spend_band);
    logActivity(db, actor, "addition.requested", `addition_request:${lastInsertRowid}`, at);
    return { id: Number(lastInsertRowid), requested_on: dayOf(at), ...body, status: "requested" };
  })();
}

export function updateEntry(db: Db, actor: ClientActor, supplierId: number, changes: z.infer<typeof entryChange>, at: Date) {
  const supplier = listedSupplier(db, actor.client_id, supplierId);
  const columns = Object.keys(changes) as (keyof typeof changes)[];
  db.transaction(() => {
    db.prepare(
      `UPDATE supplier_list SET ${columns.map((c) => `${c} = @${c}`).join(", ")} WHERE client_id = @client_id AND supplier_id = @supplier_id`,
    ).run({ ...changes, client_id: actor.client_id, supplier_id: supplier.id });
    logActivity(db, actor, "list.updated", `supplier:${supplier.id} ${columns.map((c) => `${c}=${changes[c]}`).join(" ")}`, at);
  })();
  return listEntry(db, actor.client_id, supplier.id);
}

export function supplierView(db: Db, actor: ClientActor, supplierId: number) {
  const supplier = listedSupplier(db, actor.client_id, supplierId);
  return {
    supplier,
    facts: factsFor(db, supplier.id),
    calls: callsFor(db, supplier.id),
    entry: listEntry(db, actor.client_id, supplier.id)!,
    notes: entryNotes(db, actor.client_id, supplier.id),
    check_requests: entryRequests(db, actor.client_id, supplier.id),
  };
}

export function addClientNote(db: Db, actor: ClientActor, supplierId: number, body: string, at: Date) {
  const supplier = listedSupplier(db, actor.client_id, supplierId);
  return db.transaction(() => addNote(db, actor, actor.client_id, supplier.id, body, at))();
}

export function requestCheck(db: Db, actor: ClientActor, supplierId: number, question: string, at: Date) {
  const supplier = listedSupplier(db, actor.client_id, supplierId);
  return db.transaction(() => {
    const open = db
      .prepare("SELECT id FROM check_requests WHERE client_id = ? AND supplier_id = ? AND status IN ('requested', 'assigned')")
      .get(actor.client_id, supplier.id) as { id: number } | undefined;
    if (open) throw new Problem(409, "request_open", `Check request ${open.id} on ${supplier.name} is open.`, { check_request_id: open.id });
    const { lastInsertRowid } = db
      .prepare("INSERT INTO check_requests (client_id, supplier_id, requested_by, requested_on, question, status) VALUES (?, ?, ?, ?, ?, 'requested')")
      .run(actor.client_id, supplier.id, actor.id, dayOf(at), question);
    logActivity(db, actor, "check_request.requested", `check_request:${lastInsertRowid}`, at);
    return getRequest(db, Number(lastInsertRowid));
  })();
}

export function cancelCheck(db: Db, actor: ClientActor, requestId: number, at: Date) {
  const request = getRequest(db, requestId);
  if (!request || request.client_id !== actor.client_id) throw notFound(`Check request ${requestId}`);
  if (actor.role !== "client_admin" && request.requested_by !== actor.id) {
    throw new Problem(403, "forbidden", "Only the person who asked or a client admin can cancel a check request.");
  }
  if (!(OPEN_REQUEST_STATUSES as readonly string[]).includes(request.status)) {
    throw new Problem(409, "status_changed", `Check request ${requestId} is ${request.status}; only open requests can be cancelled.`);
  }
  return moveRequest(db, actor, request, "cancelled", at);
}

export function clientRoutes({ db, now }: AppDeps): Router {
  const router = Router({ caseSensitive: true });

  router.get("/list", (req, res) => {
    const actor = requireClientUser(req, "read a supplier list");
    const { status } = listQuery.parse(req.query);
    const entries = clientEntries(db, actor.client_id).filter((e) => !status || e.status === status);
    res.json({ client: { id: actor.client_id, name: actor.client_name }, entries });
  });

  router.post("/list", (req, res) => {
    const actor = requireClientUser(req, "add suppliers to a list");
    res.status(201).json({ addition_request: requestAddition(db, actor, additionBody.parse(req.body), now()) });
  });

  router.get("/addition-requests", (req, res) => {
    const actor = requireClientUser(req, "read addition requests");
    res.json({ addition_requests: clientAdditions(db, actor.client_id) });
  });

  router.patch("/list/:supplierId", (req, res) => {
    const actor = requireClientUser(req, "change a supplier list");
    const supplierId = idParam(req.params.supplierId);
    listedSupplier(db, actor.client_id, supplierId);
    res.json({ entry: updateEntry(db, actor, supplierId, entryChange.parse(req.body), now()) });
  });

  router.get("/suppliers/:id", (req, res) => {
    const actor = requireClientUser(req, "read supplier pages");
    res.json(supplierView(db, actor, idParam(req.params.id)));
  });

  router.post("/suppliers/:id/notes", (req, res) => {
    const actor = requireClientUser(req, "add notes");
    const supplierId = idParam(req.params.id);
    listedSupplier(db, actor.client_id, supplierId);
    res.status(201).json({ note: addClientNote(db, actor, supplierId, noteBody.parse(req.body).body, now()) });
  });

  router.post("/suppliers/:id/check-requests", (req, res) => {
    const actor = requireClientUser(req, "request checks");
    const supplierId = idParam(req.params.id);
    listedSupplier(db, actor.client_id, supplierId);
    res.status(201).json({ check_request: requestCheck(db, actor, supplierId, requestBody.parse(req.body).question, now()) });
  });

  router.post("/check-requests/:id/cancel", (req, res) => {
    const actor = requireClientUser(req, "cancel check requests");
    res.json({ check_request: cancelCheck(db, actor, idParam(req.params.id), now()) });
  });

  router.get("/client-users", (req, res) => {
    const actor = requireClientUser(req, "list users", ["client_admin"]);
    const users = db.prepare("SELECT id, name, email, role, deactivated_on FROM client_users WHERE client_id = ? ORDER BY id").all(actor.client_id);
    res.json({ users });
  });

  router.post("/client-users", async (req, res) => {
    const actor = requireClientUser(req, "add users", ["client_admin"]);
    const body = newClientUser.parse(req.body);
    const hash = await hashPassword(body.password);
    const at = now();
    const user = db.transaction(() => {
      if (emailTaken(db, body.email)) throw new Problem(409, "email_taken", `${body.email} already signs in here.`);
      const { lastInsertRowid } = db
        .prepare("INSERT INTO client_users (client_id, name, email, role, password_hash) VALUES (?, ?, ?, ?, ?)")
        .run(actor.client_id, body.name, body.email, body.role, hash);
      logActivity(db, actor, "client_user.added", `client_user:${lastInsertRowid}`, at);
      return { id: Number(lastInsertRowid), client_id: actor.client_id, name: body.name, email: body.email, role: body.role };
    })();
    res.status(201).json({ user });
  });

  router.post("/client-users/:id/deactivate", (req, res) => {
    const actor = requireClientUser(req, "deactivate users", ["client_admin"]);
    const userId = idParam(req.params.id);
    const at = now();
    db.transaction(() => {
      const user = db.prepare("SELECT id FROM client_users WHERE id = ? AND client_id = ?").get(userId, actor.client_id);
      if (!user) throw notFound(`User ${userId}`);
      if (userId === actor.id) throw new Problem(409, "cannot_deactivate_self", "Ask another client admin to deactivate you.");
      const { changes } = db.prepare("UPDATE client_users SET deactivated_on = ? WHERE id = ? AND deactivated_on IS NULL").run(dayOf(at), userId);
      if (changes === 0) throw new Problem(409, "status_changed", `User ${userId} is already deactivated.`);
      endSessions(db, at, { clientUserId: userId });
      logActivity(db, actor, "client_user.deactivated", `client_user:${userId}`, at);
    })();
    res.json({ user: db.prepare("SELECT id, name, email, role, deactivated_on FROM client_users WHERE id = ?").get(userId) });
  });

  return router;
}
