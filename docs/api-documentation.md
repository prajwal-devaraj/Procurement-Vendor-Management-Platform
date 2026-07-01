# API Reference

Base URL: `http://localhost:4000/api`

Protected endpoints require: `Authorization: Bearer <token>`

---

## Auth

### POST /auth/register
```json
{
  "name": "Eddie Employee",
  "email": "eddie@company.com",
  "password": "securepass",
  "role": "Employee",
  "department": "Engineering"
}
```
Roles: `Employee` | `Manager` | `Finance` | `ProcurementAdmin` | `Vendor` | `SystemAdmin`

Returns `{ token, user }`. 409 if email already registered.

### POST /auth/login
```json
{ "email": "...", "password": "..." }
```
Returns `{ token, user }`. 401 on bad credentials.

### GET /me
Returns the decoded JWT payload for the current user.

---

## Vendors

All vendor endpoints require auth. Create/edit require ProcurementAdmin or SystemAdmin.

```
GET    /vendors                 ?status= &category= &search=
POST   /vendors                 { name, category, contactEmail, phone?, country?, taxId? }
GET    /vendors/:id             returns vendor + ratings[]
PATCH  /vendors/:id             update any of: name, category, contactEmail, phone, country, taxId, riskScore
PATCH  /vendors/:id/status      { status: 'Active'|'Pending'|'Rejected'|'Blocked' }
POST   /vendors/:id/ratings     { score: 0-5, comment? }   → recalculates average
DELETE /vendors/:id             [SystemAdmin only]
```

New vendors default to `Pending`. They must be `Active` before you can generate a PO to them.

---

## Purchase Requests

```
GET    /purchaseRequests                ?status= &requesterId= &department=
POST   /purchaseRequests                { department, justification?, items: [{itemName, quantity, estimatedCost}] }
GET    /purchaseRequests/:id            returns request + items[] + approvals[]
PATCH  /purchaseRequests/:id/submit     Draft → Submitted (opens ManagerReview)
POST   /purchaseRequests/:id/approve    [Manager at Submitted; Finance at ManagerApproved]
POST   /purchaseRequests/:id/reject     [Manager, Finance, SystemAdmin] — { comment? }
```

Approval chain:
```
Draft → Submitted → ManagerApproved → FinanceApproved → ConvertedToPO
```

---

## Purchase Orders

```
GET    /purchaseOrders              ?status= &vendorId=
POST   /purchaseOrders              { requestId, vendorId }  — request must be FinanceApproved, vendor must be Active
GET    /purchaseOrders/:id          returns PO + items[] + vendor
PATCH  /purchaseOrders/:id/status   { status }
GET    /purchaseOrders/:id/pdf      streams PDF
```

Status flow: `Created → SentToVendor → Acknowledged → PartiallyDelivered → Completed`

---

## Invoices

```
GET    /invoices                    ?status= &vendorId= &poId=
POST   /invoices                    { poId, amount, taxAmount?, dueDate? }
GET    /invoices/:id
PATCH  /invoices/:id/approve        [Finance, SystemAdmin] → creates Payment record automatically
PATCH  /invoices/:id/reject         [Finance, SystemAdmin]
```

When an invoice is submitted, the system compares `amount + taxAmount` to the PO total.
Within 2% → `Matched`. Beyond 2% → `MismatchFound` with a reason string in `mismatchReason`.

---

## Payments

```
GET    /payments                    ?status= &vendorId=
GET    /payments/:id
PATCH  /payments/:id/pay            [Finance, SystemAdmin] { paymentMethod?, transactionReference? }
```

Payments are created automatically when Finance approves an invoice. Status can be `Unpaid`, `Overdue`, or `Paid`. Overdue detection runs on every list call.

---

## Analytics

```
GET    /analytics/summary                   dashboard KPIs
GET    /analytics/vendor-performance        per-vendor spend + ratings
GET    /analytics/monthly-spend             monthly PO totals
GET    /analytics/category-distribution     vendor counts by category
GET    /analytics/invoice-mismatch-rate     mismatch rate across all invoices
GET    /analytics/approval-bottlenecks      pending stages + avg wait time
```

---

## Misc

```
GET    /auditLogs               [ProcurementAdmin, SystemAdmin] ?entityType= &entityId= &limit=
GET    /notifications           current user's notifications
PATCH  /notifications/:id/read  mark as read
GET    /users                   [ProcurementAdmin, SystemAdmin]
GET    /health                  public health check
```

---

## Errors

All errors return `{ "error": "message" }` with the appropriate HTTP status:

| Status | Meaning |
|---|---|
| 400 | Bad request / missing field |
| 401 | Missing or invalid token |
| 403 | Authenticated but insufficient role |
| 404 | Not found |
| 409 | State conflict (wrong status, already paid, etc.) |
| 500 | Server error |
