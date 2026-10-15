import express from "express";
import type { ChatModel } from "./assistant/model.js";
import type { Db } from "./db.js";
import { Problem, problemHandler } from "./problem.js";
import { assistantRoutes, questionLimiter } from "./routes/assistant.js";
import { clientRoutes } from "./routes/client.js";
import { pageRoutes } from "./routes/pages.js";
import { staffRoutes } from "./routes/staff.js";
import {
  attemptLimiter,
  changePassword,
  clearedCookie,
  endSessions,
  passwordChangeBody,
  requireSession,
  sessionFromCookie,
  signInBody,
  signInWithPassword,
  signedIn,
  startSession,
  type AttemptLimiter,
} from "./session.js";

export interface AppDeps {
  db: Db;
  sessionSecret: string;
  model: ChatModel | null;
  now: () => Date;
  cookieSecure?: boolean;
}

export type AppContext = AppDeps & {
  limiter: AttemptLimiter;
  questions: ReturnType<typeof questionLimiter>;
  settings: { secret: string; secure: boolean };
};

export function createApp(deps: AppDeps) {
  const { db, sessionSecret, now } = deps;
  const ctx: AppContext = {
    ...deps,
    limiter: attemptLimiter(now),
    questions: questionLimiter(now),
    settings: { secret: sessionSecret, secure: deps.cookieSecure ?? false },
  };
  const app = express();
  app.disable("x-powered-by");
  app.set("case sensitive routing", true);
  app.use(pageRoutes(ctx));
  app.use(express.json({ limit: "64kb" }));

  app.post("/session", async (req, res) => {
    const { email, password } = signInBody.parse(req.body);
    const actor = await signInWithPassword(db, ctx.limiter, email, password);
    res.setHeader("set-cookie", startSession(db, ctx.settings, actor, now()));
    res.json({ user: actor });
  });

  app.delete("/session", (req, res) => {
    const session = sessionFromCookie(db, sessionSecret, req.headers.cookie, now());
    if (session) endSessions(db, now(), { session: session.id });
    res.setHeader("set-cookie", clearedCookie(ctx.settings.secure));
    res.status(204).end();
  });

  app.use(requireSession(db, sessionSecret, now));

  app.post("/session/password", async (req, res) => {
    await changePassword(db, signedIn(req), req.sessionId as string, passwordChangeBody.parse(req.body), now());
    res.json({ changed: true });
  });

  app.use(clientRoutes(deps));
  app.use(staffRoutes(deps));
  app.use(assistantRoutes(ctx));

  app.use((req, _res, next) => next(new Problem(404, "not_found", `No route for ${req.method} ${req.path}.`)));
  app.use(problemHandler);
  return app;
}
