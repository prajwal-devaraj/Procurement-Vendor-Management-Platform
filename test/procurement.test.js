// test/procurement.test.js
// Integration tests using Supertest + an in-memory sql.js database.
// Run with: npm test

const path = require('path');
const request = require('supertest');
const { buildTestApp } = require('./setupApp');

let app, db, teardown;
let adminToken, procToken, mgrToken, finToken, empToken;
let vendorId, prId, poId, invId, payId;

beforeAll(async () => {
    const t = await buildTestApp('procurement');
    app = t.app;
    db = t.db;
    teardown = t.teardown;
});

afterAll(() => teardown());

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

async function register(name, email, role, dept) {
    const res = await request(app).post('/api/auth/register').send({ name, email, password: 'test1234', role, department: dept });
    expect(res.status).toBe(201);
    return res.body.token;
}

// ─────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────

describe('Auth', () => {
    test('registers all role types', async () => {
        adminToken = await register('Admin', 'admin@t.com', 'SystemAdmin');
        procToken  = await register('Proc', 'proc@t.com', 'ProcurementAdmin');
        mgrToken   = await register('Mgr', 'mgr@t.com', 'Manager');
        finToken   = await register('Fin', 'fin@t.com', 'Finance');
        empToken   = await register('Emp', 'emp@t.com', 'Employee', 'Engineering');
        expect(adminToken).toBeTruthy();
    });

    test('login returns token', async () => {
        const res = await request(app).post('/api/auth/login').send({ email: 'admin@t.com', password: 'test1234' });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
        expect(res.body.user.role).toBe('SystemAdmin');
    });

    test('rejects wrong password with 401', async () => {
        const res = await request(app).post('/api/auth/login').send({ email: 'admin@t.com', password: 'wrong' });
        expect(res.status).toBe(401);
    });

    test('rejects duplicate email with 409', async () => {
        const res = await request(app).post('/api/auth/register').send({ name: 'X', email: 'admin@t.com', password: 'test1234', role: 'Employee' });
        expect(res.status).toBe(409);
    });

    test('protected route returns 401 without token', async () => {
        const res = await request(app).get('/api/vendors');
        expect(res.status).toBe(401);
    });

    test('protected route returns 401 with garbage token', async () => {
        const res = await request(app).get('/api/vendors').set('Authorization', 'Bearer garbage.abc.xyz');
        expect(res.status).toBe(401);
    });

    test('/api/me returns current user', async () => {
        const res = await request(app).get('/api/me').set('Authorization', `Bearer ${empToken}`);
        expect(res.status).toBe(200);
        expect(res.body.email).toBe('emp@t.com');
    });
});

// ─────────────────────────────────────────────────────────
// VENDORS
// ─────────────────────────────────────────────────────────

describe('Vendor Management', () => {
    test('ProcurementAdmin creates vendor', async () => {
        const res = await request(app).post('/api/vendors').set('Authorization', `Bearer ${procToken}`)
            .send({ name: 'Acme Supplies', category: 'IT Hardware', contactEmail: 'acme@test.com', country: 'USA' });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('Pending');
        vendorId = res.body.id;
    });

    test('Employee cannot create vendor (RBAC)', async () => {
        const res = await request(app).post('/api/vendors').set('Authorization', `Bearer ${empToken}`)
            .send({ name: 'X', category: 'IT Hardware', contactEmail: 'x@y.com' });
        expect(res.status).toBe(403);
    });

    test('list vendors returns seeded vendor', async () => {
        const res = await request(app).get('/api/vendors').set('Authorization', `Bearer ${empToken}`);
        expect(res.status).toBe(200);
        expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    test('filter vendors by status', async () => {
        const res = await request(app).get('/api/vendors?status=Pending').set('Authorization', `Bearer ${empToken}`);
        expect(res.status).toBe(200);
        expect(res.body.every(v => v.status === 'Pending')).toBe(true);
    });

    test('ProcurementAdmin approves vendor', async () => {
        const res = await request(app).patch(`/api/vendors/${vendorId}/status`).set('Authorization', `Bearer ${procToken}`)
            .send({ status: 'Active' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('Active');
    });

    test('get vendor by id returns ratings array', async () => {
        const res = await request(app).get(`/api/vendors/${vendorId}`).set('Authorization', `Bearer ${procToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.ratings)).toBe(true);
    });

    test('rate a vendor and updates average rating', async () => {
        await request(app).post(`/api/vendors/${vendorId}/ratings`)
            .set('Authorization', `Bearer ${procToken}`).send({ score: 4, comment: 'Good' });
        const res = await request(app).post(`/api/vendors/${vendorId}/ratings`)
            .set('Authorization', `Bearer ${procToken}`).send({ score: 3 });
        expect(res.status).toBe(201);
        expect(res.body.rating).toBeCloseTo(3.5, 1);
    });

    test('block vendor', async () => {
        const res = await request(app).patch(`/api/vendors/${vendorId}/status`).set('Authorization', `Bearer ${procToken}`)
            .send({ status: 'Blocked' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('Blocked');
    });

    test('re-activate vendor for PO creation later', async () => {
        const res = await request(app).patch(`/api/vendors/${vendorId}/status`).set('Authorization', `Bearer ${procToken}`)
            .send({ status: 'Active' });
        expect(res.status).toBe(200);
    });
});

// ─────────────────────────────────────────────────────────
// PURCHASE REQUESTS + APPROVAL WORKFLOW
// ─────────────────────────────────────────────────────────

describe('Purchase Request Workflow', () => {
    test('employee creates purchase request with line items', async () => {
        const res = await request(app).post('/api/purchaseRequests').set('Authorization', `Bearer ${empToken}`)
            .send({
                department: 'Engineering',
                justification: 'Annual hardware refresh',
                items: [
                    { itemName: 'Laptop', quantity: 5, estimatedCost: 1200 },
                    { itemName: 'Docking Station', quantity: 5, estimatedCost: 120 }
                ]
            });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('Draft');
        expect(res.body.totalEstimatedCost).toBe(6600);
        expect(res.body.items.length).toBe(2);
        prId = res.body.id;
    });

    test('empty items list is rejected', async () => {
        const res = await request(app).post('/api/purchaseRequests').set('Authorization', `Bearer ${empToken}`)
            .send({ department: 'Eng', items: [] });
        expect(res.status).toBe(400);
    });

    test('employee submits PR (Draft → Submitted)', async () => {
        const res = await request(app).patch(`/api/purchaseRequests/${prId}/submit`).set('Authorization', `Bearer ${empToken}`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('Submitted');
        expect(res.body.approvals.length).toBe(1);
        expect(res.body.approvals[0].decision).toBe('Pending');
    });

    test('cannot submit already-submitted PR', async () => {
        const res = await request(app).patch(`/api/purchaseRequests/${prId}/submit`).set('Authorization', `Bearer ${empToken}`);
        expect(res.status).toBe(409);
    });

    test('employee cannot approve (RBAC)', async () => {
        const res = await request(app).post(`/api/purchaseRequests/${prId}/approve`).set('Authorization', `Bearer ${empToken}`)
            .send({ comment: 'Sneaky' });
        expect(res.status).toBe(403);
    });

    test('Finance cannot approve at ManagerReview stage', async () => {
        const res = await request(app).post(`/api/purchaseRequests/${prId}/approve`).set('Authorization', `Bearer ${finToken}`);
        expect(res.status).toBe(409);
    });

    test('Manager approves (Submitted → ManagerApproved)', async () => {
        const res = await request(app).post(`/api/purchaseRequests/${prId}/approve`).set('Authorization', `Bearer ${mgrToken}`)
            .send({ comment: 'Budget available' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ManagerApproved');
    });

    test('Finance approves (ManagerApproved → FinanceApproved)', async () => {
        const res = await request(app).post(`/api/purchaseRequests/${prId}/approve`).set('Authorization', `Bearer ${finToken}`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('FinanceApproved');
    });

    test('filter PRs by status', async () => {
        const res = await request(app).get('/api/purchaseRequests?status=FinanceApproved').set('Authorization', `Bearer ${procToken}`);
        expect(res.status).toBe(200);
        expect(res.body.some(r => r.id === prId)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────
// PURCHASE ORDERS
// ─────────────────────────────────────────────────────────

describe('Purchase Orders', () => {
    test('generates PO from FinanceApproved request', async () => {
        const res = await request(app).post('/api/purchaseOrders').set('Authorization', `Bearer ${procToken}`)
            .send({ requestId: prId, vendorId });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('Created');
        expect(res.body.totalAmount).toBe(6600);
        expect(res.body.items.length).toBe(2);
        poId = res.body.id;
    });

    test('cannot generate PO from same request twice (now ConvertedToPO)', async () => {
        const res = await request(app).post('/api/purchaseOrders').set('Authorization', `Bearer ${procToken}`)
            .send({ requestId: prId, vendorId });
        expect(res.status).toBe(409);
    });

    test('cannot generate PO if vendor is not Active', async () => {
        // Create a pending vendor
        const v = await request(app).post('/api/vendors').set('Authorization', `Bearer ${procToken}`)
            .send({ name: 'Pending Co', category: 'Logistics', contactEmail: 'p@p.com' });
        const pendingVendorId = v.body.id;
        // Create a second approved request
        const pr2 = await request(app).post('/api/purchaseRequests').set('Authorization', `Bearer ${empToken}`)
            .send({ department: 'Ops', items: [{ itemName: 'Paper', quantity: 100, estimatedCost: 1 }] });
        await request(app).patch(`/api/purchaseRequests/${pr2.body.id}/submit`).set('Authorization', `Bearer ${empToken}`);
        await request(app).post(`/api/purchaseRequests/${pr2.body.id}/approve`).set('Authorization', `Bearer ${mgrToken}`);
        await request(app).post(`/api/purchaseRequests/${pr2.body.id}/approve`).set('Authorization', `Bearer ${finToken}`);
        const res = await request(app).post('/api/purchaseOrders').set('Authorization', `Bearer ${procToken}`)
            .send({ requestId: pr2.body.id, vendorId: pendingVendorId });
        expect(res.status).toBe(409);
    });

    test('PO status progression', async () => {
        const res = await request(app).patch(`/api/purchaseOrders/${poId}/status`).set('Authorization', `Bearer ${procToken}`)
            .send({ status: 'SentToVendor' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('SentToVendor');
    });

    test('PDF export returns valid PDF', async () => {
        const res = await request(app).get(`/api/purchaseOrders/${poId}/pdf`).set('Authorization', `Bearer ${procToken}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');
        // PDF magic bytes: %PDF-
        expect(res.body.toString().slice(0, 5) || Buffer.from(res.body).toString().slice(0, 5)).toContain('%PDF');
    });
});

// ─────────────────────────────────────────────────────────
// INVOICES
// ─────────────────────────────────────────────────────────

describe('Invoice Management', () => {
    test('submits invoice matched against PO (within 2% tolerance)', async () => {
        const res = await request(app).post('/api/invoices').set('Authorization', `Bearer ${procToken}`)
            .send({ poId, amount: 6600, taxAmount: 0 });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('Matched');
        invId = res.body.id;
    });

    test('submits invoice with large mismatch → MismatchFound', async () => {
        const res = await request(app).post('/api/invoices').set('Authorization', `Bearer ${procToken}`)
            .send({ poId, amount: 9999, taxAmount: 0 });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('MismatchFound');
        expect(res.body.mismatchReason).toBeTruthy();
    });

    test('Finance approves matched invoice (creates payment)', async () => {
        const res = await request(app).patch(`/api/invoices/${invId}/approve`).set('Authorization', `Bearer ${finToken}`);
        expect(res.status).toBe(200);
        expect(res.body.invoice.status).toBe('Approved');
        expect(res.body.payment).toBeTruthy();
        payId = res.body.payment.id;
    });

    test('cannot approve already-Approved invoice', async () => {
        const res = await request(app).patch(`/api/invoices/${invId}/approve`).set('Authorization', `Bearer ${finToken}`);
        expect(res.status).toBe(409);
    });

    test('Employee cannot approve invoice (RBAC)', async () => {
        const res = await request(app).patch(`/api/invoices/${invId}/approve`).set('Authorization', `Bearer ${empToken}`);
        expect(res.status).toBe(403);
    });
});

// ─────────────────────────────────────────────────────────
// PAYMENTS
// ─────────────────────────────────────────────────────────

describe('Payment Tracking', () => {
    test('lists payments', async () => {
        const res = await request(app).get('/api/payments').set('Authorization', `Bearer ${finToken}`);
        expect(res.status).toBe(200);
        expect(res.body.some(p => p.id === payId)).toBe(true);
    });

    test('Finance marks payment as paid', async () => {
        const res = await request(app).patch(`/api/payments/${payId}/pay`).set('Authorization', `Bearer ${finToken}`)
            .send({ paymentMethod: 'Wire Transfer', transactionReference: 'TXN-TEST-001' });
        expect(res.status).toBe(200);
        expect(res.body.paymentStatus).toBe('Paid');
        expect(res.body.paymentMethod).toBe('Wire Transfer');
    });

    test('double-payment blocked with 409', async () => {
        const res = await request(app).patch(`/api/payments/${payId}/pay`).set('Authorization', `Bearer ${finToken}`)
            .send({ paymentMethod: 'ACH' });
        expect(res.status).toBe(409);
    });

    test('Employee cannot mark payment paid (RBAC)', async () => {
        const res = await request(app).patch(`/api/payments/${payId}/pay`).set('Authorization', `Bearer ${empToken}`)
            .send({});
        expect(res.status).toBe(403);
    });
});

// ─────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────

describe('Analytics', () => {
    test('summary returns expected shape and real values', async () => {
        const res = await request(app).get('/api/analytics/summary').set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        const s = res.body;
        expect(s).toHaveProperty('totalVendors');
        expect(s).toHaveProperty('pendingApprovals');
        expect(s).toHaveProperty('totalProcurementSpend');
        expect(s.totalProcurementSpend).toBeGreaterThan(0);
        expect(s).toHaveProperty('openPurchaseOrders');
        expect(s).toHaveProperty('overdueInvoices');
        expect(s).toHaveProperty('topPerformingVendors');
        expect(Array.isArray(s.topPerformingVendors)).toBe(true);
    });

    test('vendor performance returns array', async () => {
        const res = await request(app).get('/api/analytics/vendor-performance').set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.some(v => v.totalSpend > 0)).toBe(true);
    });

    test('monthly spend returns array', async () => {
        const res = await request(app).get('/api/analytics/monthly-spend').set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
    });

    test('invoice mismatch rate', async () => {
        const res = await request(app).get('/api/analytics/invoice-mismatch-rate').set('Authorization', `Bearer ${finToken}`);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('mismatchRate');
        expect(res.body.totalInvoices).toBeGreaterThan(0);
    });

    test('approval bottlenecks', async () => {
        const res = await request(app).get('/api/analytics/approval-bottlenecks').set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('category distribution', async () => {
        const res = await request(app).get('/api/analytics/category-distribution').set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────
// AUDIT LOGS & NOTIFICATIONS
// ─────────────────────────────────────────────────────────

describe('Audit Logs & Notifications', () => {
    test('SystemAdmin can read audit logs', async () => {
        const res = await request(app).get('/api/auditLogs').set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
    });

    test('Employee cannot read audit logs (RBAC)', async () => {
        const res = await request(app).get('/api/auditLogs').set('Authorization', `Bearer ${empToken}`);
        expect(res.status).toBe(403);
    });

    test('notifications endpoint returns array', async () => {
        const res = await request(app).get('/api/notifications').set('Authorization', `Bearer ${empToken}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    test('users endpoint accessible by admin', async () => {
        const res = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken}`);
        expect(res.status).toBe(200);
        expect(res.body.some(u => u.email === 'emp@t.com')).toBe(true);
        // Password hashes must NOT be exposed
        expect(res.body.every(u => !u.passwordHash)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────
// PR REJECTION FLOW
// ─────────────────────────────────────────────────────────

describe('PR Rejection Flow', () => {
    test('manager can reject a submitted PR', async () => {
        const pr = await request(app).post('/api/purchaseRequests').set('Authorization', `Bearer ${empToken}`)
            .send({ department: 'Legal', items: [{ itemName: 'Legal Software', quantity: 1, estimatedCost: 5000 }] });
        const prId2 = pr.body.id;
        await request(app).patch(`/api/purchaseRequests/${prId2}/submit`).set('Authorization', `Bearer ${empToken}`);
        const res = await request(app).post(`/api/purchaseRequests/${prId2}/reject`).set('Authorization', `Bearer ${mgrToken}`)
            .send({ comment: 'Not in budget' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('Rejected');
    });
});
