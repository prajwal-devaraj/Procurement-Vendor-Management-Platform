# Procurement & Vendor Management Platform

A full-stack procurement system I built to understand how ERP-style business workflows actually get implemented - vendor onboarding, multi-stage purchase approvals, PO generation, invoice matching, payment tracking, and a real-time analytics dashboard.

The backend is Node.js/Express with SQLite (via sql.js). The frontend is a vanilla JS SPA served as static files - no React, no bundler, just modules and fetch. Docker + GitHub Actions CI included.

---

## Why I built this

I wanted a project that went deeper than a CRUD app but was still something I could fully explain in an interview. Procurement has a real workflow with real business rules — approvals have to happen in the right order, invoices have to match POs within a tolerance, payments track against due dates. Building that forced me to think about state machines, RBAC, audit trails, and data integrity in ways that a simple todo list never would.

I also wanted to understand SAP-style enterprise systems without actually needing SAP. The OData-adjacent REST API, the CDS-like schema, and the approval workflow are all patterns you'd find in SAP CAP projects but implemented in plain Node so you can actually read and run them locally in under a minute.

---

## Stack

| | |
|---|---|
| Runtime | Node.js 22 |
| Framework | Express |
| Database | SQLite via sql.js (WASM — no native build needed) |
| Auth | JWT (HS256) + bcrypt |
| PDF export | PDFKit |
| Testing | Jest + Supertest |
| DevOps | Docker (multi-stage), GitHub Actions |
| Frontend | Vanilla JS SPA, no build step |

**Why sql.js instead of better-sqlite3?** better-sqlite3 is faster but requires native compilation which breaks in CI without the right system dependencies. sql.js is pure WASM — it works everywhere, and for a procurement system the performance difference doesn't matter.

---

## Features

**Vendor management** — create vendors, set categories, track contact info and tax IDs, approve/block/reject with status workflow, rate vendors (averaged), risk scoring.

**Purchase request workflow** — employees create itemized requests, submit them for approval, and the system routes them through Manager → Finance approval stages. Every approval is logged with the approver and comment. Rejected requests notify the requester.

**Purchase order generation** — procurement admins convert Finance-approved requests into POs assigned to active vendors. Line items carry over with final unit prices. Status tracks through the delivery lifecycle.

**Invoice matching** — vendors submit invoices against POs. The system auto-matches within a 2% tolerance and flags mismatches with a specific reason string. Finance approves or rejects.

**Payment tracking** — payments are auto-created when Finance approves an invoice, with a 30-day default due date. Overdue detection runs on every list call. Finance marks payments as paid with method and reference.

**Analytics dashboard** — KPI cards, monthly spend chart, top vendors by spend, invoice mismatch rate, approval bottleneck analysis, vendor category breakdown.

**Audit log** — every create/update/approve/reject action is logged with user, entity, and details. Only admins can read it.

**Role-based access control** — 6 roles: Employee, Manager, Finance, ProcurementAdmin, Vendor, SystemAdmin. Each route enforces who can do what.

---

## Getting started

```bash
git clone https://github.com/prajwal-devaraj/Procurement-Vendor-Management-Platform.git
cd Procurement-Vendor-Management-Platform

npm install
cp .env.example .env    # set JWT_SECRET to something real before deploying

npm run seed            # creates 6 demo users + 6 vendors
npm start               # http://localhost:4000
```

**Demo logins** (password: `demo1234`):

| Email | Role |
|---|---|
| admin@demo.com | System Admin |
| procurement@demo.com | Procurement Admin |
| manager@demo.com | Manager |
| finance@demo.com | Finance |
| employee@demo.com | Employee |
| vendor@demo.com | Vendor |

Try the full flow: log in as `employee@demo.com`, create a purchase request, then log in as `manager@demo.com` to approve it, then `finance@demo.com` to approve it again, then `procurement@demo.com` to generate the PO and submit an invoice, then back to `finance@demo.com` to approve the invoice and mark the payment.

---

## Running tests

```bash
npm test
```

83 tests across 3 suites — auth, the full workflow end-to-end, and a comprehensive integration test for every endpoint. Each suite spins up its own isolated SQLite instance so they can run in parallel without colliding.

---

## Docker

```bash
docker compose up --build
```

The Dockerfile is multi-stage: it installs deps, runs tests, then builds a smaller production image. If tests fail, the build fails. The production image has only prod dependencies and no test code.

---

## API

See [docs/api-documentation.md](docs/api-documentation.md) for the full endpoint reference.

Quick overview:

```
POST   /api/auth/register
POST   /api/auth/login

GET/POST    /api/vendors
PATCH       /api/vendors/:id/status
POST        /api/vendors/:id/ratings

GET/POST                        /api/purchaseRequests
PATCH                           /api/purchaseRequests/:id/submit
POST                            /api/purchaseRequests/:id/approve
POST                            /api/purchaseRequests/:id/reject

GET/POST                        /api/purchaseOrders
PATCH                           /api/purchaseOrders/:id/status
GET                             /api/purchaseOrders/:id/pdf

GET/POST                        /api/invoices
PATCH                           /api/invoices/:id/approve
PATCH                           /api/invoices/:id/reject

GET                             /api/payments
PATCH                           /api/payments/:id/pay

GET   /api/analytics/summary
GET   /api/analytics/vendor-performance
GET   /api/analytics/monthly-spend
GET   /api/analytics/invoice-mismatch-rate
GET   /api/analytics/approval-bottlenecks

GET   /api/auditLogs
GET   /api/health
```

---

## Project structure

```
├── index.js                    entry point
├── db/
│   ├── connection.js           sql.js wrapper (run/get/all + disk persistence)
│   ├── schema.sql              12 tables
│   └── seed.js                 demo data
├── srv/
│   ├── app.js                  Express app factory (accepts db for testing)
│   ├── middleware/auth.js      JWT + RBAC
│   ├── routes/                 one file per resource
│   └── utils.js                id gen, audit, notify, asyncHandler
├── public/
│   ├── index.html              SPA shell
│   ├── css/styles.css
│   └── js/
│       ├── api.js              fetch wrapper
│       ├── app.js              state, auth, routing
│       └── views/              one file per view
├── test/
│   ├── setupApp.js             test helper (isolated db per suite)
│   ├── auth.test.js
│   ├── workflow.test.js
│   └── procurement.test.js
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/ci.yml
```

---


Prajwal Devaraj 

[github.com/prajwal-devaraj](https://github.com/prajwal-devaraj) 

[linkedin.com/in/prajwaldevaraj](https://linkedin.com/in/prajwaldevaraj) 

[prajwal-devaraj.github.io/PrajwalDevaraj_Portfolio](https://prajwal-devaraj.github.io/PrajwalDevaraj_Portfolio)
