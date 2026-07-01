// test/auth.test.js
const request = require('supertest');
const { buildTestApp } = require('./setupApp');

let app, teardown;

beforeAll(async () => {
    const t = await buildTestApp('auth');
    app = t.app;
    teardown = t.teardown;
});

afterAll(() => teardown());

describe('Auth', () => {
    test('registers a new user and returns a token', async () => {
        const res = await request(app).post('/api/auth/register').send({
            name: 'Test Employee', email: 'test.employee@example.com', password: 'pass1234', role: 'Employee'
        });
        expect(res.status).toBe(201);
        expect(res.body.token).toBeTruthy();
        expect(res.body.user.role).toBe('Employee');
    });

    test('rejects registration with an invalid role', async () => {
        const res = await request(app).post('/api/auth/register').send({
            name: 'Bad Role', email: 'bad.role@example.com', password: 'pass1234', role: 'SuperUser'
        });
        expect(res.status).toBe(400);
    });

    test('rejects duplicate email registration', async () => {
        const res = await request(app).post('/api/auth/register').send({
            name: 'Dupe', email: 'test.employee@example.com', password: 'pass1234', role: 'Employee'
        });
        expect(res.status).toBe(409);
    });

    test('logs in with correct credentials', async () => {
        const res = await request(app).post('/api/auth/login').send({ email: 'test.employee@example.com', password: 'pass1234' });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
    });

    test('rejects login with wrong password', async () => {
        const res = await request(app).post('/api/auth/login').send({ email: 'test.employee@example.com', password: 'wrongpass' });
        expect(res.status).toBe(401);
    });

    test('rejects login for unknown email', async () => {
        const res = await request(app).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever' });
        expect(res.status).toBe(401);
    });

    test('rejects access to a protected route without a token', async () => {
        const res = await request(app).get('/api/vendors');
        expect(res.status).toBe(401);
    });

    test('rejects access with a malformed token', async () => {
        const res = await request(app).get('/api/vendors').set('Authorization', 'Bearer not-a-real-token');
        expect(res.status).toBe(401);
    });

    test('health check is public and requires no auth', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });
});

describe('RBAC', () => {
    let employeeToken, procurementToken;

    beforeAll(async () => {
        const emp = await request(app).post('/api/auth/register').send({
            name: 'RBAC Employee', email: 'rbac.employee@example.com', password: 'pass1234', role: 'Employee'
        });
        employeeToken = emp.body.token;

        const proc = await request(app).post('/api/auth/register').send({
            name: 'RBAC Procurement', email: 'rbac.procurement@example.com', password: 'pass1234', role: 'ProcurementAdmin'
        });
        procurementToken = proc.body.token;
    });

    test('an Employee cannot create a vendor', async () => {
        const res = await request(app)
            .post('/api/vendors')
            .set('Authorization', `Bearer ${employeeToken}`)
            .send({ name: 'X', category: 'Y', contactEmail: 'x@y.com' });
        expect(res.status).toBe(403);
    });

    test('a ProcurementAdmin can create a vendor', async () => {
        const res = await request(app)
            .post('/api/vendors')
            .set('Authorization', `Bearer ${procurementToken}`)
            .send({ name: 'RBAC Test Vendor', category: 'Office Equipment', contactEmail: 'vendor@rbac-test.com' });
        expect(res.status).toBe(201);
        expect(res.body.status).toBe('Pending');
    });

    test('an Employee cannot view audit logs', async () => {
        const res = await request(app).get('/api/auditLogs').set('Authorization', `Bearer ${employeeToken}`);
        expect(res.status).toBe(403);
    });
});
