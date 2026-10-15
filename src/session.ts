import { createHmac, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { ClientRole, Db, StaffRole } from "./db.js";
import { hashPassword, passwordMatches } from "./passwords.js";
import { Problem } from "./problem.js";
import { logActivity, type Actor, type ClientActor, type StaffActor } from "./records.js";

export const signInBody = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export const passwordChangeBody = z
  .object({ password: z.string().min(1).max(200), new_password: z.string().min(10).max(200) })
  .strict();

export const COOKIE_NAME = "tessary_session";
const SESSION_MS = 12 * 60 * 60 * 1000;
const SESSION_KEPT_MS = 7 * 24 * 60 * 60 * 1000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOCK_AFTER = 5;
const LOCK_MS = 5 * 60 * 1000;
const SLOW_STEP_MS = 150;
const TRACKED_EMAILS = 10_000;

declare module "express-serve-static-core" {
  interface Request {
    actor?: Actor;
    sessionId?: string;
  }
}

export interface SessionSettings {
  secret: string;
  secure: boolean;
}

const cookie = (value: string, maxAgeSeconds: number, secure: boolean) =>
  `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;

export const clearedCookie = (secure: boolean) => cookie("", 0, secure);

const sessionKey = (secret: string, token: string) => createHmac("sha256", secret).update(token).digest("hex");

function readCookie(header: string | undefined): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return undefined;
}

const STAFF_COLUMNS = "'staff' AS kind, id, name, email, role";
const CLIENT_USER_COLUMNS =
  "'client_user' AS kind, u.id, u.name, u.email, u.role, u.client_id, c.name AS client_name, c.status AS client_status, u.deactivated_on";
const CLIENT_USER_FROM = "FROM client_users u JOIN clients c ON c.id = u.client_id";

type ClientUserRow = ClientActor & { client_status: string; deactivated_on: string | null };

function clientActor({ client_status: _status, deactivated_on: _off, ...actor }: ClientUserRow): ClientActor {
  return actor;
}

export function startSession(db: Db, settings: SessionSettings, actor: Actor, at: Date): string {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date(at.getTime() - SESSION_KEPT_MS).toISOString());
  const token = randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO sessions (id, actor_kind, staff_id, client_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    sessionKey(settings.secret, token),
    actor.kind,
    actor.kind === "staff" ? actor.id : null,
    actor.kind === "client_user" ? actor.id : null,
    at.toISOString(),
    new Date(at.getTime() + SESSION_MS).toISOString(),
  );
  return cookie(token, SESSION_MS / 1000, settings.secure);
}

export function sessionFromCookie(db: Db, secret: string, header: string | undefined, at: Date): { id: string; actor: Actor } | undefined {
  const token = readCookie(header);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  const id = sessionKey(secret, token);
  const row = db
    .prepare("SELECT staff_id, client_user_id FROM sessions WHERE id = ? AND ended_at IS NULL AND created_at <= ? AND expires_at > ?")
    .get(id, at.toISOString(), at.toISOString()) as { staff_id: number | null; client_user_id: number | null } | undefined;
  if (!row) return undefined;
  if (row.staff_id !== null) {
    const staff = db.prepare(`SELECT ${STAFF_COLUMNS} FROM staff WHERE id = ?`).get(row.staff_id) as StaffActor | undefined;
    return staff && { id, actor: staff };
  }
  const user = db.prepare(`SELECT ${CLIENT_USER_COLUMNS} ${CLIENT_USER_FROM} WHERE u.id = ?`).get(row.client_user_id) as ClientUserRow | undefined;
  return user && user.client_status === "active" && user.deactivated_on === null ? { id, actor: clientActor(user) } : undefined;
}

export function endSessions(
  db: Db,
  at: Date,
  who: { session?: string; clientId?: number; clientUserId?: number; staffId?: number; except?: string },
): void {
  db.prepare(
    `UPDATE sessions SET ended_at = @at WHERE ended_at IS NULL AND id IS NOT @except AND (
       id = @session
       OR client_user_id IN (SELECT id FROM client_users WHERE client_id = @client)
       OR client_user_id = @user OR staff_id = @staff)`,
  ).run({
    at: at.toISOString(),
    except: who.except ?? null,
    session: who.session ?? null,
    client: who.clientId ?? null,
    user: who.clientUserId ?? null,
    staff: who.staffId ?? null,
  });
}

export function attemptLimiter(now: () => Date) {
  const failures = new Map<string, { count: number; first: number; lockedUntil: number }>();
  return {
    check(email: string): void {
      const entry = failures.get(email);
      if (entry && entry.lockedUntil > now().getTime()) {
        throw new Problem(429, "too_many_attempts", "Too many failed sign-ins for this email; try again in a few minutes.");
      }
    },
    async failed(email: string): Promise<void> {
      const at = now().getTime();
      let entry = failures.get(email);
      if (!entry || at - entry.first > FAILURE_WINDOW_MS) entry = { count: 0, first: at, lockedUntil: 0 };
      entry.count += 1;
      if (entry.count >= LOCK_AFTER) entry.lockedUntil = at + LOCK_MS;
      failures.delete(email);
      failures.set(email, entry);
      if (failures.size > TRACKED_EMAILS) failures.delete(failures.keys().next().value as string);
      if (entry.count > 2) await new Promise((resolve) => setTimeout(resolve, SLOW_STEP_MS * (entry.count - 2)));
    },
    succeeded(email: string): void {
      failures.delete(email);
    },
  };
}

export type AttemptLimiter = ReturnType<typeof attemptLimiter>;

export async function signInWithPassword(db: Db, limiter: AttemptLimiter, email: string, password: string): Promise<Actor> {
  limiter.check(email);
  const staff = db.prepare(`SELECT ${STAFF_COLUMNS}, password_hash FROM staff WHERE email = ?`).get(email) as
    | (StaffActor & { password_hash: string })
    | undefined;
  const user = staff
    ? undefined
    : (db.prepare(`SELECT ${CLIENT_USER_COLUMNS}, u.password_hash ${CLIENT_USER_FROM} WHERE u.email = ?`).get(email) as
        | (ClientUserRow & { password_hash: string })
        | undefined);
  const found = staff ?? user;
  if (!(await passwordMatches(found?.password_hash, password)) || !found) {
    await limiter.failed(email);
    throw new Problem(401, "bad_credentials", "That email and password do not match a user.");
  }
  limiter.succeeded(email);
  if (user) {
    if (user.client_status !== "active") {
      throw new Problem(403, "client_ended", `${user.client_name}'s subscription has ended; its users cannot sign in.`);
    }
    if (user.deactivated_on !== null) throw new Problem(403, "user_deactivated", "This user was deactivated by their client admin.");
    const { password_hash: _hash, ...row } = user;
    return clientActor(row);
  }
  const { password_hash: _hash, ...row } = staff as StaffActor & { password_hash: string };
  return row;
}

export async function changePassword(db: Db, actor: Actor, sessionId: string, body: z.infer<typeof passwordChangeBody>, at: Date): Promise<void> {
  const table = actor.kind === "staff" ? "staff" : "client_users";
  const { password_hash } = db.prepare(`SELECT password_hash FROM ${table} WHERE id = ?`).get(actor.id) as { password_hash: string };
  if (!(await passwordMatches(password_hash, body.password))) {
    throw new Problem(403, "wrong_password", "That is not your password.");
  }
  const hash = await hashPassword(body.new_password);
  db.transaction(() => {
    db.prepare(`UPDATE ${table} SET password_hash = ? WHERE id = ?`).run(hash, actor.id);
    endSessions(db, at, actor.kind === "staff" ? { staffId: actor.id, except: sessionId } : { clientUserId: actor.id, except: sessionId });
    logActivity(db, actor, "password.changed", `${actor.kind}:${actor.id}`, at);
  })();
}

export function requireSession(db: Db, secret: string, now: () => Date) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const session = sessionFromCookie(db, secret, req.headers.cookie, now());
    if (!session) throw new Problem(401, "unauthenticated", "Sign in at POST /session first.");
    req.actor = session.actor;
    req.sessionId = session.id;
    next();
  };
}

export function signedIn(req: Request): Actor {
  if (!req.actor) throw new Problem(401, "unauthenticated", "Sign in at POST /session first.");
  return req.actor;
}

export function requireStaff(req: Request, roles: readonly StaffRole[], doing: string): StaffActor {
  const actor = signedIn(req);
  if (actor.kind !== "staff" || !roles.includes(actor.role)) {
    throw new Problem(403, "forbidden", `Only Tessary ${roles.join(" or ")} staff can ${doing}.`);
  }
  return actor;
}

export function requireClientUser(req: Request, doing: string, roles: readonly ClientRole[] = ["buyer", "client_admin"]): ClientActor {
  const actor = signedIn(req);
  if (actor.kind !== "client_user" || !roles.includes(actor.role)) {
    throw new Problem(403, "forbidden", `Only ${roles.length === 1 ? "client admins" : "client users"} can ${doing}.`);
  }
  return actor;
}

export function emailTaken(db: Db, email: string): boolean {
  return db.prepare("SELECT 1 FROM staff WHERE email = ? UNION ALL SELECT 1 FROM client_users WHERE email = ?").get(email, email) !== undefined;
}
