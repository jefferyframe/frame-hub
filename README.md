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
npm test                    # 62 tests: every sheet formula, the fee logic, importers, and the full flow on a real Postgres (PGlite)
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
- **Sign-in**: behind one interface, `lib/auth`. In production (`AUTH_PROVIDER=supabase`) it's Supabase Auth email
  sign-in: a magic link or the 6-digit code from the same email, or a password if the account has one. Nobody is
  created by signing in: an email must be in `ALLOWED_EMAILS` **and** active in `app_users`, and already exist in
  Supabase Auth. `middleware.ts` verifies the session with Supabase on every page and API request (pages redirect to
  `/signin`, APIs return 401); the layout, API routes and server actions check `app_users` again. Public on purpose:
  `/signin`, `/auth/*`, and client proposal links `/p/<token>` (approved proposals only). Locally the stand-in
  user is used (`AUTH_PROVIDER=dev`); production refuses it unless `ALLOW_DEV_AUTH=1`. Microsoft 365 / Google
  can be added later as Supabase Auth providers.
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
- Environment variables (Vercel): `DATABASE_URL` (sensitive), `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable key),
  `AUTH_PROVIDER=supabase`, `ALLOWED_EMAILS`, optionally `APP_URL`, `ANTHROPIC_API_KEY`, `PDF_ACCENT`, `PDF_INK`.
- Supabase Auth → URL configuration must list `https://<app>/auth/callback**` as a redirect URL, and the
  "Magic link or OTP" email template should include `{{ .Token }}` so the code works on another device.
- Supabase's built-in mailer only delivers to members of the Supabase organization's team (and ~2 emails/hour).
  Add custom SMTP (Authentication → SMTP) before more people use email sign-in.

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
