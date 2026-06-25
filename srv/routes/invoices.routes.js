// srv/routes/invoices.routes.js
//
// The matching logic: when an invoice is submitted against a PO, I compare
// the invoice total (amount + tax) to the PO total. If the difference is
// within 2%, it's auto-matched. Beyond that it gets flagged as MismatchFound
// for Finance to review. The 2% tolerance handles rounding differences and
// small currency adjustments that come up in practice.

const express = require('express');
const { authorize } = require('../middleware/auth');
const { newId, genNumber, audit, asyncHandler, ApiError } = require('../utils');

module.exports = function invoiceRoutes(db) {
    const router = express.Router();

    router.get('/', asyncHandler(async (req, res) => {
        const { status, vendorId, poId } = req.query;
        let sql = 'SELECT * FROM Invoices WHERE 1=1';
        const params = [];
        if (status)   { sql += ' AND status = ?';   params.push(status); }
        if (vendorId) { sql += ' AND vendorId = ?'; params.push(vendorId); }
        if (poId)     { sql += ' AND poId = ?';     params.push(poId); }
        sql += ' ORDER BY receivedAt DESC';
        res.json(db.all(sql, params));
    }));

    router.get('/:id', asyncHandler(async (req, res) => {
        const invoice = db.get('SELECT * FROM Invoices WHERE id = ?', [req.params.id]);
        if (!invoice) throw new ApiError(404, 'Invoice not found');
        res.json(invoice);
    }));

    router.post('/', authorize('Vendor', 'ProcurementAdmin', 'Finance', 'SystemAdmin'), asyncHandler(async (req, res) => {
        const { poId, amount, taxAmount, dueDate } = req.body;
        if (!poId || amount === undefined) throw new ApiError(400, 'poId and amount are required');

        const po = db.get('SELECT * FROM PurchaseOrders WHERE id = ?', [poId]);
        if (!po) throw new ApiError(404, 'Purchase order not found');

        const submitted = Number(amount) + Number(taxAmount || 0);
        const tolerance = po.totalAmount * 0.02;
        const diff = Math.abs(submitted - po.totalAmount);

        const status = diff <= tolerance ? 'Matched' : 'MismatchFound';
        const mismatchReason = status === 'MismatchFound'
            ? `Invoice total $${submitted.toFixed(2)} differs from PO total $${Number(po.totalAmount).toFixed(2)} by $${diff.toFixed(2)} (tolerance $${tolerance.toFixed(2)})`
            : null;

        const id = newId('INV');
        db.run(
            `INSERT INTO Invoices (id, invoiceNumber, poId, vendorId, amount, taxAmount, status, mismatchReason, dueDate)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, genNumber('INV'), poId, po.vendorId, amount, taxAmount || 0, status, mismatchReason, dueDate || null]
        );

        audit(db, { userId: req.user.id, action: 'CREATE_INVOICE', entityType: 'Invoice', entityId: id, details: { status } });
        res.status(201).json(db.get('SELECT * FROM Invoices WHERE id = ?', [id]));
    }));

    router.patch('/:id/approve', authorize('Finance', 'SystemAdmin'), asyncHandler(async (req, res) => {
        const invoice = db.get('SELECT * FROM Invoices WHERE id = ?', [req.params.id]);
        if (!invoice) throw new ApiError(404, 'Invoice not found');
        if (!['Matched', 'MismatchFound'].includes(invoice.status)) {
            throw new ApiError(409, `Cannot approve an invoice with status '${invoice.status}'`);
        }

        db.run(`UPDATE Invoices SET status='Approved' WHERE id=?`, [req.params.id]);

        // Auto-create payment due in 30 days if no due date was specified
        const dueDate = invoice.dueDate
            || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

        const paymentId = newId('PAY');
        db.run(
            `INSERT INTO Payments (id, invoiceId, vendorId, amount, dueDate, paymentStatus)
             VALUES (?, ?, ?, ?, ?, 'Unpaid')`,
            [paymentId, invoice.id, invoice.vendorId, Number(invoice.amount) + Number(invoice.taxAmount), dueDate]
        );

        audit(db, { userId: req.user.id, action: 'APPROVE_INVOICE', entityType: 'Invoice', entityId: req.params.id });
        res.json({
            invoice:  db.get('SELECT * FROM Invoices WHERE id = ?', [req.params.id]),
            payment:  db.get('SELECT * FROM Payments WHERE id = ?', [paymentId])
        });
    }));

    router.patch('/:id/reject', authorize('Finance', 'SystemAdmin'), asyncHandler(async (req, res) => {
        const invoice = db.get('SELECT * FROM Invoices WHERE id = ?', [req.params.id]);
        if (!invoice) throw new ApiError(404, 'Invoice not found');
        db.run(`UPDATE Invoices SET status='Rejected' WHERE id=?`, [req.params.id]);
        audit(db, { userId: req.user.id, action: 'REJECT_INVOICE', entityType: 'Invoice', entityId: req.params.id });
        res.json(db.get('SELECT * FROM Invoices WHERE id = ?', [req.params.id]));
    }));

    return router;
};
