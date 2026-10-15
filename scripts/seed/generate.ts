import type { FactField, Seed } from "../../src/db.js";
import { hashPasswordSync } from "../../src/passwords.js";
import {
  ANALYST_IDS,
  CERTIFICATIONS,
  CLIENTS,
  CONTACT_TITLES,
  ENDED_CLIENT,
  FIRST_NAMES,
  KIND_COUNTS,
  KIND_SUFFIXES,
  LAST_NAMES,
  LEAD_ID,
  LOCAL_PASSWORD,
  PARENTS,
  PE_FIRMS,
  STAFF,
  SUPPLIER_ROOTS,
  TOWNS,
  type ClientSpec,
} from "./names.js";
import {
  ADDITION_NOTES,
  ANSWER_CALL,
  ANSWER_CHECK,
  ANSWER_FILE,
  CALL_CLOSERS,
  CALL_OPENERS,
  CHANGE_LINES,
  CHANGE_PHRASES,
  DECLINE_NOTES,
  CLIENT_HEARD_NOTES,
  CLIENT_OPS_NOTES,
  DATED_FACT_NOTES,
  FACT_NOTES,
  FREIGHT_CLIENT_NOTES,
  FREIGHT_LINES,
  OPS_LINES,
  QUESTIONS,
  RECENT_CHANGE_VALUES,
  REQUEST_CALL_OPENERS,
  STATE_LINES,
  STATUS_NOTES,
} from "./prose.js";

export const SEED_END = "2026-09-30";
const YEAR_FROM = "2025-10-01";
const FACTS_FROM = "2025-06-01";
const FACTS_TO = "2026-09-01";
const EVENTS_FROM = "2025-01-06";
const EVENTS_TO = "2026-09-25";
const ENDED_ON = "2026-04-30";
const RECENT_FROM = "2026-05-01";
const ADDITIONS_FROM = "2026-03-02";
const ACTIVITY_FROM = "2026-04-01";
const NOTE_CAP = 12;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Kind = Seed["suppliers"][number]["kind"];
type ListStatus = Seed["supplier_list"][number]["status"];
type SpendBand = Seed["supplier_list"][number]["spend_band"];
type Rng = ReturnType<typeof makeRng>;

function makeRng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };
  const weighted = <T>(items: readonly T[], weight: (item: T) => number): T => {
    const total = items.reduce((sum, item) => sum + weight(item), 0);
    let roll = next() * total;
    for (const item of items) {
      roll -= weight(item);
      if (roll < 0) return item;
    }
    return items[items.length - 1] as T;
  };
  return { next, int, pick, shuffle, weighted, chance: (p: number) => next() < p };
}

const DAY_MS = 86_400_000;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
const addDays = (day: string, n: number) => new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10);
const daysFrom = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
const minDay = (...days: string[]) => days.reduce((a, b) => (a < b ? a : b));
const maxDay = (...days: string[]) => days.reduce((a, b) => (a > b ? a : b));
const monthYear = (day: string) => `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
const monthName = (day: string) => MONTHS[Number(day.slice(5, 7)) - 1] as string;
const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const usDate = (day: string) => `${monthName(day)} ${Number(day.slice(8, 10))}`;

function fill(template: string, values: Record<string, string | number>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, key: string) => {
      if (!(key in values)) throw new Error(`template ${template} needs ${key}`);
      return String(values[key]);
    })
    .replace(/\s+/g, " ")
    .trim();
}

function holidaysOf(year: number): string[] {
  const iso = (m: number, d: number) => `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const weekday = (m: number, d: number) => new Date(Date.UTC(year, m, d)).getUTCDay();
  const nth = (m: number, wd: number, n: number) => iso(m, 1 + ((wd - weekday(m, 1) + 7) % 7) + (n - 1) * 7);
  const last = (m: number, wd: number) => {
    const end = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
    return iso(m, end - ((weekday(m, end) - wd + 7) % 7));
  };
  const observed = (m: number, d: number) => {
    const wd = weekday(m, d);
    return addDays(iso(m, d), wd === 6 ? -1 : wd === 0 ? 1 : 0);
  };
  return [
    observed(0, 1), nth(0, 1, 3), nth(1, 1, 3), last(4, 1), observed(5, 19), observed(6, 4),
    nth(8, 1, 1), nth(9, 1, 2), observed(10, 11), nth(10, 4, 4), observed(11, 25),
  ];
}

const HOLIDAYS = new Set([2021, 2022, 2023, 2024, 2025, 2026, 2027].flatMap(holidaysOf));
const isWorkday = (day: string) => {
  const wd = new Date(dayMs(day)).getUTCDay();
  return wd !== 0 && wd !== 6 && !HOLIDAYS.has(day);
};
const workdayOnOrAfter = (day: string) => {
  let d = day;
  while (!isWorkday(d)) d = addDays(d, 1);
  return d;
};
const addWorkdays = (day: string, n: number) => {
  let d = day;
  for (let i = 0; i < n; i++) d = workdayOnOrAfter(addDays(d, 1));
  return d;
};

function workdayBetween(rng: Rng, a: string, b: string): string | null {
  if (a > b) return null;
  for (let tries = 0; tries < 60; tries++) {
    const day = addDays(a, rng.int(0, daysFrom(a, b)));
    if (isWorkday(day)) return day;
  }
  const first = workdayOnOrAfter(a);
  return first <= b ? first : null;
}

function sundayOf(year: number, month: number, nth: number): string {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return new Date(Date.UTC(year, month, 1 + ((7 - first) % 7) + (nth - 1) * 7)).toISOString().slice(0, 10);
}

function timeOn(rng: Rng, day: string): string {
  const year = Number(day.slice(0, 4));
  const standard = day < sundayOf(year, 2, 2) || day >= sundayOf(year, 10, 1);
  const minutes = rng.int(8 * 60 + 5, 17 * 60 + 20) + (standard ? 6 : 5) * 60;
  return `${day}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}.000Z`;
}

interface Town {
  city: string;
  state: string;
}

const place = (t: Town) => `${t.city}, ${t.state}`;

interface Ownership {
  type: "family" | "founder" | "esop" | "pe" | "subsidiary" | "lenders";
  holder: string | null;
  gen: number;
  esopYear: number;
}

interface State {
  ownership: Ownership;
  hq: Town;
  plants: Town[];
  headcount: number;
  ceo: string;
  certs: string[];
  chapter11: boolean;
}

interface Event {
  on: string;
  type: keyof typeof CHANGE_PHRASES;
  values: Record<string, string | number>;
  fields: FactField[];
}

interface Contact {
  name: string;
  title: string;
}

interface Entry {
  client: Client;
  supplier: Supplier;
  addedOn: string;
  addedBy: number;
  status: ListStatus;
  band: SpendBand;
  openUntil: string[][];
}

interface Supplier {
  id: number;
  name: string;
  kind: Kind;
  plant: string;
  created: string;
  snapshots: { on: string; state: State }[];
  events: Event[];
  contacts: Contact[];
  nextContact: number;
  analyst: number;
  entries: Entry[];
  contactDays: string[];
}

interface Client {
  id: number;
  spec: ClientSpec;
  subscribed: string;
  ended: boolean;
  lastDay: string;
  users: { id: number; name: string; email: string; role: "buyer" | "client_admin" }[];
  entries: Entry[];
}

interface FactDraft {
  supplier: Supplier;
  field: FactField;
  value: string;
  checked_on: string;
  checked_by: number;
  note: string;
}

interface CallDraft {
  supplier: Supplier;
  contact: Contact;
  held_on: string;
  by: number;
  write_up: string;
  mentions: FactField[];
}

interface NoteDraft {
  entry: Entry;
  staffId: number | null;
  userId: number | null;
  at: string;
  body: string;
}

const STATE_FIELDS: FactField[] = ["ownership", "parent_company", "headquarters", "plants", "headcount", "chief_executive", "certifications"];

function roundHeadcount(n: number): number {
  if (n < 100) return Math.max(5, Math.round(n / 5) * 5);
  if (n < 1000) return Math.round(n / 10) * 10;
  return Math.round(n / 50) * 50;
}

function stateAt(s: Supplier, day: string): State {
  let found = s.snapshots[0]!.state;
  for (const snap of s.snapshots) if (snap.on <= day) found = snap.state;
  return found;
}

function eventsBetween(s: Supplier, after: string, through: string): Event[] {
  return s.events.filter((e) => e.on > after && e.on <= through);
}

function plantsWord(s: Supplier, n: number) {
  return n === 1 ? s.plant : `${s.plant}s`;
}

function factValue(s: Supplier, field: FactField, day: string): string | null {
  const st = stateAt(s, day);
  const o = st.ownership;
  switch (field) {
    case "ownership":
      return {
        family: `Family owned, ${ordinal(o.gen)} generation`,
        founder: "Founder owned",
        esop: `Employee owned (ESOP) since ${o.esopYear}`,
        pe: `Majority owned by ${o.holder}`,
        subsidiary: `Wholly owned subsidiary of ${o.holder}`,
        lenders: "Owned by former lenders after Chapter 11",
      }[o.type];
    case "parent_company":
      return o.type === "pe" || o.type === "subsidiary" ? (o.holder as string) : "None; independent";
    case "headquarters":
      return place(st.hq);
    case "plants":
      return `${st.plants.length} ${plantsWord(s, st.plants.length)}: ${st.plants.map(place).join("; ")}`;
    case "headcount":
      return `About ${st.headcount}`;
    case "chief_executive":
      return st.ceo;
    case "certifications":
      return st.certs.length > 0 ? st.certs.join("; ") : "No third-party certificates";
    case "recent_change": {
      const event = eventsBetween(s, addDays(day, -365), day).at(-1);
      return event ? fill(RECENT_CHANGE_VALUES[event.type] as string, { ...event.values, plant: s.plant }) : null;
    }
  }
}

function stateLine(rng: Rng, s: Supplier, field: FactField, day: string, first: string | null): string {
  const st = stateAt(s, day);
  const o = st.ownership;
  const values = {
    first: first ?? "",
    count: st.plants.length,
    plants: plantsWord(s, st.plants.length),
    plant: s.plant,
    list: st.plants.map(place).join("; "),
    town: place(st.plants[0]!),
    n: st.headcount,
    ceo: st.ceo,
    gen: ordinal(o.gen),
    year: o.esopYear,
    holder: o.holder ?? "",
    hq: place(st.hq),
    certs: st.certs.join(", "),
  };
  const key =
    field === "plants"
      ? st.plants.length === 1 ? "plants_one" : "plants_many"
      : field === "ownership" || field === "parent_company"
        ? `ownership_${o.type}`
        : field === "certifications"
          ? st.certs.length > 0 ? "certifications_some" : "certifications_none"
          : field;
  const templates = (STATE_LINES[key] as string[]).filter((t) => first !== null || !t.includes("{first}"));
  return fill(rng.pick(templates), values);
}

function changeLine(rng: Rng, s: Supplier, event: Event, first: string, templates: readonly string[] = CHANGE_LINES): string {
  const phrase = fill(CHANGE_PHRASES[event.type] as string, { ...event.values, plant: s.plant });
  return fill(rng.pick(templates), { first, phrase, month: event.values.month as string });
}

function firstName(name: string) {
  return name.split(" ")[0] as string;
}

export function generateSeed(): Seed {
  const rng = makeRng(20261001);
  const usedNames = new Set<string>(STAFF.map((s) => s.name));
  const personName = () => {
    for (;;) {
      const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
  };
  const salt = () => Buffer.from(Array.from({ length: 16 }, () => rng.int(0, 255)));
  const bodyCounts = new Map<string, number>();
  const noteCounts = new Map<string, number>();
  const capped = (make: () => string, cap = NOTE_CAP): string => {
    let note = make();
    for (let i = 0; i < 30 && (noteCounts.get(note) ?? 0) >= cap; i++) note = make();
    noteCounts.set(note, (noteCounts.get(note) ?? 0) + 1);
    return note;
  };
  const distinct = (make: () => string): string | null => {
    for (let i = 0; i < 12; i++) {
      const body = make();
      if ((bodyCounts.get(body) ?? 0) < 2) {
        bodyCounts.set(body, (bodyCounts.get(body) ?? 0) + 1);
        return body;
      }
    }
    return null;
  };

  const staff = STAFF.map((s) => ({ ...s, password_hash: hashPasswordSync(LOCAL_PASSWORD, salt()) }));
  const fileKeeper = (owner: number) => (rng.chance(0.75) ? owner : rng.chance(0.2) ? LEAD_ID : rng.pick(ANALYST_IDS));

  let userId = 0;
  const clients: Client[] = CLIENTS.map((spec, i) => {
    const ended = spec.name === ENDED_CLIENT;
    const subscribed = ended ? (workdayBetween(rng, "2023-02-01", "2023-03-31") as string) : (workdayBetween(rng, "2022-10-03", "2025-11-14") as string);
    const count = rng.int(2, 6);
    const users = Array.from({ length: count }, (_, u) => {
      const name = personName();
      const [first, last] = name.toLowerCase().replace(/[^a-z ]/g, "").split(" ");
      return {
        id: ++userId,
        name,
        email: `${first}.${last}@${spec.slug}.example`,
        role: u === 0 || (u === 1 && count >= 5) ? ("client_admin" as const) : ("buyer" as const),
      };
    });
    return { id: i + 1, spec, subscribed, ended, lastDay: ended ? ENDED_ON : SEED_END, users, entries: [] };
  });

  const roots = rng.shuffle(SUPPLIER_ROOTS);
  const suppliers: Supplier[] = [];
  for (const [kind, count] of KIND_COUNTS) {
    const suffixes = rng.shuffle(KIND_SUFFIXES[kind]);
    for (let i = 0; i < count; i++) {
      const name = `${roots.pop()} ${suffixes[i % suffixes.length]}`;
      suppliers.push({
        id: 0,
        name,
        kind,
        plant: kind === "freight" ? "terminal" : "plant",
        created: "",
        snapshots: [],
        events: [],
        contacts: [],
        nextContact: 0,
        analyst: rng.pick(ANALYST_IDS),
        entries: [],
        contactDays: [],
      });
    }
  }

  const towns = TOWNS.map(([city, state]) => ({ city, state }));
  for (const s of suppliers) {
    const plantCount = s.kind === "freight" ? rng.int(2, 6) : s.kind === "contract_manufacturer" ? rng.int(1, 3) : rng.weighted([1, 2, 3, 4], (n) => [5, 4, 2, 1][n - 1] as number);
    const plants = rng.shuffle(towns).slice(0, plantCount);
    const type = rng.weighted(["family", "founder", "esop", "pe", "subsidiary"] as const, (t) => ({ family: 30, founder: 15, esop: 8, pe: 25, subsidiary: 22 })[t]);
    const certPool = CERTIFICATIONS[s.kind];
    const certs = rng.shuffle(certPool.slice(1)).slice(0, rng.int(0, 2));
    const initial: State = {
      ownership: {
        type,
        holder: type === "pe" ? rng.pick(PE_FIRMS) : type === "subsidiary" ? rng.pick(PARENTS) : null,
        gen: rng.int(2, 4),
        esopYear: rng.int(2004, 2019),
      },
      hq: rng.chance(0.6) ? plants[0]! : rng.pick(towns),
      plants,
      headcount: roundHeadcount(plants.reduce((sum) => sum + rng.int(35, 320), 0)),
      ceo: personName(),
      certs: rng.chance(0.8) ? [certPool[0] as string, ...certs] : certs,
      chapter11: false,
    };
    s.snapshots.push({ on: "2000-01-01", state: initial });
    const titles = rng.shuffle(CONTACT_TITLES[s.kind]);
    s.contacts = titles.slice(0, 3).map((title) => ({ name: personName(), title }));
    buildTimeline(rng, s, towns, personName);
  }

  assignLists(rng, clients, suppliers);

  suppliers.sort((a, b) => a.created.localeCompare(b.created) || a.name.localeCompare(b.name));
  suppliers.forEach((s, i) => (s.id = i + 1));

  const facts: FactDraft[] = [];
  const addFact = (s: Supplier, field: FactField, day: string, by: number, note: string) => {
    const value = factValue(s, field, day);
    if (value === null) return false;
    facts.push({ supplier: s, field, value, checked_on: day, checked_by: by, note });
    s.contactDays.push(day);
    return true;
  };
  const factNote = (s: Supplier, field: FactField, day: string, lastChecked: string) => {
    const related = eventsBetween(s, lastChecked, day).filter((e) => e.fields.includes(field)).at(-1);
    if (related && rng.chance(field === "recent_change" ? 0.6 : 0.5)) {
      const month = related.on.slice(0, 4) === day.slice(0, 4) ? monthName(related.on) : monthYear(related.on);
      return capped(() => fill(rng.pick(DATED_FACT_NOTES[field] as string[]), { month }));
    }
    return capped(() => {
      const base = rng.pick(FACT_NOTES[field] as string[]);
      return rng.chance(0.45) ? `${base}, ${monthName(day)}` : base;
    });
  };

  for (const s of suppliers) {
    if (s.created > FACTS_TO) continue;
    const sessions = rng.weighted([0, 1, 2, 3], (n) => [32, 55, 11, 2][n] as number);
    const checked = new Map<FactField, string>();
    let day = maxDay(s.created, FACTS_FROM);
    for (let i = 0; i < sessions; i++) {
      const from = i === 0 ? day : addDays(day, 45);
      const on = i === 0 && s.created >= FACTS_FROM ? workdayBetween(rng, from, minDay(addDays(from, 40), FACTS_TO)) : workdayBetween(rng, from, FACTS_TO);
      if (!on) break;
      day = on;
      const eligible = [...STATE_FIELDS, ...(factValue(s, "recent_change", on) ? (["recent_change"] as const) : [])];
      const fieldCount = i === 0 ? rng.weighted([1, 2, 3], (n) => [4, 4, 2][n - 1] as number) : 1;
      const owned = stateAt(s, on).ownership.type;
      const fields: FactField[] = [];
      while (fields.length < fieldCount) {
        const recheck = [...checked.keys()];
        const field =
          i > 0 && recheck.length > 0 && rng.chance(0.3)
            ? rng.pick(recheck)
            : rng.weighted(eligible, (f) => (f === "parent_company" ? (owned === "pe" || owned === "subsidiary" ? 3 : 1) : f === "headquarters" || f === "headcount" ? 2 : 3));
        if (!fields.includes(field)) fields.push(field);
      }
      const by = fileKeeper(s.analyst);
      for (const field of fields) {
        if (addFact(s, field, on, by, factNote(s, field, on, checked.get(field) ?? s.created))) checked.set(field, on);
      }
    }
  }

  const calls: CallDraft[] = [];
  const lastContact = (s: Supplier, day: string) => s.contactDays.filter((d) => d < day).reduce((a, b) => (a > b ? a : b), addDays(day, -240));
  const takeContact = (s: Supplier) => {
    if (s.nextContact > 0 && rng.chance(0.6)) return s.contacts[(s.nextContact - 1) % s.contacts.length]!;
    return s.contacts[s.nextContact++ % s.contacts.length]!;
  };

  function writeCall(s: Supplier, day: string, by: number, opener: readonly string[], focus?: FactField) {
    const contact = takeContact(s);
    const first = firstName(contact.name);
    const changes = eventsBetween(s, lastContact(s, day), day).slice(-2);
    const onFile = new Set(facts.filter((f) => f.supplier === s && f.checked_on < day).map((f) => f.field));
    const pool = STATE_FIELDS.filter((f) => f !== "parent_company" && f !== focus);
    const stateFields: FactField[] = [];
    for (let n = rng.int(focus ? 0 : 1, 3); n > 0; n--) {
      const field = rng.weighted(pool.filter((f) => !stateFields.includes(f)), (f) => (onFile.has(f) ? 4 : 1));
      stateFields.push(field);
    }
    if (focus && focus !== "recent_change") stateFields.unshift(focus === "parent_company" ? "ownership" : focus);
    const parts = [
      fill(rng.pick(opener), { contact: contact.name, title: contact.title, first }),
      ...stateFields.map((f) => stateLine(rng, s, f, day, first)),
      ...changes.map((e) => changeLine(rng, s, e, first)),
      ...rng.shuffle(s.kind === "freight" ? [...FREIGHT_LINES, ...OPS_LINES.slice(0, 4)] : OPS_LINES).slice(0, rng.int(0, 2)).map((line) => {
        const weeks = rng.int(3, 14);
        return fill(line, {
          weeks,
          fewer: rng.int(2, weeks - 1),
          weeks2: rng.int(2, 8),
          pct: rng.int(78, 97),
          pct2: rng.int(3, 18),
          years: rng.int(4, 26),
          year: rng.int(2027, 2029),
          trucks: rng.int(40, 420),
          states: rng.int(4, 14),
        });
      }),
      fill(rng.pick(CALL_CLOSERS), { next: monthName(addDays(day, rng.int(60, 150))) }),
    ];
    const mentions = [...new Set([...stateFields, ...changes.flatMap((e) => e.fields)])];
    const call: CallDraft = { supplier: s, contact, held_on: day, by, write_up: parts.filter(Boolean).join(" "), mentions };
    calls.push(call);
    s.contactDays.push(day);
    return call;
  }

  const callPlan: { s: Supplier; day: string }[] = [];
  for (let i = 0; i < 96; i++) {
    const s = rng.weighted(suppliers, (x) => (x.created <= addDays(SEED_END, -14) ? x.entries.length : 0));
    const day = workdayBetween(rng, maxDay(YEAR_FROM, addDays(s.created, 10)), SEED_END);
    if (day) callPlan.push({ s, day });
  }

  interface RequestDraft {
    entry: Entry;
    requestedBy: number;
    requestedOn: string;
    question: string;
    status: Seed["check_requests"][number]["status"];
    assignedTo: number | null;
    answeredOn: string | null;
    topic: FactField;
    closesOn: string;
    answeredAt?: string;
  }
  const requests: RequestDraft[] = [];
  const requestOpen = (entry: Entry, from: string, to: string) => entry.openUntil.some(([a, b]) => !(to < a! || from > b!));

  const plan: { status: RequestDraft["status"]; count: number; from: string; to: string }[] = [
    { status: "answered", count: 72, from: YEAR_FROM, to: "2026-09-16" },
    { status: "cancelled", count: 16, from: YEAR_FROM, to: "2026-09-14" },
    { status: "assigned", count: 14, from: "2026-08-24", to: "2026-09-25" },
    { status: "requested", count: 18, from: "2026-09-08", to: "2026-09-30" },
  ];
  const liveEntries = clients.flatMap((c) => c.entries).filter((e) => e.status !== "dropped");
  for (const { status, count, from, to } of plan) {
    let made = 0;
    for (let tries = 0; made < count && tries < 2000; tries++) {
      const entry = rng.weighted(liveEntries, (e) => ({ under_100k: 1, "100k_500k": 2, "500k_2m": 3, over_2m: 4 })[e.band]);
      if (entry.client.ended && status !== "answered" && status !== "cancelled") continue;
      const requestedOn = workdayBetween(rng, maxDay(from, addDays(entry.addedOn, 5)), entry.client.ended ? minDay(to, addDays(ENDED_ON, -20)) : to);
      if (!requestedOn) continue;
      const answeredOn = status === "answered" ? minDay(addWorkdays(requestedOn, rng.int(2, 10)), SEED_END) : null;
      const closesOn = answeredOn ?? (status === "cancelled" ? addWorkdays(requestedOn, rng.int(1, 6)) : SEED_END);
      if (requestOpen(entry, requestedOn, closesOn)) continue;
      const s = entry.supplier;
      const recent = eventsBetween(s, addDays(requestedOn, -300), requestedOn).at(-1);
      const topic: FactField =
        recent && rng.chance(0.5)
          ? (rng.pick(recent.fields) as FactField)
          : rng.weighted(Object.keys(QUESTIONS) as FactField[], (f) => ({ ownership: 18, parent_company: 6, plants: 16, certifications: 18, chief_executive: 10, headcount: 8, headquarters: 6, recent_change: 18 })[f]);
      const known = stateAt(s, entry.addedOn);
      const templates = (QUESTIONS[topic] as string[]).filter((q) => !q.includes("{cert}") || known.certs.length > 0);
      const question = distinct(() =>
        fill(rng.pick(templates), {
          name: s.name,
          part: rng.pick(entry.client.spec.parts),
          town: known.plants[0]!.city,
          plant: s.plant,
          plants: `${s.plant}s`,
          cert: known.certs[0] ?? "",
          month: monthName(addDays(requestedOn, 30)),
        }),
      );
      if (!question) continue;
      entry.openUntil.push([requestedOn, closesOn]);
      const assigned = status === "requested" || (status === "cancelled" && rng.chance(0.5)) ? null : rng.chance(0.1) ? LEAD_ID : rng.chance(0.7) ? s.analyst : rng.pick(ANALYST_IDS);
      requests.push({
        entry,
        requestedBy: rng.pick(entry.client.users).id,
        requestedOn,
        question,
        status,
        assignedTo: assigned,
        answeredOn,
        topic,
        closesOn,
      });
      made++;
    }
  }

  const notes: NoteDraft[] = [];
  const work = [
    ...callPlan.map((c) => ({ day: c.day, run: (): CallDraft | null => writeCall(c.s, c.day, fileKeeper(c.s.analyst), CALL_OPENERS) })),
    ...requests.filter((r) => r.status === "answered").map((r) => ({ day: r.answeredOn as string, run: (): CallDraft | null => (answer(r), null) })),
  ].sort((a, b) => a.day.localeCompare(b.day));

  function answer(r: RequestDraft) {
    const s = r.entry.supplier;
    const by = r.assignedTo as number;
    const answeredOn = r.answeredOn as string;
    const onFile = facts
      .filter((f) => f.supplier === s && f.field === r.topic && f.checked_on <= answeredOn)
      .reduce<FactDraft | undefined>((a, b) => (a && a.checked_on > b.checked_on ? a : b), undefined);
    const checkDay = minDay(answeredOn, FACTS_TO);
    const method =
      onFile && rng.chance(0.25) ? "file" : checkDay >= r.requestedOn && r.topic !== "recent_change" && rng.chance(0.25) ? "check" : "call";
    let body: string | null;
    if (method === "file" && onFile) {
      body = fill(rng.pick(ANSWER_FILE), {
        label: onFile.field.replace(/_/g, " "),
        value: onFile.value,
        checked: onFile.checked_on,
        checker: STAFF.find((x) => x.id === onFile.checked_by)!.name,
      });
    } else if (method === "check") {
      const doc = factNote(s, r.topic, checkDay, s.created);
      addFact(s, r.topic, checkDay, by, doc);
      body = fill(rng.pick(ANSWER_CHECK), { doc, date: usDate(checkDay), state: stateLine(rng, s, r.topic, checkDay, null) });
    } else {
      const held = workdayBetween(rng, addWorkdays(r.requestedOn, 1), answeredOn) ?? answeredOn;
      const call = writeCall(s, held, by, REQUEST_CALL_OPENERS, r.topic);
      const first = firstName(call.contact.name);
      const recent = eventsBetween(s, addDays(held, -365), held).filter((e) => r.topic === "recent_change" || e.fields.includes(r.topic)).at(-1);
      const state = r.topic === "recent_change" ? "" : stateLine(rng, s, r.topic, held, first);
      body = fill(rng.pick(ANSWER_CALL), {
        asked: usDate(r.requestedOn),
        contact: call.contact.name,
        title: call.contact.title,
        date: usDate(held),
        state,
        change: recent ? changeLine(rng, s, recent, first) : r.topic === "recent_change" ? `${first} said nothing has changed in ownership, plants or leadership in the past year.` : "",
      });
    }
    if (body) {
      r.answeredAt = timeOn(rng, answeredOn);
      notes.push({ entry: r.entry, staffId: by, userId: null, at: r.answeredAt, body });
    }
  }

  for (const job of work) {
    const call = job.run();
    if (call && call.held_on <= FACTS_TO && rng.chance(0.15)) {
      const field = rng.pick(call.mentions);
      const title = call.contact.title.toLowerCase();
      addFact(call.supplier, field, call.held_on, call.by, capped(() => (rng.chance(0.5) ? `${title} on the call` : `${title} on the ${monthName(call.held_on)} call`)));
    }
  }

  const noteEntries = clients.flatMap((c) => c.entries);
  const statusNoted = new Set<Entry>();
  for (let tries = 0, made = 0; made < 118 && tries < 4000; tries++) {
    const entry = rng.weighted(noteEntries, (e) => ({ under_100k: 1, "100k_500k": 2, "500k_2m": 3, over_2m: 3 })[e.band] * (e.status === "dropped" ? 0.5 : 1));
    const s = entry.supplier;
    const part = rng.pick(entry.client.spec.parts);
    const roll = rng.next();
    let day: string | null;
    let make: () => string;
    if (roll < 0.25 && !statusNoted.has(entry)) {
      const offset = { onboarding: [0, 6], approved: [20, 90], on_hold: [40, 400], dropped: [60, 500] }[entry.status];
      day = workdayBetween(rng, maxDay(YEAR_FROM, addDays(entry.addedOn, offset[0]!)), minDay(addDays(entry.addedOn, offset[1]!), entry.client.lastDay));
      make = () => fill(rng.pick(STATUS_NOTES[entry.status] as string[]), { part });
      if (day) statusNoted.add(entry);
    } else if (roll < 0.7) {
      const event = rng.pick(s.events.filter((e) => e.on > entry.addedOn) ?? []);
      if (!event) continue;
      day = workdayBetween(rng, maxDay(YEAR_FROM, addDays(event.on, 5)), minDay(addDays(event.on, 200), entry.client.lastDay));
      make = () => changeLine(rng, s, event, "", CLIENT_HEARD_NOTES);
    } else {
      day = workdayBetween(rng, maxDay(YEAR_FROM, addDays(entry.addedOn, 3)), entry.client.lastDay);
      const pool = s.kind === "freight" ? FREIGHT_CLIENT_NOTES : CLIENT_OPS_NOTES;
      make = () => fill(rng.pick(pool), { part, weeks: rng.int(4, 16), pct2: rng.int(3, 14), n: rng.int(2, 40), quarter: rng.pick(["Q1", "Q2", "Q3", "Q4"]) });
    }
    if (!day) continue;
    const body = distinct(make);
    if (!body) continue;
    notes.push({ entry, staffId: null, userId: rng.pick(entry.client.users).id, at: timeOn(rng, day), body });
    made++;
  }

  interface AdditionDraft {
    client: Client;
    requestedBy: number;
    requestedOn: string;
    name: string;
    town: Town;
    note: string;
    band: SpendBand;
    status: "requested" | "linked" | "declined";
    supplier: Supplier | null;
    decidedBy: number | null;
    decidedOn: string | null;
    decisionNote: string | null;
  }
  const additions: AdditionDraft[] = [];
  const additionNote = (client: Client) => capped(() => fill(rng.pick(ADDITION_NOTES), { part: rng.pick(client.spec.parts) }), 2);
  for (const entry of clients.flatMap((c) => c.entries).filter((e) => e.addedOn >= ADDITIONS_FROM)) {
    const requestedOn = workdayBetween(rng, maxDay(ADDITIONS_FROM, addDays(entry.addedOn, -9)), addDays(entry.addedOn, -1)) ?? entry.addedOn;
    additions.push({
      client: entry.client,
      requestedBy: entry.addedBy,
      requestedOn,
      name: entry.supplier.name,
      town: stateAt(entry.supplier, requestedOn).hq,
      note: additionNote(entry.client),
      band: entry.band,
      status: "linked",
      supplier: entry.supplier,
      decidedBy: fileKeeper(entry.supplier.analyst),
      decidedOn: entry.addedOn,
      decisionNote: null,
    });
  }
  const activeClients = clients.filter((c) => !c.ended);
  const newName = () => `${roots.pop()} ${rng.pick(KIND_SUFFIXES[rng.pick(KIND_COUNTS)[0]])}`;
  for (let i = 0; i < 4; i++) {
    const client = rng.pick(activeClients);
    const requestedOn = workdayBetween(rng, ADDITIONS_FROM, "2026-09-11") as string;
    additions.push({
      client,
      requestedBy: rng.pick(client.users).id,
      requestedOn,
      name: newName(),
      town: rng.pick(towns),
      note: additionNote(client),
      band: "under_100k",
      status: "declined",
      supplier: null,
      decidedBy: rng.pick(ANALYST_IDS),
      decidedOn: addWorkdays(requestedOn, rng.int(1, 5)),
      decisionNote: DECLINE_NOTES[i % DECLINE_NOTES.length] as string,
    });
  }
  for (let i = 0; i < 6; i++) {
    const client = activeClients[(i * 5) % activeClients.length] as Client;
    const requestedOn = workdayBetween(rng, "2026-09-14", SEED_END) as string;
    const known = i % 2 === 0 ? rng.pick(suppliers.filter((x) => x.created < requestedOn && !x.entries.some((e) => e.client === client))) : null;
    additions.push({
      client,
      requestedBy: rng.pick(client.users).id,
      requestedOn,
      name: known ? known.name : newName(),
      town: known ? stateAt(known, requestedOn).hq : rng.pick(towns),
      note: additionNote(client),
      band: rng.pick(["under_100k", "100k_500k", "500k_2m"] as const),
      status: "requested",
      supplier: null,
      decidedBy: null,
      decidedOn: null,
      decisionNote: null,
    });
  }

  interface ChangeDraft {
    supplier: Supplier;
    staffId: number;
    field: "hq_city" | "hq_state" | "plants";
    old: string;
    value: string;
    at: string;
  }
  const changes: ChangeDraft[] = [];
  const rows = new Map(
    suppliers.map((s) => {
      const st = stateAt(s, s.created);
      return [s, { hq_city: st.hq.city, hq_state: st.hq.state, plants: rng.chance(0.3) ? "" : st.plants.map(place).join("; ") }];
    }),
  );
  for (const f of [...facts].sort((a, b) => a.checked_on.localeCompare(b.checked_on))) {
    if (f.field !== "headquarters" && f.field !== "plants") continue;
    const row = rows.get(f.supplier)!;
    const wanted =
      f.field === "plants" ? { plants: f.value.slice(f.value.indexOf(": ") + 2) } : { hq_city: f.value.split(", ")[0] as string, hq_state: f.value.split(", ")[1] as string };
    const differs = (Object.keys(wanted) as (keyof typeof wanted)[]).filter((k) => row[k] !== wanted[k]);
    if (differs.length === 0 || (f.checked_on >= "2026-08-17" && rng.chance(0.5))) continue;
    const at = timeOn(rng, f.checked_on);
    for (const k of differs) {
      changes.push({ supplier: f.supplier, staffId: f.checked_by, field: k, old: row[k], value: wanted[k] as string, at });
      row[k] = wanted[k] as string;
    }
  }

  const byDay = <T>(list: T[], day: (row: T) => string) =>
    list.map((row, i) => ({ row, i })).sort((a, b) => day(a.row).localeCompare(day(b.row)) || a.i - b.i).map(({ row }) => row);

  const factRows = byDay(facts, (f) => f.checked_on);
  const callRows = byDay(calls, (c) => c.held_on);
  const requestRows = byDay(requests, (r) => r.requestedOn);
  const additionRows = byDay(additions, (a) => a.requestedOn);
  const noteRows = byDay(notes, (n) => n.at);

  type Act = Seed["activity"][number];
  const acts: Omit<Act, "id">[] = [];
  const act = (at: string, who: { staff: number } | { user: number }, clientId: number | null, action: string, subject: string) => {
    if (at < ACTIVITY_FROM) return;
    const staffSide = "staff" in who;
    acts.push({
      actor_kind: staffSide ? "staff" : "client_user",
      staff_id: staffSide ? who.staff : null,
      client_user_id: staffSide ? null : who.user,
      client_id: clientId,
      action,
      subject,
      at,
    });
  };
  for (const f of factRows) act(timeOn(rng, f.checked_on), { staff: f.checked_by }, null, "fact.added", `supplier:${f.supplier.id} ${f.field}`);
  for (const c of callRows) act(timeOn(rng, c.held_on), { staff: c.by }, null, "call.added", `supplier:${c.supplier.id}`);
  for (const c of changes) act(c.at, { staff: c.staffId }, null, "supplier.updated", `supplier:${c.supplier.id}`);
  requestRows.forEach((r, i) => {
    const subject = `check_request:${i + 1}`;
    const clientId = r.entry.client.id;
    act(timeOn(rng, r.requestedOn), { user: r.requestedBy }, clientId, "check_request.requested", subject);
    if (r.assignedTo !== null) {
      const assignedOn = workdayBetween(rng, r.requestedOn, minDay(r.answeredOn ?? r.closesOn, SEED_END)) ?? r.requestedOn;
      act(timeOn(rng, assignedOn), { staff: LEAD_ID }, clientId, "check_request.assigned", subject);
    }
    if (r.status === "answered" && r.answeredAt) act(r.answeredAt, { staff: r.assignedTo as number }, clientId, "check_request.answered", subject);
    if (r.status === "cancelled") act(timeOn(rng, r.closesOn), { user: r.requestedBy }, clientId, "check_request.cancelled", subject);
  });
  for (const n of noteRows) {
    act(n.at, n.staffId !== null ? { staff: n.staffId } : { user: n.userId as number }, n.entry.client.id, "note.added", `supplier:${n.entry.supplier.id}`);
  }
  additionRows.forEach((a, i) => {
    const subject = `addition_request:${i + 1}`;
    act(timeOn(rng, a.requestedOn), { user: a.requestedBy }, a.client.id, "addition.requested", subject);
    if (a.decidedOn === null || a.decidedBy === null) return;
    const at = timeOn(rng, a.decidedOn);
    if (a.supplier && a.supplier.created === a.decidedOn && a.supplier.entries.every((e) => e.addedOn >= a.decidedOn!)) {
      act(at, { staff: a.decidedBy }, null, "supplier.added", `supplier:${a.supplier.id}`);
    }
    act(at, { staff: a.decidedBy }, a.client.id, a.status === "linked" ? "addition.linked" : "addition.declined", a.supplier ? `${subject} supplier:${a.supplier.id}` : subject);
  });

  return {
    staff,
    clients: clients.map((c) => ({
      id: c.id,
      name: c.spec.name,
      industry: c.spec.industry,
      city: c.spec.city,
      state: c.spec.state,
      subscribed_on: c.subscribed,
      status: c.ended ? "ended" : "active",
    })),
    client_users: clients.flatMap((c) =>
      c.users.map((u) => ({ id: u.id, client_id: c.id, name: u.name, email: u.email, role: u.role, password_hash: hashPasswordSync(LOCAL_PASSWORD, salt()) })),
    ),
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name, kind: s.kind, ...rows.get(s)!, created_on: s.created })),
    supplier_list: clients.flatMap((c) =>
      [...c.entries]
        .sort((a, b) => a.supplier.id - b.supplier.id)
        .map((e) => ({ client_id: c.id, supplier_id: e.supplier.id, added_on: e.addedOn, added_by: e.addedBy, status: e.status, spend_band: e.band })),
    ),
    facts: factRows.map((f, i) => ({
      id: i + 1,
      supplier_id: f.supplier.id,
      field: f.field,
      value: f.value,
      checked_on: f.checked_on,
      checked_by: f.checked_by,
      note: f.note,
    })),
    calls: callRows.map((c, i) => ({
      id: i + 1,
      supplier_id: c.supplier.id,
      contact_name: c.contact.name,
      contact_title: c.contact.title,
      held_on: c.held_on,
      by_staff_id: c.by,
      write_up: c.write_up,
    })),
    supplier_changes: byDay(changes, (c) => c.at).map((c, i) => ({
      id: i + 1,
      supplier_id: c.supplier.id,
      staff_id: c.staffId,
      field: c.field,
      old_value: c.old,
      new_value: c.value,
      changed_at: c.at,
    })),
    check_requests: requestRows.map((r, i) => ({
      id: i + 1,
      client_id: r.entry.client.id,
      supplier_id: r.entry.supplier.id,
      requested_by: r.requestedBy,
      requested_on: r.requestedOn,
      question: r.question,
      status: r.status,
      assigned_to: r.assignedTo,
      answered_on: r.answeredOn,
    })),
    addition_requests: additionRows.map((a, i) => ({
      id: i + 1,
      client_id: a.client.id,
      requested_by: a.requestedBy,
      requested_on: a.requestedOn,
      name: a.name,
      city: a.town.city,
      state: a.town.state,
      note: a.note,
      spend_band: a.band,
      status: a.status,
      supplier_id: a.supplier?.id ?? null,
      decided_by: a.decidedBy,
      decided_on: a.decidedOn,
      decision_note: a.decisionNote,
    })),
    notes: noteRows.map((n, i) => ({
      id: i + 1,
      client_id: n.entry.client.id,
      supplier_id: n.entry.supplier.id,
      author_staff_id: n.staffId,
      author_user_id: n.userId,
      written_at: n.at,
      body: n.body,
    })),
    activity: byDay(acts, (a) => a.at).map((a, i) => ({ id: i + 1, ...a })),
  };
}

function buildTimeline(rng: Rng, s: Supplier, towns: Town[], personName: () => string): void {
  const count = rng.weighted([0, 1, 2, 3, 4], (n) => [6, 24, 32, 24, 14][n] as number);
  const days: string[] = [];
  for (let tries = 0; days.length < count && tries < 50; tries++) {
    const day = workdayBetween(rng, EVENTS_FROM, EVENTS_TO) as string;
    if (days.every((d) => Math.abs(daysFrom(d, day)) > 45)) days.push(day);
  }
  const pending = days.sort().map((on) => ({ on, type: null as Event["type"] | null }));
  while (pending.length > 0) {
    const { on, type: forced } = pending.shift()!;
    const st = structuredClone(stateAt(s, on));
    const o = st.ownership;
    const options: [Event["type"], number][] = st.chapter11
      ? [["ceo_replaced", 3], ["plant_closed", st.plants.length > 1 ? 4 : 0], ["headcount_cut", 3]]
      : [
          ["acquired_pe", o.type === "pe" || o.type === "subsidiary" ? 0 : 6],
          ["acquired_strategic", o.type === "subsidiary" ? 0 : 5],
          ["parent_changed", o.type === "pe" || o.type === "subsidiary" ? 5 : 0],
          ["plant_opened", 12],
          ["plant_closed", st.plants.length > 1 ? 10 : 0],
          ["hq_moved", 7],
          ["ceo_replaced", 14],
          ["cert_gained", st.certs.length < CERTIFICATIONS[s.kind].length ? 9 : 0],
          ["cert_lapsed", st.certs.length > 0 ? 7 : 0],
          ["headcount_cut", 9],
          ["ch11_filed", on < "2026-04-01" ? 3 : 0],
        ];
    const type = forced ?? rng.weighted(options, ([, w]) => w)[0];
    const values: Record<string, string | number> = { month: monthYear(on) };
    let fields: FactField[] = ["recent_change"];
    switch (type) {
      case "acquired_pe":
      case "acquired_strategic":
      case "parent_changed": {
        const pool = type === "acquired_pe" || (type === "parent_changed" && o.type === "pe" && rng.chance(0.5)) ? PE_FIRMS : PARENTS;
        const holder = rng.pick(pool.filter((h) => h !== o.holder));
        values.old = o.holder ?? "";
        values.holder = holder;
        st.ownership = { ...o, type: pool === PE_FIRMS ? "pe" : "subsidiary", holder };
        fields = ["ownership", "parent_company", "recent_change"];
        break;
      }
      case "plant_opened": {
        const town = rng.pick(towns.filter((t) => !st.plants.some((p) => p.city === t.city)));
        st.plants = [...st.plants, town];
        st.headcount = roundHeadcount(st.headcount + rng.int(30, 140));
        values.town = place(town);
        fields = ["plants", "headcount", "recent_change"];
        break;
      }
      case "plant_closed": {
        const closed = rng.pick(st.plants);
        st.plants = st.plants.filter((p) => p !== closed);
        st.headcount = roundHeadcount(st.headcount * (1 - rng.int(15, 35) / 100));
        values.town = place(closed);
        fields = ["plants", "headcount", "recent_change"];
        break;
      }
      case "hq_moved": {
        const to = rng.pick([...st.plants, ...towns].filter((t) => t.city !== st.hq.city));
        values.old = place(st.hq);
        values.hq = place(to);
        st.hq = to;
        fields = ["headquarters", "recent_change"];
        break;
      }
      case "ceo_replaced": {
        values.old = st.ceo;
        st.ceo = personName();
        values.ceo = st.ceo;
        fields = ["chief_executive", "recent_change"];
        break;
      }
      case "cert_gained": {
        const cert = rng.pick(CERTIFICATIONS[s.kind].filter((c) => !st.certs.includes(c)));
        st.certs = [...st.certs, cert];
        values.cert = cert;
        fields = ["certifications", "recent_change"];
        break;
      }
      case "cert_lapsed": {
        const cert = rng.pick(st.certs);
        st.certs = st.certs.filter((c) => c !== cert);
        values.cert = cert;
        fields = ["certifications", "recent_change"];
        break;
      }
      case "headcount_cut": {
        const cut = roundHeadcount(st.headcount * (rng.int(8, 25) / 100));
        st.headcount = roundHeadcount(st.headcount - cut);
        values.n = cut;
        fields = ["headcount", "recent_change"];
        break;
      }
      case "ch11_filed": {
        st.chapter11 = true;
        st.headcount = roundHeadcount(st.headcount * 0.88);
        fields = ["headcount", "recent_change"];
        const out = workdayOnOrAfter(addDays(on, rng.int(120, 260)));
        if (out <= EVENTS_TO) {
          pending.push({ on: out, type: "ch11_emerged" });
          pending.sort((a, b) => a.on.localeCompare(b.on));
        }
        break;
      }
      case "ch11_emerged": {
        st.chapter11 = false;
        if (rng.chance(0.5)) {
          st.ownership = { ...o, type: "lenders", holder: null };
          fields = ["ownership", "parent_company", "recent_change"];
        }
        break;
      }
    }
    s.events.push({ on, type, values, fields });
    s.snapshots.push({ on, state: st });
  }
}

function assignLists(rng: Rng, clients: Client[], suppliers: Supplier[]): void {
  const wanted = suppliers.map(() => rng.weighted([1, 2, 3, 4, 5], (n) => [52, 28, 12, 5, 3][n - 1] as number));
  const total = wanted.reduce((a, b) => a + b, 0);
  const raw = clients.map(() => rng.int(10, 40));
  const scale = total / raw.reduce((a, b) => a + b, 0);
  const room = new Map(clients.map((c, i) => [c, Math.min(40, Math.max(10, Math.round((raw[i] as number) * scale)))]));
  const bands: SpendBand[] = ["under_100k", "100k_500k", "500k_2m", "over_2m"];
  suppliers.forEach((s, i) => {
    const chosen: Client[] = [];
    while (chosen.length < (wanted[i] as number)) {
      const open = clients.filter((c) => !chosen.includes(c) && c.entries.length < 40);
      const client = rng.weighted(open, (c) => Math.max(0.05, (room.get(c) as number) - c.entries.length) * (c.spec.kinds[s.kind] ?? 0.4));
      chosen.push(client);
      const recent = !client.ended && rng.chance(0.12);
      const addedOn = recent
        ? (workdayBetween(rng, maxDay(RECENT_FROM, client.subscribed), "2026-09-22") as string)
        : (workdayBetween(rng, maxDay(client.subscribed, "2022-10-03"), client.ended ? addDays(ENDED_ON, -60) : addDays(RECENT_FROM, -1)) as string);
      const status: ListStatus = recent
        ? rng.weighted(["onboarding", "approved", "on_hold"] as const, (x) => ({ onboarding: 65, approved: 30, on_hold: 5 })[x])
        : rng.weighted(["approved", "on_hold", "dropped"] as const, (x) => ({ approved: 70, on_hold: 13, dropped: 17 })[x]);
      const entry: Entry = {
        client,
        supplier: s,
        addedOn,
        addedBy: rng.pick(client.users).id,
        status,
        band: rng.weighted(bands, (b) => ({ under_100k: 35, "100k_500k": 35, "500k_2m": 20, over_2m: 10 })[b]),
        openUntil: [],
      };
      client.entries.push(entry);
      s.entries.push(entry);
    }
    s.created = s.entries.map((e) => e.addedOn).reduce((a, b) => (a < b ? a : b));
  });
}

export function seedJson(seed: Seed): string {
  const tables = Object.entries(seed as unknown as Record<string, Record<string, unknown>[]>).map(([table, rows]) => {
    const columns = Object.keys(rows[0] ?? {});
    const lines = rows.map((row) => `      ${JSON.stringify(columns.map((c) => row[c]))}`).join(",\n");
    return `  "${table}": {\n    "columns": ${JSON.stringify(columns)},\n    "rows": [\n${lines}\n    ]\n  }`;
  });
  return `{\n${tables.join(",\n")}\n}\n`;
}
