import { z } from "zod";
import { Problem } from "./problem.js";

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .refine((value) => {
    const day = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(value) && value >= "2000-01-01";
  }, "not a calendar date from 2000 on");

const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

export const text = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(INVISIBLE, "").trim())
    .pipe(z.string().min(1, "must not be blank").max(max));

const MAX_ID = 2_147_483_647;

export const id = z
  .union([z.number(), z.string().trim().regex(/^\d+$/, "digits only").transform(Number)])
  .pipe(z.number().int().positive().max(MAX_ID));

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

export const stateCode = z.string().trim().toUpperCase().pipe(z.enum(US_STATES, { message: "two-letter US state" }));

export const DESK_TIME_ZONE = "America/Chicago";
const deskDay = new Intl.DateTimeFormat("en-CA", { timeZone: DESK_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function dayOf(at: Date): string {
  return deskDay.format(at);
}

export function refuseFutureDate(value: string, at: Date, field: string): void {
  if (value > dayOf(at)) {
    throw new Problem(400, `${field}_in_future`, `${field} ${value} is after today (${dayOf(at)}).`);
  }
}

export function idParam(value: string | string[] | undefined): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_ID) throw new Problem(404, "not_found", "No record has that id.");
  return parsed;
}
