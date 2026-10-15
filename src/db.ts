import Database from "better-sqlite3";

export type Db = Database.Database;

export const STAFF_ROLES = ["analyst", "lead", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
export const CLIENT_ROLES = ["buyer", "client_admin"] as const;
export type ClientRole = (typeof CLIENT_ROLES)[number];
export const CLIENT_STATUSES = ["active", "ended"] as const;

export const SUPPLIER_KINDS = ["raw_materials", "components", "packaging", "freight", "contract_manufacturer"] as const;
export const LIST_STATUSES = ["onboarding", "approved", "on_hold", "dropped"] as const;
export const SPEND_BANDS = ["under_100k", "100k_500k", "500k_2m", "over_2m"] as const;
export const REQUEST_STATUSES = ["requested", "assigned", "answered", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const ADDITION_STATUSES = ["requested", "linked", "declined"] as const;
export const SUPPLIER_COLUMNS = ["kind", "hq_city", "hq_state", "plants"] as const;

export const FACT_FIELDS = [
  "ownership",
  "parent_company",
  "headquarters",
  "plants",
  "headcount",
  "chief_executive",
  "certifications",
  "recent_change",
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

type Band = (typeof SPEND_BANDS)[number];

export interface Seed {
  staff: { id: number; name: string; email: string; role: StaffRole; password_hash: string }[];
  clients: { id: number; name: string; industry: string; city: string; state: string; subscribed_on: string; status: (typeof CLIENT_STATUSES)[number] }[];
  client_users: { id: number; client_id: number; name: string; email: string; role: ClientRole; password_hash: string }[];
  suppliers: { id: number; name: string; kind: (typeof SUPPLIER_KINDS)[number]; hq_city: string; hq_state: string; plants: string; created_on: string }[];
  supplier_list: { client_id: number; supplier_id: number; added_on: string; added_by: number; status: (typeof LIST_STATUSES)[number]; spend_band: Band }[];
  facts: { id: number; supplier_id: number; field: FactField; value: string; checked_on: string; checked_by: number; note: string }[];
  calls: { id: number; supplier_id: number; contact_name: string; contact_title: string; held_on: string; by_staff_id: number; write_up: string }[];
  supplier_changes: {
    id: number;
    supplier_id: number;
    staff_id: number;
    field: (typeof SUPPLIER_COLUMNS)[number];
    old_value: string;
    new_value: string;
    changed_at: string;
  }[];
  check_requests: {
    id: number;
    client_id: number;
    supplier_id: number;
    requested_by: number;
    requested_on: string;
    question: string;
    status: RequestStatus;
    assigned_to: number | null;
    answered_on: string | null;
  }[];
  addition_requests: {
    id: number;
    client_id: number;
    requested_by: number;
    requested_on: string;
    name: string;
    city: string;
    state: string;
    note: string;
    spend_band: Band;
    status: (typeof ADDITION_STATUSES)[number];
    supplier_id: number | null;
    decided_by: number | null;
    decided_on: string | null;
    decision_note: string | null;
  }[];
  notes: { id: number; client_id: number; supplier_id: number; author_staff_id: number | null; author_user_id: number | null; written_at: string; body: string }[];
  activity: {
    id: number;
    actor_kind: "staff" | "client_user";
    staff_id: number | null;
    client_user_id: number | null;
    client_id: number | null;
    action: string;
    subject: string;
    at: string;
  }[];
}

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
const DATE = (column: string) => `CHECK (${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`;

const noReplace = (table: string, message: string, key = "id = NEW.id") =>
  `CREATE TRIGGER ${table}_no_replace BEFORE INSERT ON ${table} WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${key})
BEGIN SELECT RAISE(ABORT, '${table} ${message}'); END;`;

const noDelete = (table: string, message: string) =>
  `CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} ${message}'); END;`;

const appendOnly = (table: string) => `${noReplace(table, "is append-only")}
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END;
${noDelete(table, "is append-only")}`;

const MOVES_ONLY = "rows are changed only by status moves";

export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "2022-09 first tables",
    sql: `
CREATE TABLE staff (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN (${list(STAFF_ROLES)})),
  password_hash TEXT NOT NULL
);
CREATE TABLE clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  industry TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL CHECK (length(state) = 2),
  subscribed_on TEXT NOT NULL ${DATE("subscribed_on")},
  status TEXT NOT NULL CHECK (status IN (${list(CLIENT_STATUSES)}))
);
CREATE TABLE client_users (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN (${list(CLIENT_ROLES)})),
  password_hash TEXT NOT NULL
);
CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN (${list(SUPPLIER_KINDS)})),
  hq_city TEXT NOT NULL,
  hq_state TEXT NOT NULL CHECK (length(hq_state) = 2),
  plants TEXT NOT NULL,
  created_on TEXT NOT NULL ${DATE("created_on")}
);
CREATE TABLE supplier_list (
  client_id INTEGER NOT NULL REFERENCES clients(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  added_on TEXT NOT NULL ${DATE("added_on")},
  added_by INTEGER NOT NULL REFERENCES client_users(id),
  status TEXT NOT NULL CHECK (status IN (${list(LIST_STATUSES)})),
  PRIMARY KEY (client_id, supplier_id)
);
CREATE INDEX supplier_list_supplier ON supplier_list (supplier_id);
${noReplace("supplier_list", "rows are kept; set status to dropped", "client_id = NEW.client_id AND supplier_id = NEW.supplier_id")}
${noDelete("supplier_list", "rows are kept; set status to dropped")}
CREATE TABLE facts (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  field TEXT NOT NULL CHECK (field IN (${list(FACT_FIELDS)})),
  value TEXT NOT NULL,
  checked_on TEXT NOT NULL ${DATE("checked_on")},
  checked_by INTEGER NOT NULL REFERENCES staff(id),
  note TEXT NOT NULL
);
CREATE INDEX facts_supplier ON facts (supplier_id);
CREATE TABLE calls (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  contact_name TEXT NOT NULL,
  contact_title TEXT NOT NULL,
  held_on TEXT NOT NULL ${DATE("held_on")},
  by_staff_id INTEGER NOT NULL REFERENCES staff(id),
  write_up TEXT NOT NULL
);
CREATE INDEX calls_supplier ON calls (supplier_id);
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL,
  author_staff_id INTEGER REFERENCES staff(id),
  author_user_id INTEGER REFERENCES client_users(id),
  written_at TEXT NOT NULL,
  body TEXT NOT NULL,
  FOREIGN KEY (client_id, supplier_id) REFERENCES supplier_list(client_id, supplier_id),
  CHECK ((author_staff_id IS NULL) <> (author_user_id IS NULL))
);
CREATE INDEX notes_entry ON notes (client_id, supplier_id);
${appendOnly("facts")}
${appendOnly("calls")}
${appendOnly("notes")}`,
  },
  {
    name: "2023-04 spend band on list entries",
    sql: `ALTER TABLE supplier_list ADD COLUMN spend_band TEXT NOT NULL DEFAULT 'under_100k' CHECK (spend_band IN (${list(SPEND_BANDS)}));`,
  },
  {
    name: "2024-02 check requests",
    sql: `
CREATE TABLE check_requests (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL,
  requested_by INTEGER NOT NULL REFERENCES client_users(id),
  requested_on TEXT NOT NULL ${DATE("requested_on")},
  question TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (${list(REQUEST_STATUSES)})),
  assigned_to INTEGER REFERENCES staff(id),
  answered_on TEXT,
  FOREIGN KEY (client_id, supplier_id) REFERENCES supplier_list(client_id, supplier_id),
  CHECK (status NOT IN ('assigned', 'answered') OR assigned_to IS NOT NULL),
  CHECK (status <> 'requested' OR assigned_to IS NULL),
  CHECK ((status = 'answered') = (answered_on IS NOT NULL))
);
CREATE INDEX check_requests_entry ON check_requests (client_id, supplier_id);
CREATE UNIQUE INDEX check_requests_one_open ON check_requests (client_id, supplier_id) WHERE status IN ('requested', 'assigned');
${noReplace("check_requests", MOVES_ONLY)}
${noDelete("check_requests", MOVES_ONLY)}
CREATE TRIGGER check_requests_moves BEFORE UPDATE ON check_requests
WHEN NOT (
  NEW.id = OLD.id AND NEW.client_id = OLD.client_id AND NEW.supplier_id = OLD.supplier_id AND NEW.requested_by = OLD.requested_by
  AND NEW.requested_on = OLD.requested_on AND NEW.question = OLD.question
  AND ((OLD.status = 'requested' AND NEW.status = 'assigned')
    OR (OLD.status = 'requested' AND NEW.status = 'cancelled' AND NEW.assigned_to IS NULL)
    OR (OLD.status = 'assigned' AND NEW.status IN ('answered', 'cancelled') AND NEW.assigned_to = OLD.assigned_to))
)
BEGIN SELECT RAISE(ABORT, 'check_requests ${MOVES_ONLY}'); END;`,
  },
  {
    name: "2025-05 supplier change history",
    sql: `
CREATE TABLE supplier_changes (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  field TEXT NOT NULL CHECK (field IN (${list(SUPPLIER_COLUMNS)})),
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX supplier_changes_supplier ON supplier_changes (supplier_id);
${appendOnly("supplier_changes")}`,
  },
  {
    name: "2026-03 supplier addition requests",
    sql: `
CREATE TABLE addition_requests (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  requested_by INTEGER NOT NULL REFERENCES client_users(id),
  requested_on TEXT NOT NULL ${DATE("requested_on")},
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL CHECK (length(state) = 2),
  note TEXT NOT NULL,
  spend_band TEXT NOT NULL CHECK (spend_band IN (${list(SPEND_BANDS)})),
  status TEXT NOT NULL CHECK (status IN (${list(ADDITION_STATUSES)})),
  supplier_id INTEGER REFERENCES suppliers(id),
  decided_by INTEGER REFERENCES staff(id),
  decided_on TEXT,
  decision_note TEXT,
  CHECK ((status = 'linked') = (supplier_id IS NOT NULL)),
  CHECK ((status = 'requested') = (decided_by IS NULL AND decided_on IS NULL)),
  CHECK (status <> 'declined' OR decision_note IS NOT NULL)
);
CREATE INDEX addition_requests_client ON addition_requests (client_id);
CREATE UNIQUE INDEX addition_requests_one_open ON addition_requests (client_id, lower(name)) WHERE status = 'requested';
${noReplace("addition_requests", MOVES_ONLY)}
${noDelete("addition_requests", MOVES_ONLY)}
CREATE TRIGGER addition_requests_moves BEFORE UPDATE ON addition_requests
WHEN NOT (
  OLD.status = 'requested' AND NEW.status IN ('linked', 'declined') AND NEW.id = OLD.id AND NEW.client_id = OLD.client_id
  AND NEW.requested_by = OLD.requested_by AND NEW.requested_on = OLD.requested_on AND NEW.name = OLD.name AND NEW.city = OLD.city
  AND NEW.state = OLD.state AND NEW.note = OLD.note AND NEW.spend_band = OLD.spend_band
)
BEGIN SELECT RAISE(ABORT, 'addition_requests ${MOVES_ONLY}'); END;`,
  },
  {
    name: "2026-04 activity log",
    sql: `
CREATE TABLE activity (
  id INTEGER PRIMARY KEY,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('staff', 'client_user')),
  staff_id INTEGER REFERENCES staff(id),
  client_user_id INTEGER REFERENCES client_users(id),
  client_id INTEGER REFERENCES clients(id),
  action TEXT NOT NULL,
  subject TEXT NOT NULL,
  at TEXT NOT NULL,
  CHECK ((actor_kind = 'staff' AND staff_id IS NOT NULL AND client_user_id IS NULL)
      OR (actor_kind = 'client_user' AND client_user_id IS NOT NULL AND staff_id IS NULL))
);
CREATE INDEX activity_at ON activity (at);
${appendOnly("activity")}`,
  },
  {
    name: "2026-09 server-side sessions and user deactivation",
    sql: `
ALTER TABLE client_users ADD COLUMN deactivated_on TEXT;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('staff', 'client_user')),
  staff_id INTEGER REFERENCES staff(id),
  client_user_id INTEGER REFERENCES client_users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK ((actor_kind = 'staff') = (staff_id IS NOT NULL) AND (actor_kind = 'client_user') = (client_user_id IS NOT NULL))
);
CREATE INDEX sessions_staff ON sessions (staff_id);
CREATE INDEX sessions_client_user ON sessions (client_user_id);`,
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db: Db, to = SCHEMA_VERSION): void {
  for (let version = db.pragma("user_version", { simple: true }) as number; version < to; version++) {
    db.transaction(() => {
      db.exec((MIGRATIONS[version] as { sql: string }).sql);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function readSeed(json: string): Seed {
  const tables = JSON.parse(json) as Record<string, { columns: string[]; rows: unknown[][] }>;
  return Object.fromEntries(
    Object.entries(tables).map(([table, { columns, rows }]) => [table, rows.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])))]),
  ) as unknown as Seed;
}

export function loadSeedIfEmpty(db: Db, seed: Seed): boolean {
  const { n } = db.prepare("SELECT count(*) AS n FROM staff").get() as { n: number };
  if (n > 0) return false;
  db.transaction(() => {
    for (const [table, rows] of Object.entries(seed) as [string, Record<string, unknown>[]][]) {
      const columns = (db.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
      const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((c) => `@${c}`).join(", ")})`);
      for (const row of rows) stmt.run(Object.fromEntries(columns.map((c) => [c, row[c] ?? null])));
    }
  })();
  return true;
}
