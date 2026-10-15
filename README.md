# Tessary supplier desk

Tessary checks suppliers for procurement teams at mid-size US manufacturers. We are about twenty people in Lanesford, Wisconsin, started in 2022: a lead analyst and seven analysts, two engineers, and our sales and client success people. Sixteen manufacturers have signed up (food packaging, industrial parts, furniture, medical disposables and the like), each on a yearly subscription; one has since ended. This desk is the product they sign in to. Each client keeps its list of suppliers here (raw materials, components, packaging, freight, contract manufacturers) with a status and a spend band, writes notes on them, and asks us to check a supplier; our analysts keep the shared supplier file of facts and call write-ups and answer those checks. On any supplier's page, a client user can ask the assistant a question, and it answers from the desk's own records.

Facts about a supplier get into the file when an analyst checks them and types them in, with the date they checked, their name, and a note on how they know.

A client adds a supplier to their list by giving us its name, city and state. That makes an addition request; one of our analysts finds the supplier in the file and links it, or adds it to the file first, and it joins the client's list as `onboarding`. Clients never write to the supplier file.

## What is in it

| Table | What it holds |
| --- | --- |
| `staff` | Tessary staff: name, email, role (`analyst`, `lead`, `admin`), password hash |
| `clients` | Name (unique regardless of case), industry, city, state, subscribed on, status (`active`, `ended`) |
| `client_users` | Client, name, email, role (`buyer`, `client_admin`), password hash, deactivated on |
| `suppliers` | Name (unique regardless of case), kind (`raw_materials`, `components`, `packaging`, `freight`, `contract_manufacturer`), headquarters city and state, plants, created on |
| `supplier_changes` | Every change staff make to a supplier row: field, old and new value, who, when |
| `supplier_list` | One row per client and supplier: added on, added by, status (`onboarding`, `approved`, `on_hold`, `dropped`), spend band (`under_100k`, `100k_500k`, `500k_2m`, `over_2m`) |
| `addition_requests` | A client's request to add a supplier: typed name, city, state, note, spend band, status (`requested`, `linked`, `declined`), the supplier it was linked to, who decided, when, and the analyst's note on a decline |
| `facts` | Supplier, field, value, `checked_on`, `checked_by` (staff), `note` |
| `calls` | Supplier, contact name and title, held on, by (staff), write-up |
| `check_requests` | Client, supplier, requested by, requested on, question, status (`requested`, `assigned`, `answered`, `cancelled`), assigned to, answered on |
| `notes` | Client, supplier, author (one staff member or one client user), written at, body |
| `activity` | Actor (kind and the staff member or client user), client, action, subject, time |
| `sessions` | Signed-in sessions: who, started, expires, ended |

Fact fields are `ownership`, `parent_company`, `headquarters`, `plants`, `headcount`, `chief_executive`, `certifications` and `recent_change`. The `note` on a fact row says how the analyst knows ("state filing", "certificate copy they sent", "plant manager on the call", "press release, May").

### Rules the store keeps

- `activity`, `notes`, `facts`, `calls` and `supplier_changes` are append-only: rows cannot be changed or deleted, and an insert over an existing id is refused.
- List entries are never deleted or replaced; a supplier leaves a list by moving to `dropped`.
- A check request moves only `requested` to `assigned` or `cancelled`, and `assigned` to `answered` or `cancelled`; nothing else about it changes, and it cannot be deleted. A client has at most one open (`requested` or `assigned`) check request per supplier.
- An addition request moves only from `requested` to `linked` (with a supplier) or `declined` (with a note). A client has at most one open request per name.
- Every write runs in a transaction that also appends an `activity` row naming the signed-in person. Status moves are conditional updates: when two moves start from the same read, the second answers `409 status_changed` and writes nothing.
- "Today" for date checks is the company's day in Central time.

The schema is built by an ordered list of migrations in `src/db.ts`, and the store's `PRAGMA user_version` is the number applied (7, matching package version 1.7.0): first tables (2022-09), spend band on list entries (2023-04), check requests (2024-02), supplier change history (2025-05), supplier addition requests (2026-03), activity log (2026-04), and server-side sessions with user deactivation (2026-09). Opening an older store applies the rest.

### Who sees what

A client user sees and changes only their own client's list entries, notes, check requests and addition requests. Every query for client records takes the client from the session, never from the request. A supplier that is not on the client's list answers `404 not_found`, worded the same as a supplier that does not exist. Asking to add a supplier answers the same way whether or not the file has it. Facts and calls are Tessary's shared file: a client user reads them for suppliers on their list and never writes them. Staff see every client.

### Routes

Every JSON route except `POST /session` and `DELETE /session` needs a session. JSON routes take JSON bodies only. Problems come back as `application/problem+json` with a `code`; anything unexpected is `500 internal_error`. Paths are matched with their exact capitals. Path ids are positive whole numbers; text fields are trimmed (invisible zero-width characters removed) and refused when blank; states are two-letter US state codes.

| Route | What it does | What it refuses |
| --- | --- | --- |
| `POST /session` | Signs in a staff member or client user by email and password and starts a twelve-hour session (HttpOnly, SameSite=Lax cookie) | `401 bad_credentials` for an unknown email or a wrong password, worded the same; `429 too_many_attempts` (see Sessions); `403 client_ended`; `403 user_deactivated` |
| `DELETE /session` | Ends the session and clears the cookie | |
| `POST /session/password` | Changes the signed-in person's password with the old `password` and a `new_password`; ends their other sessions | `403 wrong_password`; `400` for a new password under ten characters |
| `GET /list` | The client's entries, filtered by `status` | `403` for staff; `400` for an unknown status |
| `POST /list` | Asks Tessary to add a supplier: `name`, `city`, `state`, `spend_band`, optional `note`; answers the new addition request | `409 already_on_list` for a name already on the client's list; `409 request_open` for a name with an open request; `400` for anything else |
| `GET /addition-requests` | The client's addition requests, newest first | `403` for staff |
| `PATCH /list/:supplierId` | Moves the entry to `onboarding`, `approved`, `on_hold` or `dropped`, or changes its spend band | `404` off the list; `400` for anything else |
| `GET /suppliers/:id` | The supplier, its facts and calls, and this client's entry, notes and check requests | `404` off the list |
| `POST /suppliers/:id/notes` | Adds a note on this client's entry | `404` off the list |
| `POST /suppliers/:id/check-requests` | Asks Tessary to check something; the request starts `requested` | `404` off the list; `409 request_open` |
| `POST /check-requests/:id/cancel` | Cancels a `requested` or `assigned` request | `404` for another client's request; `403` unless the person who asked or a client admin; `409 status_changed` once answered or cancelled |
| `GET /client-users`, `POST /client-users` | Lists the client's users; adds one | `403` unless client admin; `409 email_taken`; `400` for a password under ten characters or a `client_id` in the body |
| `POST /client-users/:id/deactivate` | Deactivates a user of the same client and ends their sessions | `403` unless client admin; `404` for another client's user; `409 cannot_deactivate_self`; `409 status_changed` once deactivated |
| `GET /staff/suppliers` | The supplier file, searched by `q` (name) and `kind`, with fact row counts, the most recent `checked_on` and how many client lists each is on | `403` for client users |
| `POST /staff/suppliers` | Adds a supplier | `403` unless analyst or lead; `409 supplier_exists` |
| `GET /staff/suppliers/:id` | The supplier, its facts, calls, row changes and every client list it is on | `404` |
| `PATCH /staff/suppliers/:id` | Changes `kind`, `plants`, or `hq_city` and `hq_state` together, recording each changed field in `supplier_changes` | `403` unless analyst or lead; `400` for any other field or a city without its state |
| `POST /staff/suppliers/:id/facts` | Adds a fact row; `checked_by` is the signed-in analyst | `403` unless analyst or lead; `400 checked_on_in_future`; `400 invalid_request` for a missing or impossible date, an unknown field, a blank value or note, or a `checked_by` in the body |
| `POST /staff/suppliers/:id/calls` | Adds a call write-up by the signed-in analyst | `403` unless analyst or lead; `400 held_on_in_future` |
| `GET /staff/check-requests` | Every client's check requests, filtered by `status` | `403` for client users |
| `POST /staff/check-requests/:id/assign` | `requested` to `assigned`, with `analyst_id` (a number or a numeric string) | `403` unless the lead; `400 not_an_analyst`; `409 status_changed` unless `requested` |
| `POST /staff/check-requests/:id/answer` | `assigned` to `answered`, with a summary `note` written on that client's entry | `403` unless the analyst it is assigned to; `409 status_changed` unless `assigned` |
| `GET /staff/addition-requests` | Every client's addition requests, filtered by `status`, with the id of a file supplier of the same name | `403` for client users |
| `POST /staff/addition-requests/:id/link` | Links the request to `supplier_id`, or to a new file supplier given as `supplier`; the supplier joins the client's list as `onboarding` with the request's spend band, added by the person who asked | `403` unless analyst or lead; `409 already_on_list`; `409 supplier_exists`; `409 status_changed` unless `requested` |
| `POST /staff/addition-requests/:id/decline` | Declines the request with a `decision_note` the client sees | `403` unless analyst or lead; `409 status_changed` unless `requested` |
| `GET /staff/activity` | The 100 most recent activity rows | `403` for client users |
| `GET /staff/clients`, `POST /staff/clients` | Lists clients; adds one as `active` with its first client admin | `403` unless admin; `409 client_exists`; `409 email_taken` |
| `POST /staff/clients/:id/end` | Ends a client; its users can no longer sign in and their sessions end | `403` unless admin; `409 status_changed` once ended |
| `POST /assistant/suppliers/:id` | Answers a client user's question about one supplier on their list | `403` for staff; `404` off the list; `503 assistant_unconfigured`; `429 too_many_questions`; `502 model_call_failed` |

## Pages

The same app serves plain HTML pages with no scripts. `/` goes to `/sign-in`, which signs in by email and password into the same kind of session as `POST /session` and sends client users to `/app` and staff to `/desk`. Every page has a password form at `/password` and a sign-out button. Pages answer problems as HTML pages, never as `application/problem+json`. Every form post must carry an `Origin` or `Referer` header naming this host, or it is refused with `403`.

| Page | Who | What it shows and does |
| --- | --- | --- |
| `/app` | Client users | Their suppliers grouped by status, their addition requests, and a form to ask us to add a supplier |
| `/app/suppliers/:id` | Client users | The supplier, its facts and calls, the client's notes and check requests; forms to change status and spend band, add a note, request a check, cancel an open request, and ask the assistant (the answer shows with its tool calls) |
| `/desk` | Staff | Open check requests; the lead assigns them and the assigned analyst answers them here |
| `/desk/suppliers`, `/desk/suppliers/:id` | Staff | The supplier file with a name search; a supplier with its facts, calls, row changes and client lists, and forms to add a fact and a call |
| `/desk/additions` | Staff | Open addition requests to link to a supplier, add to the file and link, or decline; recent decisions |
| `/desk/activity` | Staff | The 100 most recent activity rows |

## The assistant

`POST /assistant/suppliers/:id` with `{"question": "..."}` answers `{"answer": "...", "tool_calls": [{"name": "...", "arguments": {...}}]}`. The `tool_calls` list is every tool call the loop answered, in order, including any it did not run because the deadline had passed or the question's tool results were full.

The loop is in `src/assistant/loop.ts`. It sends the question, today's date, the client's name, the supplier's id, name and headquarters, and the five tools below to a chat-completions endpoint, runs the tool calls that come back one after another, and sends the results. It makes at most six model calls; the last one still lists the tools but carries `tool_choice: "none"`, so the reply to it is the answer. An empty answer or a failed call is a `502`. Each question has a two-minute deadline and stops early if the caller hangs up. When the two minutes run out during a round, the tool results that finished are kept, a tool still running gets `tool_failed` and is logged like a tool that throws, a tool not yet started gets `tool_failed` without being run, and the next model call is the last one, with at least 30 seconds of its own. A hang-up runs no further tools and logs no `tool_failed`. Each client user can ask 30 questions an hour; the next one answers `429 too_many_questions`. Like the sign-in counts, these are kept in the server's memory and reset when it restarts. The one outbound call is in `src/assistant/model.ts`.

| Tool | Reads or writes | Scope |
| --- | --- | --- |
| `supplier_profile` | Reads the supplier's row: name, kind, headquarters, plants, created on | The supplier in the path |
| `facts` | Reads fact rows (field, value, `checked_on`, `checked_by`, note), or one field's with `field` | The supplier in the path |
| `calls` | Reads analysts' call write-ups with the contact's name and title and the date | The supplier in the path |
| `our_history` | Reads the client's entry for the supplier, its notes and its check requests | The supplier in the path and the signed-in user's client |
| `save_note` | Writes a note on the client's entry with the signed-in user as author and logs `note.added`; one per question, and only while that user and their client are still active | The supplier in the path and the signed-in user's client |

Every tool takes the supplier from the path and the client from the session; a tool may also be given `supplier_id` (a number or a numeric string), which must be that supplier. A tool call for another supplier gets `scope_refused` back, is logged to `activity` as `scope_refused` with the signed-in user as actor, and the loop goes on. Arguments outside a tool's own list, unreadable arguments and unknown tools get an error back and the loop goes on. A tool that throws, or whose result cannot be written as JSON, gets `tool_failed` back, is logged to `activity` as `tool_failed` with the signed-in user as actor, and the loop goes on. Up to eight tool calls run from each model reply and twenty per question; calls past either limit are left out of the conversation the model sees and are not run. Once a question has run twenty, the next model call is the last. Lists in tool results run newest first; a result over 16,000 characters is cut to at most 16,000, ending with ` [cut]`; a question's tool results share 48,000 characters: a result that does not fit in what is left is cut to it, and once fewer than 512 are left, further calls are not run and get `question_context_full`.

## Roles

- **analyst** (staff): adds and changes suppliers, adds fact rows and call write-ups, decides addition requests, answers the check requests assigned to them.
- **lead** (staff): everything an analyst does, plus assigning check requests.
- **admin** (staff): adds and ends clients.
- **buyer** (client): keeps the client's list, asks us to add suppliers, writes notes, requests checks, cancels their own requests, asks the assistant.
- **client_admin** (client): everything a buyer does, plus adding and deactivating users and cancelling any of the client's requests.

All staff read the whole supplier file, every client's check and addition requests, and the activity log.

## Sessions and passwords

Sessions live in the `sessions` table; the cookie holds a random token, and the table keeps only a keyed hash of it (keyed with `SESSION_SECRET`). Rows for sessions that expired more than a week ago are removed at the next sign-in. A session lasts twelve hours and ends early on sign-out, `DELETE /session`, a password change (for the person's other sessions), the user being deactivated, or their client being ended. Passwords are hashed with scrypt. From the third failed sign-in for one email within fifteen minutes, each failure is answered more slowly; after five, that email is refused with `429 too_many_attempts` for five minutes. These counts are kept in the server's memory, so they reset when it restarts.

## Running locally

Node 22 or later.

```sh
npm install
cp .env.example .env
npm start
```

Before `npm start`, set `SESSION_SECRET` in `.env` to a random string, and either fill in the three `MODEL_` lines or leave them as they are; values that still start with `replace-with` count as unset.

`npm start` compiles to `dist/` and serves on `127.0.0.1` and `PORT` (3000 by default); set `HOST` to listen elsewhere. If the port cannot be bound, the server prints why and exits. On first start it creates `data/desk.sqlite`, and when the store is empty it loads `data/seed.json`.

Every seeded user, staff and client alike, has the local password `supplier-desk-local`. Staff sign in as `ingrid@tessary.example` (lead), `marcus@tessary.example`, `teresa@tessary.example`, `gordon@tessary.example`, `lindsay@tessary.example`, `hakeem@tessary.example`, `brenna@tessary.example`, `victor@tessary.example` (analysts) and `corinne@tessary.example` (admin). Client users' emails are in `data/seed.json` under `client_users`.

Settings, read from the environment or `.env`:

| Setting | Used for |
| --- | --- |
| `SESSION_SECRET` | Keying the stored session hashes; the server will not start without one of 16 or more characters |
| `PORT` | Port to listen on |
| `COOKIE_SECURE` | `true` adds `Secure` to the session cookie; set it when the desk is served over HTTPS |
| `MODEL_BASE_URL` | Base address of a chat-completions endpoint; the desk posts to `<MODEL_BASE_URL>/chat/completions` |
| `MODEL_API_KEY` | Sent as `Authorization: Bearer <key>` |
| `MODEL_NAME` | Sent as `model` |

With any of the three model settings unset, the assistant route answers `503 assistant_unconfigured` and everything else works.

## Tests

```sh
npm test
npm run typecheck
```

Tests run against an in-memory store loaded from the seed, start the app on a local port inside the test process, and use a scripted model in place of the endpoint. They need no settings and no network.

## The data

`data/seed.json` holds the desk as of the end of September 2026, one table per key with its column names and rows. Calls, check requests and notes cover the twelve months from October 2025; fact rows reach back to June 2025, and list entries to each client's first months.

- 9 staff (the lead, 7 analysts, 1 admin) and 16 clients (15 active, 1 ended) with 70 client users (25 client admins, 45 buyers), 2 to 6 per client.
- 260 suppliers (62 raw materials, 70 components, 52 packaging, 28 freight, 48 contract manufacturers), each on 1 to 5 clients' lists, and 25 recorded changes to supplier rows.
- 462 list entries, 13 to 40 per client: 314 approved, 19 onboarding, 52 on hold, 77 dropped.
- 81 addition requests since March 2026: 71 linked, 4 declined, 6 requested.
- 376 fact rows on 184 suppliers, checked between June 2025 and August 2026: 60 ownership, 33 parent company, 38 headquarters, 53 plants, 47 headcount, 45 chief executive, 61 certifications, 39 recent change.
- 158 call write-ups on 107 suppliers.
- 120 check requests: 72 answered, 16 cancelled, 14 assigned, 18 requested.
- 190 notes: 118 by client users and 72 analysts' answers to check requests.
- 666 activity rows, from the log's start in April 2026.

`scripts/seed/generate.ts` produces it from a fixed seed, so `npm run seed` writes the same bytes every time, and a test checks the committed file against it.
