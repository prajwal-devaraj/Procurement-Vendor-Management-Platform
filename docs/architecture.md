# Architecture

## Overview

The platform is a single Express.js application that serves both a REST
JSON API (under `/api`) and a static, vanilla-JS single-page dashboard
(everything else). There is no separate frontend build step — the
dashboard is plain HTML/CSS/JS served directly by Express, which keeps
the whole project runnable with nothing but `npm install && npm start`.

```
Browser (dashboard SPA)
        │  fetch() with Authorization: Bearer <JWT>
        ▼
Express app (srv/app.js)
  ├── /api/auth          register, login
  ├── /api/vendors        vendor CRUD, approval, ratings
  ├── /api/purchaseRequests   PR creation, submit, approval chain
  ├── /api/purchaseOrders     PO generation, status, PDF export
  ├── /api/invoices       invoice intake, PO matching, approval
  ├── /api/payments       payment tracking, marking paid
  ├── /api/analytics      dashboard summary + chart data
  └── /api/auditLogs, /api/notifications, /api/users, /api/me
        │
        ▼
SQLite (via sql.js, WASM — no native build step)
  db/schema.sql defines 12 tables; db/connection.js is a thin
  synchronous wrapper that persists to disk after every write.
```

## Why sql.js instead of better-sqlite3

The original brief called for PostgreSQL in production and SQLite for
local development. `better-sqlite3` (the typical Node SQLite driver)
requires compiling a native addon via `node-gyp`, which depends on
network access to `nodejs.org` for header downloads. In sandboxed or
restricted-network environments that download fails, so this project
uses `sql.js` — a WebAssembly build of SQLite that runs anywhere Node
runs, with zero native compilation. The trade-off is that every write
re-serializes the whole database to disk; that's fine for a
demo/portfolio-scale dataset, but a real production deployment should
swap in PostgreSQL (the schema in `db/schema.sql` is close to portable
ANSI SQL — the main things to adjust are the `datetime('now')` defaults
and `julianday()` calls used in analytics, which are SQLite-specific).

## Request lifecycle

1. **Auth** — `POST /api/auth/register` or `/login` issues a JWT
   (HS256, 8h expiry) containing `{ id, email, role, name }`.
2. **Every other `/api/*` route** is behind `authenticate` middleware,
   which verifies the JWT and attaches the payload to `req.user`.
3. **Role-gated routes** additionally use `authorize(...roles)`, which
   403s if `req.user.role` isn't in the allowed list.
4. **Mutations** go through route handlers that validate input, run
   the SQL, write an `AuditLogs` row, and (where relevant) a
   `Notifications` row for the affected user.

## The approval chain

A Purchase Request moves through a linear state machine:

```
Draft → Submitted → ManagerApproved → FinanceApproved → ConvertedToPO
                  ↘ Rejected (from Submitted or ManagerApproved)
```

Each transition is logged as a row in `Approvals` (`stage`,
`approverId`, `decision`, `comment`, timestamps), which is what powers
both the audit trail and the "approval bottlenecks" analytics query
(average time a stage sits in `Pending`).

## Invoice-to-PO matching

When an invoice is submitted, its `amount + taxAmount` is compared
against the referenced PO's `totalAmount` with a 2% tolerance band. A
match sets status `Matched`; a larger discrepancy sets
`MismatchFound` with a human-readable `mismatchReason` string. Finance
can approve either status, which auto-creates a `Payments` row due 30
days out (or on the invoice's stated due date).

## Frontend structure

`public/js/app.js` holds shared state (`State`), auth flow, toast/modal
helpers, and the view router (`VIEW_RENDERERS`, populated by each
`public/js/views/*.js` file). There's no framework or bundler — each
view module attaches a render function to `VIEW_RENDERERS[viewName]`
and the router calls it with the container element to fill in.

## Known limitations (by design, for a portfolio-scope project)

- Single SQLite file, no connection pooling or read replicas.
- No email delivery for notifications — they're stored in-app only
  (`Notifications` table) rather than sent.
- Rate limiting is a flat global limiter, not per-user.
- No refresh-token rotation; JWTs simply expire after 8 hours.
