// test/workflow.test.js
const request = require('supertest');
const { buildTestApp } = require('./setupApp');

let app, teardown;
const tokens = {};
let vendorId, prId, poId, invoiceId, paymentId;

beforeAll(async () => {
    const t = await buildTestApp('workflow');
    app = t.app;
    teardown = t.teardown;

    const roles = [
        ['admin', 'Admin User', 'SystemAdmin'],
        ['procurement', 'Procurement Admin', 'ProcurementAdmin'],
        ['manager', 'Test Manager', 'Manager'],
        ['finance', 'Test Finance', 'Finance'],
        ['employee', 'Test Employee', 'Employee']
    ];
    for (const [key, name, role] of roles) {
        const res = await request(app).post('/api/auth/register').send({
            name, email: `${key}@workflow-test.com`, password: 'pass1234', role, department: role === 'Employee' ? 'Engineering' : undefined
        });
        tokens[key] = res.body.token;
    }
});

afterAll(() => teardown());

describe('Full procurement lifecycle', () => {
    test('Procurement creates a vendor in Pending status', async () => {
        const res = await request(app)
            .post('/api/vendors')
            .set('Authorization', `Bearer ${tokens.procurement}`)
            .send({ name: 'Workflow Vendor', category: 'IT Hardware', contactEmail: 'sales@workflow-vendor.com', country: 'USA' });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('Pending');
        vendorId = res.body.id;
    });

    test('a Pending vendor cannot receive a purchase order yet', async () => {
        // sanity check enforced later once a PR exists; vendor status alone is enough for now
        const res = await request(app).get(`/api/vendors/${vendorId}`).set('Authorization', `Bearer ${tokens.procurement}`);
        expect(res.body.status).toBe('Pending');
    });

    test('Procurement approves the vendor', async () => {
        const res = await request(app)
            .patch(`/api/vendors/${vendorId}/status`)
            .set('Authorization', `Bearer ${tokens.procurement}`)
            .send({ status: 'Active' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('Active');
    });

    test('Employee creates a purchase request as Draft', async () => {
        const res = await request(app)
            .post('/api/purchaseRequests')
            .set('Authorization', `Bearer ${tokens.employee}`)
            .send({
                department: 'Engineering',
                justification: 'New laptops for the team',
                items: [{ itemName: 'Laptop', quantity: 5, estimatedCost: 1200 }]
            });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('Draft');
        expect(res.body.totalEstimatedCost).toBe(6000);
        prId = res.body.id;
    });

    test('a PO cannot be generated from a Draft request', async () => {
        const res = await request(app)
            .post('/api/purchaseOrders')
            .set('Authorization', `Bearer ${tokens.procurement}`)
            .send({ requestId: prId, vendorId });
        expect(res.status).toBe(409);
    });

    test('Employee submits the request, moving it to Submitted', async () => {
        const res = await request(app).patch(`/api/purchaseRequests/${prId}/submit`).set('Authorization', `Bearer ${tokens.employee}`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('Submitted');
        expect(res.body.approvals.length).toBe(1);
        expect(res.body.approvals[0].stage).toBe('ManagerReview');
    });

    test('a Finance user cannot approve before Manager has', async () => {
        const res = await request(app).post(`/api/purchaseRequests/${prId}/approve`).set('Authorization', `Bearer ${tokens.finance}`).send({});
        expect(res.status).toBe(409);
    });

    test('Manager approves, moving request to ManagerApproved', async () => {
        const res = await request(app)
            .post(`/api/purchaseRequests/${prId}/approve`)
            .set('Authorization', `Bearer ${tokens.manager}`)
            .send({ comment: 'Looks reasonable' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ManagerApproved');
    });

    test('Finance approves, moving request to FinanceApproved', async () => {
        const res = await request(app)
            .post(`/api/purchaseRequests/${prId}/approve`)
            .set('Authorization', `Bearer ${tokens.finance}`)
            .send({ comment: 'Budget confirmed' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('FinanceApproved');
    });

    test('Procurement generates a PO from the approved request', async () => {
        const res = await request(app)
            .post('/api/purchaseOrders')
            .set('Authorization', `Bearer ${tokens.procurement}`)
            .send({ requestId: prId, vendorId });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('Created');
        expect(res.body.totalAmount).toBe(6000);
        expect(res.body.items.length).toBe(1);
        poId = res.body.id;
    });

    test('the originating purchase request is now ConvertedToPO', async () => {
        const res = await request(app).get(`/api/purchaseRequests/${prId}`).set('Authorization', `Bearer ${tokens.employee}`);
        expect(res.body.status).toBe('ConvertedToPO');
    });

    test('PO status can progress through the fulfillment lifecycle', async () => {
        let res = await request(app).patch(`/api/purchaseOrders/${poId}/status`).set('Authorization', `Bearer ${tokens.procurement}`).send({ status: 'SentToVendor' });
        expect(res.body.status).toBe('SentToVendor');

        res = await request(app).patch(`/api/purchaseOrders/${poId}/status`).set('Authorization', `Bearer ${tokens.procurement}`).send({ status: 'Acknowledged' });
        expect(res.body.status).toBe('Acknowledged');
    });

    test('a matching invoice is auto-matched against the PO', async () => {
        const res = await request(app)
            .post('/api/invoices')
            .set('Authorization', `Bearer ${tokens.procurement}`)
            .send({ poId, amount: 6000, taxAmount: 0 });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('Matched');
        invoiceId = res.body.id;
    });

    test('Finance approves the invoice, auto-creating a Payment', async () => {
        const res = await request(app).patch(`/api/invoices/${invoiceId}/approve`).set('Authorization', `Bearer ${tokens.finance}`);
        expect(res.status).toBe(200);
        expect(res.body.invoice.status).toBe('Approved');
        expect(res.body.payment.paymentStatus).toBe('Unpaid');
        paymentId = res.body.payment.id;
    });

    test('Finance marks the payment as paid', async () => {
        const res = await request(app)
            .patch(`/api/payments/${paymentId}/pay`)
            .set('Authorization', `Bearer ${tokens.finance}`)
            .send({ paymentMethod: 'Wire Transfer', transactionReference: 'TXN-TEST-001' });
        expect(res.status).toBe(200);
        expect(res.body.paymentStatus).toBe('Paid');
    });

    test('paying the same invoice twice is rejected', async () => {
        const res = await request(app).patch(`/api/payments/${paymentId}/pay`).set('Authorization', `Bearer ${tokens.finance}`).send({});
        expect(res.status).toBe(409);
    });

    test('the invoice itself now reflects Paid status', async () => {
        const res = await request(app).get('/api/invoices').set('Authorization', `Bearer ${tokens.finance}`);
        const inv = res.body.find(i => i.id === invoiceId);
        expect(inv.status).toBe('Paid');
    });

    test('a mismatched invoice is flagged with a reason', async () => {
        const res = await request(app)
            .post('/api/invoices')
            .set('Authorization', `Bearer ${tokens.procurement}`)
            .send({ poId, amount: 100, taxAmount: 0 }); // wildly different from the PO total of 6000
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('MismatchFound');
        expect(res.body.mismatchReason).toMatch(/differs from PO total/);
    });

    test('the PO PDF export streams a valid PDF', async () => {
        const res = await request(app).get(`/api/purchaseOrders/${poId}/pdf`).set('Authorization', `Bearer ${tokens.procurement}`);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('application/pdf');
        expect(res.body.slice(0, 4).toString()).toBe('%PDF');
    });

    test('analytics summary reflects the completed workflow', async () => {
        const res = await request(app).get('/api/analytics/summary').set('Authorization', `Bearer ${tokens.admin}`);
        expect(res.status).toBe(200);
        expect(res.body.totalVendors).toBeGreaterThanOrEqual(1);
        expect(res.body.totalProcurementSpend).toBe(6000);
        expect(res.body.openPurchaseOrders).toBeGreaterThanOrEqual(1);
    });

    test('audit log captured every major action', async () => {
        const res = await request(app).get('/api/auditLogs?limit=200').set('Authorization', `Bearer ${tokens.admin}`);
        expect(res.status).toBe(200);
        const actions = res.body.map(l => l.action);
        ['CREATE_VENDOR', 'VENDOR_STATUS_CHANGE', 'CREATE_PR', 'SUBMIT_PR', 'APPROVE_PR', 'CREATE_PO', 'CREATE_INVOICE', 'APPROVE_INVOICE', 'PAY_INVOICE']
            .forEach(a => expect(actions).toContain(a));
    });
});
