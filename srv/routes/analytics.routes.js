// srv/routes/analytics.routes.js
//
// All queries run directly against SQLite — no separate aggregation service.
// Works fine at this scale. If the dataset got large I'd add materialized views
// or a separate reporting job, but for a procurement system this is plenty.

const express = require('express');
const { asyncHandler } = require('../utils');

module.exports = function analyticsRoutes(db) {
    const router = express.Router();

    router.get('/summary', asyncHandler(async (req, res) => {
        const today = new Date().toISOString().slice(0, 10);

        res.json({
            totalVendors: db.get('SELECT COUNT(*) as c FROM Vendors').c,

            pendingApprovals: db.get(
                `SELECT COUNT(*) as c FROM Approvals WHERE decision = 'Pending'`
            ).c,

            totalProcurementSpend: db.get(
                'SELECT COALESCE(SUM(totalAmount), 0) as s FROM PurchaseOrders'
            ).s,

            openPurchaseOrders: db.get(
                `SELECT COUNT(*) as c FROM PurchaseOrders WHERE status NOT IN ('Completed','Cancelled')`
            ).c,

            overdueInvoices: db.get(
                `SELECT COUNT(*) as c FROM Payments WHERE paymentStatus IN ('Unpaid','Overdue') AND dueDate < ?`,
                [today]
            ).c,

            topPerformingVendors: db.all(
                `SELECT v.id, v.name, v.rating,
                        COALESCE(SUM(po.totalAmount), 0) as totalSpend
                 FROM Vendors v
                 LEFT JOIN PurchaseOrders po ON po.vendorId = v.id
                 GROUP BY v.id
                 ORDER BY totalSpend DESC
                 LIMIT 5`
            ),

            monthlyProcurementCost: db.get(
                `SELECT COALESCE(SUM(totalAmount), 0) as s FROM PurchaseOrders
                 WHERE strftime('%Y-%m', createdAt) = strftime('%Y-%m', 'now')`
            ).s,

            averageApprovalTimeDays: (() => {
                const row = db.get(
                    `SELECT AVG(julianday(decidedAt) - julianday(createdAt)) as avg
                     FROM Approvals WHERE decision = 'Approved' AND decidedAt IS NOT NULL`
                );
                return row.avg ? Number(row.avg.toFixed(2)) : 0;
            })()
        });
    }));

    router.get('/vendor-performance', asyncHandler(async (req, res) => {
        res.json(db.all(
            `SELECT v.id, v.name, v.category, v.rating, v.riskScore, v.status,
                    COUNT(DISTINCT po.id) as totalOrders,
                    COALESCE(SUM(po.totalAmount), 0) as totalSpend
             FROM Vendors v
             LEFT JOIN PurchaseOrders po ON po.vendorId = v.id
             GROUP BY v.id
             ORDER BY totalSpend DESC`
        ));
    }));

    router.get('/monthly-spend', asyncHandler(async (req, res) => {
        res.json(db.all(
            `SELECT strftime('%Y-%m', createdAt) as month,
                    COALESCE(SUM(totalAmount), 0) as spend
             FROM PurchaseOrders
             GROUP BY month
             ORDER BY month ASC`
        ));
    }));

    router.get('/category-distribution', asyncHandler(async (req, res) => {
        res.json(db.all(
            'SELECT category, COUNT(*) as count FROM Vendors GROUP BY category ORDER BY count DESC'
        ));
    }));

    router.get('/invoice-mismatch-rate', asyncHandler(async (req, res) => {
        const total     = db.get('SELECT COUNT(*) as c FROM Invoices').c;
        const mismatched = db.get(`SELECT COUNT(*) as c FROM Invoices WHERE status = 'MismatchFound'`).c;
        res.json({
            totalInvoices: total,
            mismatchedInvoices: mismatched,
            mismatchRate: total > 0 ? Number(((mismatched / total) * 100).toFixed(2)) : 0
        });
    }));

    router.get('/approval-bottlenecks', asyncHandler(async (req, res) => {
        const rows = db.all(
            `SELECT stage,
                    COUNT(*) as pendingCount,
                    AVG(julianday('now') - julianday(createdAt)) as avgWaitDays
             FROM Approvals
             WHERE decision = 'Pending'
             GROUP BY stage`
        );
        res.json(rows.map(r => ({ ...r, avgWaitDays: r.avgWaitDays ? Number(r.avgWaitDays.toFixed(2)) : 0 })));
    }));

    return router;
};
