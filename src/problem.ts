import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class Problem extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, detail: string, extra: Record<string, unknown> = {}) {
    super(detail);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Content Too Large",
  429: "Too Many Requests",
  415: "Unsupported Media Type",
  502: "Bad Gateway",
  503: "Service Unavailable",
  500: "Internal Server Error",
};

export function sendProblem(res: Response, problem: Problem): void {
  res
    .status(problem.status)
    .type("application/problem+json")
    .send(
      JSON.stringify({
        type: "about:blank",
        title: TITLES[problem.status] ?? "Error",
        status: problem.status,
        code: problem.code,
        detail: problem.message,
        ...problem.extra,
      }),
    );
}

export function notFound(what: string): Problem {
  return new Problem(404, "not_found", `${what} was not found.`);
}

export function problemFrom(err: unknown): Problem {
  if (err instanceof Problem) return err;
  if (err instanceof ZodError) {
    return new Problem(400, "invalid_request", "The request did not match what this route takes.", {
      issues: err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return new Problem(status, "invalid_request", (err as Error).message || "The request body could not be read.");
  }
  console.error(err);
  return new Problem(500, "internal_error", "Something went wrong on the desk.");
}

export function problemHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  sendProblem(res, problemFrom(err));
}
