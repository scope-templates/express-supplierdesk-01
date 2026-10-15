import type { ClientRole, Db, FactField, RequestStatus, StaffRole } from "./db.js";
import { Problem, notFound } from "./problem.js";
import { dayOf } from "./validate.js";

export const OPEN_REQUEST_STATUSES = ["requested", "assigned"] as const;

export interface StaffActor {
  kind: "staff";
  id: number;
  name: string;
  email: string;
  role: StaffRole;
}

export interface ClientActor {
  kind: "client_user";
  id: number;
  name: string;
  email: string;
  role: ClientRole;
  client_id: number;
  client_name: string;
}

export type Actor = StaffActor | ClientActor;

export interface SupplierRow {
  id: number;
  name: string;
  kind: string;
  hq_city: string;
  hq_state: string;
  plants: string;
  created_on: string;
}

export interface RequestRow {
  id: number;
  client_id: number;
  supplier_id: number;
  requested_by: number;
  requested_on: string;
  question: string;
  status: RequestStatus;
  assigned_to: number | null;
  answered_on: string | null;
}

export function logActivity(db: Db, actor: Actor, action: string, subject: string, at: Date, clientId?: number | null): void {
  db.prepare(
    "INSERT INTO activity (actor_kind, staff_id, client_user_id, client_id, action, subject, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    actor.kind,
    actor.kind === "staff" ? actor.id : null,
    actor.kind === "client_user" ? actor.id : null,
    actor.kind === "client_user" ? actor.client_id : (clientId ?? null),
    action,
    subject,
    at.toISOString(),
  );
}

export function getSupplier(db: Db, supplierId: number): SupplierRow {
  const row = db.prepare("SELECT * FROM suppliers WHERE id = ?").get(supplierId) as SupplierRow | undefined;
  if (!row) throw notFound(`Supplier ${supplierId}`);
  return row;
}

export function listEntry(db: Db, clientId: number, supplierId: number) {
  return db
    .prepare(
      `SELECT l.client_id, l.supplier_id, l.added_on, l.added_by, u.name AS added_by_name, l.status, l.spend_band
         FROM supplier_list l JOIN client_users u ON u.id = l.added_by
        WHERE l.client_id = ? AND l.supplier_id = ?`,
    )
    .get(clientId, supplierId) as
    | { client_id: number; supplier_id: number; added_on: string; added_by: number; added_by_name: string; status: string; spend_band: string }
    | undefined;
}

export function listedSupplier(db: Db, clientId: number, supplierId: number): SupplierRow {
  if (!listEntry(db, clientId, supplierId)) throw notFound(`Supplier ${supplierId}`);
  return getSupplier(db, supplierId);
}

export function factsFor(db: Db, supplierId: number, field?: FactField) {
  return db
    .prepare(
      `SELECT f.id, f.field, f.value, f.checked_on, f.checked_by, s.name AS checked_by_name, f.note
         FROM facts f JOIN staff s ON s.id = f.checked_by
        WHERE f.supplier_id = ? AND (? IS NULL OR f.field = ?) ORDER BY f.checked_on, f.id`,
    )
    .all(supplierId, field ?? null, field ?? null) as {
    id: number;
    field: FactField;
    value: string;
    checked_on: string;
    checked_by: number;
    checked_by_name: string;
    note: string;
  }[];
}

export function callsFor(db: Db, supplierId: number) {
  return db
    .prepare(
      `SELECT c.id, c.contact_name, c.contact_title, c.held_on, c.by_staff_id, s.name AS by_name, c.write_up
         FROM calls c JOIN staff s ON s.id = c.by_staff_id WHERE c.supplier_id = ? ORDER BY c.held_on, c.id`,
    )
    .all(supplierId) as {
    id: number;
    contact_name: string;
    contact_title: string;
    held_on: string;
    by_staff_id: number;
    by_name: string;
    write_up: string;
  }[];
}

export function entryNotes(db: Db, clientId: number, supplierId: number) {
  return db
    .prepare(
      `SELECT n.id, n.written_at, n.body,
              CASE WHEN n.author_staff_id IS NULL THEN 'client_user' ELSE 'staff' END AS author_kind,
              coalesce(n.author_staff_id, n.author_user_id) AS author_id,
              coalesce(s.name, u.name) AS author
         FROM notes n LEFT JOIN staff s ON s.id = n.author_staff_id LEFT JOIN client_users u ON u.id = n.author_user_id
        WHERE n.client_id = ? AND n.supplier_id = ? ORDER BY n.written_at, n.id`,
    )
    .all(clientId, supplierId) as { id: number; written_at: string; body: string; author_kind: string; author_id: number; author: string }[];
}

export function entryRequests(db: Db, clientId: number, supplierId: number) {
  return db
    .prepare(
      `SELECT r.id, r.requested_on, r.requested_by, u.name AS requested_by_name, r.question, r.status,
              r.assigned_to, s.name AS assigned_to_name, r.answered_on
         FROM check_requests r JOIN client_users u ON u.id = r.requested_by LEFT JOIN staff s ON s.id = r.assigned_to
        WHERE r.client_id = ? AND r.supplier_id = ? ORDER BY r.requested_on, r.id`,
    )
    .all(clientId, supplierId);
}

export function addNote(db: Db, actor: Actor, clientId: number, supplierId: number, body: string, at: Date) {
  const { lastInsertRowid } = db
    .prepare(
      "INSERT INTO notes (client_id, supplier_id, author_staff_id, author_user_id, written_at, body) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(clientId, supplierId, actor.kind === "staff" ? actor.id : null, actor.kind === "client_user" ? actor.id : null, at.toISOString(), body);
  logActivity(db, actor, "note.added", `supplier:${supplierId}`, at, clientId);
  return { id: Number(lastInsertRowid), client_id: clientId, supplier_id: supplierId, author_kind: actor.kind, author_id: actor.id, written_at: at.toISOString(), body };
}

export function getRequest(db: Db, requestId: number): RequestRow | undefined {
  return db.prepare("SELECT * FROM check_requests WHERE id = ?").get(requestId) as RequestRow | undefined;
}

export function moveRequest(
  db: Db,
  actor: Actor,
  seen: RequestRow,
  to: RequestStatus,
  at: Date,
  changes: { assigned_to?: number } = {},
  alsoWrite?: () => void,
): RequestRow {
  return db.transaction(() => {
    const { changes: moved } = db
      .prepare(
        `UPDATE check_requests SET status = @to, assigned_to = coalesce(@assigned_to, assigned_to),
                answered_on = CASE WHEN @to = 'answered' THEN @day ELSE answered_on END
          WHERE id = @id AND status = @from`,
      )
      .run({ to, assigned_to: changes.assigned_to ?? null, day: dayOf(at), id: seen.id, from: seen.status });
    if (moved === 0) {
      throw new Problem(409, "status_changed", `Check request ${seen.id} is no longer ${seen.status}; read it again.`);
    }
    alsoWrite?.();
    logActivity(db, actor, `check_request.${to}`, `check_request:${seen.id}`, at, seen.client_id);
    return getRequest(db, seen.id) as RequestRow;
  })();
}
