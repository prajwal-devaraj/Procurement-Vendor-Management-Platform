// srv/app.js
//
// Express app factory. Accepts a db instance so tests can inject their own
// isolated database without mocking anything.

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { authenticate } = require('./middleware/auth');
const { ApiError } = require('./utils');

const authRoutes             = require('./routes/auth.routes');
const vendorRoutes           = require('./routes/vendors.routes');
const purchaseRequestRoutes  = require('./routes/purchaseRequests.routes');
const purchaseOrderRoutes    = require('./routes/purchaseOrders.routes');
const invoiceRoutes          = require('./routes/invoices.routes');
const paymentRoutes          = require('./routes/payments.routes');
const analyticsRoutes        = require('./routes/analytics.routes');
const miscRoutes             = require('./routes/misc.routes');

function createApp(db) {
    const app = express();

    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(cors());
    app.use(express.json());
    // Normalize missing body to {} so destructuring in route handlers doesn't crash
    // when clients send requests with no body at all
    app.use((req, res, next) => { if (req.body === undefined) req.body = {}; next(); });
    app.use(morgan('dev'));
    app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));

    // Static frontend
    app.use(express.static(path.join(__dirname, '..', 'public')));

    // Public
    app.use('/api/auth', authRoutes(db));
    app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

    // Protected — everything below requires a valid JWT
    app.use('/api', authenticate);
    app.use('/api/vendors',          vendorRoutes(db));
    app.use('/api/purchaseRequests', purchaseRequestRoutes(db));
    app.use('/api/purchaseOrders',   purchaseOrderRoutes(db));
    app.use('/api/invoices',         invoiceRoutes(db));
    app.use('/api/payments',         paymentRoutes(db));
    app.use('/api/analytics',        analyticsRoutes(db));
    app.use('/api',                  miscRoutes(db));

    app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

    app.use((err, req, res, next) => {
        if (err instanceof ApiError) {
            return res.status(err.status).json({ error: err.message });
        }
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    });

    return app;
}

module.exports = { createApp };
