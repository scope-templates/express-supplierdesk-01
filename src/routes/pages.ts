import express, { Router, type NextFunction, type Request, type Response } from "express";
import { Problem, problemFrom } from "../problem.js";
import { changePassword, clearedCookie, endSessions, passwordChangeBody, sessionFromCookie, signInBody, signInWithPassword, startSession } from "../session.js";
import { clientPages } from "./client-pages.js";
import { esc, field, form, page, signedInPage } from "./page-kit.js";
import { staffPages } from "./staff-pages.js";
import type { AppContext } from "../app.js";

const PAGE_PATHS = ["/sign-in", "/sign-out", "/password", "/app", "/desk"];

function sameOrigin(req: Request): boolean {
  const from = req.headers.origin ?? req.headers.referer;
  if (!req.headers.host || typeof from !== "string") return false;
  try {
    return new URL(from).host === req.headers.host;
  } catch {
    return false;
  }
}

function signInPage(message = ""): string {
  return page(
    "Sign in",
    undefined,
    `<h1>Sign in</h1>${message ? `<p class="problem">${esc(message)}</p>` : ""}
${form("/sign-in", `${field("Email", `<input type="email" name="email" required>`)}${field("Password", `<input type="password" name="password" required>`)}`, "Sign in")}`,
  );
}

export function pageRoutes(ctx: AppContext): Router {
  const { db, now, sessionSecret } = ctx;
  const router = Router({ caseSensitive: true });

  router.use(PAGE_PATHS, express.urlencoded({ extended: false, limit: "64kb" }), (req, _res, next) => {
    if (req.method === "POST" && !sameOrigin(req)) throw new Problem(403, "cross_site_form", "This form was posted from another site.");
    next();
  });

  router.get("/", (_req, res) => res.redirect(303, "/sign-in"));
  router.get("/sign-in", (_req, res) => res.type("html").send(signInPage()));

  router.post("/sign-in", async (req, res) => {
    const parsed = signInBody.safeParse(req.body);
    try {
      if (!parsed.success) throw new Problem(401, "bad_credentials", "That email and password do not match a user.");
      const actor = await signInWithPassword(db, ctx.limiter, parsed.data.email, parsed.data.password);
      res.setHeader("set-cookie", startSession(db, ctx.settings, actor, now()));
      res.redirect(303, actor.kind === "staff" ? "/desk" : "/app");
    } catch (err) {
      const problem = problemFrom(err);
      res.status(problem.status).type("html").send(signInPage(problem.message));
    }
  });

  router.post("/sign-out", (req, res) => {
    const session = sessionFromCookie(db, sessionSecret, req.headers.cookie, now());
    if (session) endSessions(db, now(), { session: session.id });
    res.setHeader("set-cookie", clearedCookie(ctx.settings.secure));
    res.redirect(303, "/sign-in");
  });

  router.use("/password", signedInPage(ctx));

  const passwordForm = (message = "") =>
    `<h1>Change password</h1>${message}${form(
      "/password",
      `${field("Password", `<input type="password" name="password" required>`)}${field("New password (10 or more characters)", `<input type="password" name="new_password" minlength="10" required>`)}`,
      "Change password",
    )}`;

  router.get("/password", (req, res) => res.type("html").send(page("Password", req.actor, passwordForm())));
  router.post("/password", async (req, res) => {
    await changePassword(db, req.actor!, req.sessionId!, passwordChangeBody.parse(req.body), now());
    res.type("html").send(page("Password", req.actor, passwordForm(`<p class="answer">Password changed. Your other sessions were signed out.</p>`)));
  });

  router.use(clientPages(ctx));
  router.use(staffPages(ctx));
  router.use(PAGE_PATHS, () => {
    throw new Problem(404, "not_found", "There is no page here.");
  });

  router.use(PAGE_PATHS, (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const problem = problemFrom(err);
    const back = req.actor ? `<p><a href="${req.actor.kind === "staff" ? "/desk" : "/app"}">Back</a></p>` : "";
    res.status(problem.status).type("html").send(page("Problem", req.actor, `<h1>That did not work</h1><p class="problem">${esc(problem.message)}</p>${back}`));
  });
  return router;
}
