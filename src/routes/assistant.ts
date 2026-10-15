import { Router, type Response } from "express";
import { z } from "zod";
import { askAboutSupplier, type AssistantAnswer } from "../assistant/loop.js";
import { ModelCallFailed } from "../assistant/model.js";
import { Problem } from "../problem.js";
import { listedSupplier, type ClientActor } from "../records.js";
import { requireClientUser } from "../session.js";
import { idParam, text } from "../validate.js";
import type { AppContext } from "../app.js";

export const questionBody = z.object({ question: text(2000) });
const QUESTION_DEADLINE_MS = 120_000;
export const QUESTIONS_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;

export function questionLimiter(now: () => Date) {
  const asked = new Map<number, number[]>();
  return {
    take(userId: number): void {
      const at = now().getTime();
      const recent = (asked.get(userId) ?? []).filter((t) => at - t < HOUR_MS);
      if (recent.length >= QUESTIONS_PER_HOUR) {
        asked.set(userId, recent);
        throw new Problem(429, "too_many_questions", `Each user can ask the assistant ${QUESTIONS_PER_HOUR} questions an hour; try again later.`);
      }
      recent.push(at);
      asked.set(userId, recent);
    },
  };
}

export async function answerQuestion(
  { db, model, now, questions }: AppContext,
  actor: ClientActor,
  supplierId: number,
  question: string,
  res: Response,
): Promise<AssistantAnswer> {
  const supplier = listedSupplier(db, actor.client_id, supplierId);
  if (!model) {
    throw new Problem(503, "assistant_unconfigured", "The assistant needs MODEL_BASE_URL, MODEL_API_KEY and MODEL_NAME set.");
  }
  questions.take(actor.id);
  const gone = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) gone.abort();
  });
  const signal = AbortSignal.any([gone.signal, AbortSignal.timeout(QUESTION_DEADLINE_MS)]);
  try {
    return await askAboutSupplier(model, { db, supplierId: supplier.id, actor, now }, question, signal);
  } catch (err) {
    if (err instanceof ModelCallFailed) throw new Problem(502, "model_call_failed", err.message);
    throw err;
  }
}

export function assistantRoutes(deps: AppContext): Router {
  const router = Router({ caseSensitive: true });

  router.post("/assistant/suppliers/:id", async (req, res) => {
    const actor = requireClientUser(req, "ask the assistant");
    const supplierId = idParam(req.params.id);
    const { question } = questionBody.parse(req.body);
    res.json(await answerQuestion(deps, actor, supplierId, question, res));
  });

  return router;
}
