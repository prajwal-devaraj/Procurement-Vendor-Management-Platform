// srv/routes/payments.routes.js

const express = require('express');
const { authorize } = require('../middleware/auth');
const { audit, asyncHandler, ApiError } = require('../utils');

module.exports = function paymentRoutes(db) {
    const router = express.Router();

    // Check for overdue payments on every list call rather than running a cron job.
    // Fine for this scale — if it became a performance issue I'd schedule it separately.
    function markOverdue() {
        const today = new Date().toISOString().slice(0, 10);
        db.run(
            `UPDATE Payments SET paymentStatus='Overdue'
             WHERE paymentStatus='Unpaid' AND dueDate < ?`,
            [today]
        );
    }

    router.get('/', asyncHandler(async (req, res) => {
        markOverdue();
        const { status, vendorId } = req.query;
        let sql = 'SELECT * FROM Payments WHERE 1=1';
        const params = [];
        if (status)   { sql += ' AND paymentStatus = ?'; params.push(status); }
        if (vendorId) { sql += ' AND vendorId = ?';      params.push(vendorId); }
        sql += ' ORDER BY dueDate ASC';
        res.json(db.all(sql, params));
    }));

    router.get('/:id', asyncHandler(async (req, res) => {
        const payment = db.get('SELECT * FROM Payments WHERE id = ?', [req.params.id]);
        if (!payment) throw new ApiError(404, 'Payment not found');
        res.json(payment);
    }));

    router.patch('/:id/pay', authorize('Finance', 'SystemAdmin'), asyncHandler(async (req, res) => {
        const { paymentMethod, transactionReference } = req.body;
        const payment = db.get('SELECT * FROM Payments WHERE id = ?', [req.params.id]);
        if (!payment) throw new ApiError(404, 'Payment not found');
        if (payment.paymentStatus === 'Paid') throw new ApiError(409, 'Payment is already marked as paid');

        db.run(
            `UPDATE Payments
             SET paymentStatus='Paid', paymentMethod=?, transactionReference=?, paidAt=datetime('now')
             WHERE id=?`,
            [paymentMethod || 'Bank Transfer', transactionReference || null, req.params.id]
        );
        db.run(`UPDATE Invoices SET status='Paid' WHERE id=?`, [payment.invoiceId]);

        audit(db, {
            userId: req.user.id, action: 'PAY_INVOICE',
            entityType: 'Payment', entityId: req.params.id,
            details: { paymentMethod, transactionReference }
        });
        res.json(db.get('SELECT * FROM Payments WHERE id = ?', [req.params.id]));
    }));

    return router;
};
