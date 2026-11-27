# Frame Hub

One app for Frame Architecture: **Proposals → Sales CRM → Projects**, with a dashboard on top.
It replaces the Tracking Sales Sheet, the Job List workbook and the first quoting tool
(frame-quoting.vercel.app), and keeps their math.

- **Proposals** — client & project, scope (optionally polished by Claude from Frame's past proposals), a
  structured fee builder (phase split, engineers, additional services, reimbursables, options, exclusions),
  fee suggestions from 326 past Frame proposals, guardrails, internal review/approval, versions, a branded
  web proposal with online acceptance, a 3-page PDF, and per-engineer scope PDFs.
- **Sales** — pipeline (status, stage likelihood, weighted value, follow-up 1/2 with the sheet's 3- and 7-day
  rules), contacts & companies, past-client 1/2/6-month check-ins, prospects met, follow-up list, outreach
  (CRE firms, bagels, direct sales, biz-dev notes), daily lead measures and lag measures.
- **Projects** — the Job List and the job-cost template: nine phases, fee split, hours allowance from profit %
  and burden rate, hours assigned / worked / remaining, weekly hours log, consultants by phase with status,
  and the lifecycle Active → On hold / Phase complete → Closeout → Archived.
- **Flow** — Proposal → *Send to sales pipeline* (one click: client, contact, scope, design fee vs. subs, hours,
  first follow-up) → *Won — open project* (one click: Sold, job number in NN-NN form, phases and fees from the
  proposal, consultant fees spread by phase) → Closeout → Archived (the pipeline row becomes "Project
  Completed"). Every step is idempotent, linked both ways, and written to the audit trail shown on each record.

## CRM (HubSpot-style, built in)

`/crm` is the day-to-day sales screen, on Frame Hub's own database (no HubSpot):

- **Follow-ups** — tasks and reminders: title, due date + time, owner (a team member), type (call / email / meeting / to-do),
  priority, calendar reminder, linked deal / contact / company. Grouped Overdue · Today · This week · Later; check off, snooze
  (1 hour, tomorrow, 3 days, next Monday), edit, delete, or download a single `.ics`. "My follow-ups" for the signed-in person,
  or the whole team, one person, or unassigned. Log a call / email / note / meeting from the same screen, optionally with a follow-up task.
- **Proposals sent** (the deals) — every proposal that is out with a client, as stacked rows grouped by follow-up stage
  (Presented → Follow Up 1 → Follow Up 1 Completed → Follow Up 2 → Follow Up 2 Completed), with fee, client, sent date, days out and next
  follow-up. Collapsible stage headers show count, total and stage likelihood. Drag rows between stages on a desktop, or use **Move** on
  a phone; **Won** runs the existing Won → project flow (job number + lead), **Lost** keeps the record with an optional reason.
  Marking a proposal **Sent** in Proposals creates or updates its deal row and a follow-up task (3-day rule) for whoever sent it.
- **Leads** — Proposal Needed / Consultant Outreach / Internal Review, same rows.
- **Records** — every deal (`/sales/<id>`), contact (`/crm/contacts/<id>`) and company (`/crm/companies/<id>`) has its tasks and an
  activity timeline: notes, calls, emails (logged by hand), meetings, task events and stage changes, each with author and time.
  Authors can edit or delete their own entries; stage changes are read-only. A company's timeline includes its contacts' and deals'.
- **Team** — Settings → Team lists who tasks can be assigned to (seeded from the Job List: Jeff, Bella, June, Roy, Troy, Brandon,
  Jaden, Emily, Mathew). The first name someone signs in with maps them to their team entry.

### Calendar

`lib/calendar` is the one interface (`CalendarSync`) tasks go through. Today it's a **subscribable iCalendar feed per person**:
Settings → Your calendar → *Create link*, then *Add to Outlook / Google / Apple* (step-by-step instructions are on the page).

- URL: `/api/cal/<token>.ics` — the token is 256 random bits. The database keeps only its SHA-256 (lookup) and an AES-GCM-encrypted
  copy keyed from `SESSION_SECRET` (so Settings can show the link again). *Make a new link* revokes the old one at once; *Turn off* removes it.
- The sign-in gate lets through only paths of exactly that shape; anything else under `/api/cal` gets the usual 401, and an unknown,
  revoked or inactive person's token gets a bare 404 — nothing else is revealed.
- The feed holds that person's open tasks with a due date (optionally unassigned ones too), from 60 days back; done tasks drop out.
  Timed tasks are UTC events with a `VALARM` reminder; undated-time tasks are all-day. Each event keeps a stable UID and a SEQUENCE that
  bumps on every change, so calendars update instead of duplicating.
- Refresh is up to the calendar app: Apple as often as set, Outlook every few hours (can be up to a day), Google up to a day. Each task
  also has an **Add to calendar** button (single-event `.ics`) for something due soon.
- Microsoft Graph (push events straight into Outlook) slots in later as another `CalendarSync` — see `GraphCalendarSync` in
  `lib/calendar/index.ts` — once Entra sign-in exists.

## Run it locally (no accounts needed)

```bash
npm install
npm run db:migrate          # creates a local Postgres (PGlite) database in .data/pglite
npm run import              # loads Frame's real data from ./data (see below)
npm run dev                 # http://localhost:3000
```

Locally you're signed in as a stand-in user (`DEV_USER_EMAIL`, default jframe@framearchitecture.com).
Stop `npm run dev` before running `npm run import` (the local database is a single-process file).

### Real data — kept out of git

Put the source files in `./data/` (the whole folder is git-ignored, as are `*.xlsx`, `*.xlsm`, `*.csv` and `.data/`):

| File | What it is |
|---|---|
| `data/sales.xlsm` | Tracking Sales Sheet |
| `data/jobs.xlsm` | Job List (Job List sheet + one job-cost sheet per job) |
| `data/quotes.csv` | first quoting tool — Supabase `quotes` table export |
| `data/archive_index.csv` | first quoting tool — Supabase `archive_index` export (past proposals) |

`npm run import` reads whatever is there (`--only sales,jobs,quotes,archive`, `--dir path`). It is idempotent:
rows are matched on stable keys (pipeline row key, job number, day, old-tool id) and updated in place; each job's
hours log is replaced from its sheet. It prints, and writes to `data/import-report.json`, what was read / added /
updated / skipped and everything ambiguous (typos in dates, statuses not on the dropdown, sheets missing from the
Job List, …). It also cross-checks the app's pipeline math against the sheet's own cached totals. The job
workbook is large; expect ~1.5 minutes.

## Checks

```bash
npm run typecheck
npm test                    # 90 tests: every sheet formula, the fee logic, importers, and the full flow on a real Postgres (PGlite)
npm run build
```

## Where the spreadsheet math lives

All formulas are pure functions in `lib/calc/` with the sheet cell references in comments, and tests in `tests/`.

| Sheet | Formula | App |
|---|---|---|
| Pipeline Tracking | `AB = Z + AA` (Total Bid = Subs + Design Fee) | `totalBid` |
| | macro `UpdateStageValue`: bid goes to the column for its status (AD Proposal Needed, AE Consultant Outreach, AF Internal Review, AG Presented/Follow-ups, AI Rejected, AJ Sold) | `stageBucket` |
| | row 3 stage likelihood 50 / 100 / 70 / 60 % (editable in Settings) | `DEFAULT_STAGE_LIKELIHOOD` |
| | row 4 `AD4 = AD3*AE3*AF3*AG3` … (21 / 42 / 42 / 60 %) | `overallLikelihoods` |
| | rows 5–6 and `AH6 = SUM(AD6:AG6)` weighted pipeline; `AI6`, `AJ6`, `AB1` | `pipelineSummary` |
| | macro `SortByStatus` (AZ) | `statusSortOrder` |
| | macro `UpdateRowFormatting`: Presented → Follow Up 1 after 3 days, FU1 Completed → Follow Up 2 after 7; red rows, black after FU2 + 7 days | `autoAdvance`, `followUpAlert`, `nextFollowUpDue` |
| Lead Measures | row 4 sums and `IFERROR(next/this,"")` conversions | `leadTotals`, `leadTrend` |
| Lag Measures | `COUNTIF(C,"<>")`, `COUNTIF(D,"Won")`, `COUNTIF(D,"Lost")`, `N1 = H1/(H1+K1)` | `lagTotals` |
| Past Clients / Prospects Met | 1 / 2 / 6-month follow-ups; LinkedIn, card, email one month after meeting | `pastClientCadence`, `prospectCadence` |
| Job Cost Template | `C11 = $B$10*C12`, `B11`, `B28 = SUM(B10,B13:B26)`, `L28` phase fee, `N10 = SUM(log)`, `O10 = M10-N10`, `B30`, `E31 = B10*(1-E30)`, `E32 = B10-E31`, `E34 = ROUNDDOWN(E32/E33,0)` | `computeJobCost` and helpers |
| Job List macros | `GetConsultantStatus`, `GetPhaseNotes`, `GetSelectedPhase`, `ApplyJobListConditionalFormatting` (target yellow ≤ 7 days, red when due; hours red ≤ 10 %) | `consultantStatusSummary`, `latestNote`, `detectCurrentPhase`, `jobListFlags` |
| Old quoting tool | `computeSuggested`, `computeLive` guardrails (arch ≥ 55 % of gross; ≥ 4.5 %, target 5 % of construction), `/api/suggest-fee` precedent median, phase split 15/20/40/5/20 | `lib/calc/proposal.ts` |

Spreadsheet quirks the app does **not** copy (on purpose): the sheet's SUM ranges start at row 9 and some stop at
row 38/52/366, so a few rows are left out of its totals; `B12` repeats `B11` instead of summing the percentages.

## Data & security

- **Database**: Postgres. `supabase/migrations/*.sql` are plain SQL and run unchanged on Supabase and locally.
  Every table has row-level security (`0002_rls.sql`): only active app users (matched by their sign-in email in
  `app_users`) can read; owners/admins/staff can write; viewers read only; settings and users are admin-only; the
  audit log is append-only. The server talks to Postgres directly (`DATABASE_URL`); nothing in the browser
  touches the database. Client proposal links (`/p/<token>`) are served by the server, by an unguessable token,
  only once a proposal is approved.
- **Sign-in**: behind one interface, `lib/auth`. In production (`AUTH_PROVIDER=password`) it's a shared-password
  gate (see Sign-in below); `middleware.ts` checks the signed cookie on every page and API request (pages redirect to
  `/signin`, APIs return 401) and the layout, API routes and server actions check again. Locally the stand-in user is
  used (`AUTH_PROVIDER=dev`); production refuses it unless `ALLOW_DEV_AUTH=1`. Microsoft Entra ID comes later.
- **QuickBooks**: a seam only (`lib/integrations/quickbooks.ts`) — the customer / job / invoice mapping is written
  and tested; the API client is not built yet.
- **AI**: "Polish with Claude" runs on the server only when `ANTHROPIC_API_KEY` is set (`ANTHROPIC_MODEL`
  optional).

## Hosting

- **Vercel** project `frame-hub` (production branch `main`).
- **Database**: Frame Hub lives in its own Postgres schema, `hub`, inside Frame's existing Supabase project, owned by a
  dedicated login role `hub_app` whose `search_path` is `hub`. That role can't read the old quoting tool's `public`
  tables, and `hub` is not exposed to the Supabase REST API — only the server reaches it, through the transaction
  pooler (`DATABASE_URL=postgresql://hub_app.<project-ref>:…@aws-0-<region>.pooler.supabase.com:6543/postgres`).
- Migrations and the importer run from a laptop against that URL:
  `DATABASE_URL=… APP_USERS="email:Name:owner,…" npm run db:migrate`, then `DATABASE_URL=… npm run import`.
- Environment variables (Vercel): `DATABASE_URL` (sensitive), `AUTH_PROVIDER=password`, `SITE_PASSWORD` (sensitive),
  `SESSION_SECRET` (sensitive, 32+ random characters), optionally `ANTHROPIC_API_KEY`, `PDF_ACCENT`, `PDF_INK`.

## Sign-in

For now Frame Hub sits behind a simple gate: first name + one shared password (`SITE_PASSWORD`, set only in Vercel,
never in the repo). A good password sets an HttpOnly, Secure, signed cookie (`SESSION_SECRET`) for 30 days; the
first name labels changes in the activity log. Wrong passwords are rate limited (5 per address and 30 overall per
15 minutes, table `login_attempts`). Middleware keeps every page and API behind it; only `/signin`, the
token-protected client proposal links (`/p/<token>`) and calendar feeds (`/api/cal/<token>.ics`) are public. Changing `SITE_PASSWORD` or `SESSION_SECRET`
signs everyone out. Sign-in is behind the `AuthProvider` interface in `lib/auth/index.ts`, so Microsoft Entra ID
replaces the gate later without touching any page.

## Look & feel

All colours, fonts, radii and spacing are CSS variables. `styles/theme.css` is **one line** that picks the theme:
`themes/neutral.css` (default) or one of the three design directions (`option-1.css` Drafting Table,
`option-2.css` Studio Dark, `option-3.css` Bright Ops). Nothing else in the app hard-codes a colour. The PDF uses
`PDF_ACCENT` / `PDF_INK`. The layout is responsive; on a phone the sidebar becomes a bottom tab bar.

## Layout

```
app/                 pages (dashboard, proposals, sales, projects, settings, client view /p/[token]) and server actions
components/          shell, charts (plain SVG), proposal document
lib/calc/            every formula (pure)
lib/repo/            database access; lib/flow.ts the conversions; lib/import/ the importers
lib/db/              Postgres (Supabase) or PGlite behind one interface; migrations runner
lib/pdf/             proposal + engineer-scope PDFs (@react-pdf/renderer)
supabase/            migrations, RLS, local shim
scripts/             migrate, import
tests/               vitest
```
