-- Procurement & Vendor Management Platform — schema
-- SQLite with foreign keys on. Keep it simple but model the real workflow.

PRAGMA foreign_keys = ON;

-- Users and roles. I went with a single role per user for simplicity —
-- in a real enterprise system you'd want a many-to-many roles table but
-- this covers the 6 roles I needed without over-engineering it.
CREATE TABLE IF NOT EXISTS Users (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    passwordHash  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('Employee','Manager','Finance','ProcurementAdmin','Vendor','SystemAdmin')),
    department    TEXT,
    isActive      INTEGER NOT NULL DEFAULT 1,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vendors. Risk score starts at 50 (neutral). Rating is averaged from
-- VendorRatings and updated on every new rating submission.
CREATE TABLE IF NOT EXISTS Vendors (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    contactEmail    TEXT NOT NULL,
    phone           TEXT,
    country         TEXT,
    taxId           TEXT,
    status          TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Active','Pending','Rejected','Blocked')),
    riskScore       REAL NOT NULL DEFAULT 50,
    rating          REAL NOT NULL DEFAULT 0,
    createdAt       TEXT NOT NULL DEFAULT (datetime('now')),
    createdBy       TEXT REFERENCES Users(id)
);

CREATE TABLE IF NOT EXISTS VendorRatings (
    id          TEXT PRIMARY KEY,
    vendorId    TEXT NOT NULL REFERENCES Vendors(id) ON DELETE CASCADE,
    raterUserId TEXT REFERENCES Users(id),
    score       REAL NOT NULL CHECK (score BETWEEN 0 AND 5),
    comment     TEXT,
    createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Purchase requests with items. totalEstimatedCost is denormalized here
-- so I don't have to SUM() on every list query.
CREATE TABLE IF NOT EXISTS PurchaseRequests (
    id                  TEXT PRIMARY KEY,
    requestNumber       TEXT NOT NULL UNIQUE,
    requesterId         TEXT NOT NULL REFERENCES Users(id),
    department          TEXT NOT NULL,
    justification       TEXT,
    status              TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN (
                            'Draft','Submitted','ManagerApproved','FinanceApproved',
                            'Rejected','ConvertedToPO'
                        )),
    totalEstimatedCost  REAL NOT NULL DEFAULT 0,
    createdAt           TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS PurchaseRequestItems (
    id              TEXT PRIMARY KEY,
    requestId       TEXT NOT NULL REFERENCES PurchaseRequests(id) ON DELETE CASCADE,
    itemName        TEXT NOT NULL,
    quantity        REAL NOT NULL,
    estimatedCost   REAL NOT NULL,
    notes           TEXT
);

-- Generic approval log. I made this entity-agnostic so it covers both
-- purchase request approvals and invoice approvals from the same table.
-- stage is a string like 'ManagerReview' or 'FinanceReview' rather than
-- an enum so it's easy to extend.
CREATE TABLE IF NOT EXISTS Approvals (
    id            TEXT PRIMARY KEY,
    entityType    TEXT NOT NULL CHECK (entityType IN ('PurchaseRequest','Invoice')),
    entityId      TEXT NOT NULL,
    stage         TEXT NOT NULL,
    approverId    TEXT REFERENCES Users(id),
    decision      TEXT NOT NULL DEFAULT 'Pending' CHECK (decision IN ('Pending','Approved','Rejected')),
    comment       TEXT,
    decidedAt     TEXT,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS PurchaseOrders (
    id            TEXT PRIMARY KEY,
    poNumber      TEXT NOT NULL UNIQUE,
    requestId     TEXT REFERENCES PurchaseRequests(id),
    vendorId      TEXT NOT NULL REFERENCES Vendors(id),
    status        TEXT NOT NULL DEFAULT 'Created' CHECK (status IN (
                      'Created','SentToVendor','Acknowledged',
                      'PartiallyDelivered','Completed','Cancelled'
                  )),
    totalAmount   REAL NOT NULL DEFAULT 0,
    createdBy     TEXT REFERENCES Users(id),
    createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS PurchaseOrderItems (
    id            TEXT PRIMARY KEY,
    poId          TEXT NOT NULL REFERENCES PurchaseOrders(id) ON DELETE CASCADE,
    itemName      TEXT NOT NULL,
    quantity      REAL NOT NULL,
    unitPrice     REAL NOT NULL,
    lineTotal     REAL NOT NULL
);

-- Invoices. The matching logic (2% tolerance) lives in the route handler,
-- not here. mismatchReason stores the human-readable explanation when
-- MismatchFound is set.
CREATE TABLE IF NOT EXISTS Invoices (
    id              TEXT PRIMARY KEY,
    invoiceNumber   TEXT NOT NULL UNIQUE,
    poId            TEXT NOT NULL REFERENCES PurchaseOrders(id),
    vendorId        TEXT NOT NULL REFERENCES Vendors(id),
    amount          REAL NOT NULL,
    taxAmount       REAL NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'Received' CHECK (status IN (
                        'Received','Matched','MismatchFound',
                        'Approved','Paid','Rejected'
                    )),
    mismatchReason  TEXT,
    receivedAt      TEXT NOT NULL DEFAULT (datetime('now')),
    dueDate         TEXT
);

-- Payments get auto-created when Finance approves an invoice.
-- paymentStatus gets refreshed to Overdue in the list endpoint if
-- dueDate has passed.
CREATE TABLE IF NOT EXISTS Payments (
    id                   TEXT PRIMARY KEY,
    invoiceId            TEXT NOT NULL REFERENCES Invoices(id),
    vendorId             TEXT NOT NULL REFERENCES Vendors(id),
    amount               REAL NOT NULL,
    dueDate              TEXT NOT NULL,
    paymentStatus        TEXT NOT NULL DEFAULT 'Unpaid' CHECK (paymentStatus IN ('Unpaid','Paid','Overdue')),
    paymentMethod        TEXT,
    transactionReference TEXT,
    paidAt               TEXT
);

CREATE TABLE IF NOT EXISTS AuditLogs (
    id          TEXT PRIMARY KEY,
    userId      TEXT REFERENCES Users(id),
    action      TEXT NOT NULL,
    entityType  TEXT NOT NULL,
    entityId    TEXT NOT NULL,
    details     TEXT,
    createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Notifications (
    id          TEXT PRIMARY KEY,
    userId      TEXT NOT NULL REFERENCES Users(id),
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    isRead      INTEGER NOT NULL DEFAULT 0,
    createdAt   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pr_status    ON PurchaseRequests(status);
CREATE INDEX IF NOT EXISTS idx_po_status    ON PurchaseOrders(status);
CREATE INDEX IF NOT EXISTS idx_inv_status   ON Invoices(status);
CREATE INDEX IF NOT EXISTS idx_pay_status   ON Payments(paymentStatus);
CREATE INDEX IF NOT EXISTS idx_vendor_status ON Vendors(status);
