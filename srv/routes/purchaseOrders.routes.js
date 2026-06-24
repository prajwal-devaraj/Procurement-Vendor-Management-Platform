// srv/routes/purchaseOrders.routes.js

const express = require('express');
const PDFDocument = require('pdfkit');
const { authorize } = require('../middleware/auth');
const { newId, genNumber, audit, asyncHandler, ApiError } = require('../utils');

module.exports = function purchaseOrderRoutes(db) {
    const router = express.Router();

    function getFullPO(id) {
        const po = db.get('SELECT * FROM PurchaseOrders WHERE id = ?', [id]);
        if (!po) return null;
        po.items  = db.all('SELECT * FROM PurchaseOrderItems WHERE poId = ?', [id]);
        po.vendor = db.get('SELECT * FROM Vendors WHERE id = ?', [po.vendorId]);
        return po;
    }

    router.get('/', asyncHandler(async (req, res) => {
        const { status, vendorId } = req.query;
        let sql = 'SELECT * FROM PurchaseOrders WHERE 1=1';
        const params = [];
        if (status)   { sql += ' AND status = ?';   params.push(status); }
        if (vendorId) { sql += ' AND vendorId = ?'; params.push(vendorId); }
        sql += ' ORDER BY createdAt DESC';
        const rows = db.all(sql, params);
        res.json(rows.map(r => ({
            ...r,
            items: db.all('SELECT * FROM PurchaseOrderItems WHERE poId = ?', [r.id])
        })));
    }));

    router.get('/:id', asyncHandler(async (req, res) => {
        const po = getFullPO(req.params.id);
        if (!po) throw new ApiError(404, 'Purchase order not found');
        res.json(po);
    }));

    router.post('/', authorize('ProcurementAdmin', 'SystemAdmin'), asyncHandler(async (req, res) => {
        const { requestId, vendorId, unitPrices } = req.body;
        if (!requestId || !vendorId) throw new ApiError(400, 'requestId and vendorId are required');

        const pr = db.get('SELECT * FROM PurchaseRequests WHERE id = ?', [requestId]);
        if (!pr) throw new ApiError(404, 'Purchase request not found');
        if (pr.status !== 'FinanceApproved') {
            throw new ApiError(409, 'Request must be FinanceApproved before generating a PO');
        }

        const vendor = db.get('SELECT * FROM Vendors WHERE id = ?', [vendorId]);
        if (!vendor) throw new ApiError(404, 'Vendor not found');
        if (vendor.status !== 'Active') throw new ApiError(409, 'Vendor must be Active to receive a PO');

        const requestItems = db.all('SELECT * FROM PurchaseRequestItems WHERE requestId = ?', [requestId]);
        const poId = newId('PO');
        const poNumber = genNumber('PO');

        let total = 0;
        const lineItems = requestItems.map((item, i) => {
            const unitPrice = (unitPrices && unitPrices[i] !== undefined)
                ? Number(unitPrices[i])
                : item.estimatedCost;
            const lineTotal = unitPrice * item.quantity;
            total += lineTotal;
            return { itemName: item.itemName, quantity: item.quantity, unitPrice, lineTotal };
        });

        db.run(
            `INSERT INTO PurchaseOrders (id, poNumber, requestId, vendorId, status, totalAmount, createdBy)
             VALUES (?, ?, ?, ?, 'Created', ?, ?)`,
            [poId, poNumber, requestId, vendorId, total, req.user.id]
        );
        for (const li of lineItems) {
            db.run(
                `INSERT INTO PurchaseOrderItems (id, poId, itemName, quantity, unitPrice, lineTotal)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [newId('POI'), poId, li.itemName, li.quantity, li.unitPrice, li.lineTotal]
            );
        }

        db.run(`UPDATE PurchaseRequests SET status='ConvertedToPO', updatedAt=datetime('now') WHERE id=?`, [requestId]);
        audit(db, { userId: req.user.id, action: 'CREATE_PO', entityType: 'PurchaseOrder', entityId: poId, details: { poNumber, vendorId } });
        res.status(201).json(getFullPO(poId));
    }));

    router.patch('/:id/status', authorize('ProcurementAdmin', 'Vendor', 'SystemAdmin'), asyncHandler(async (req, res) => {
        const valid = ['Created', 'SentToVendor', 'Acknowledged', 'PartiallyDelivered', 'Completed', 'Cancelled'];
        const { status } = req.body;
        if (!valid.includes(status)) throw new ApiError(400, `status must be one of: ${valid.join(', ')}`);

        const po = db.get('SELECT * FROM PurchaseOrders WHERE id = ?', [req.params.id]);
        if (!po) throw new ApiError(404, 'Purchase order not found');

        db.run(`UPDATE PurchaseOrders SET status=?, updatedAt=datetime('now') WHERE id=?`, [status, req.params.id]);
        audit(db, { userId: req.user.id, action: 'PO_STATUS', entityType: 'PurchaseOrder', entityId: req.params.id, details: { from: po.status, to: status } });
        res.json(getFullPO(req.params.id));
    }));

    // PDF export — streams directly to the response.
    // Using PDFKit here; it's a bit low-level but avoids a template engine dependency.
    router.get('/:id/pdf', asyncHandler(async (req, res) => {
        const po = getFullPO(req.params.id);
        if (!po) throw new ApiError(404, 'Purchase order not found');

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${po.poNumber}.pdf"`);

        const doc = new PDFDocument({ margin: 50 });
        doc.pipe(res);

        doc.fontSize(20).text('Purchase Order', { align: 'right' });
        doc.fontSize(10).text(po.poNumber, { align: 'right' });
        doc.moveDown();

        doc.fontSize(12)
           .text(`Vendor: ${po.vendor.name}`)
           .text(`Contact: ${po.vendor.contactEmail}`)
           .text(`Status: ${po.status}`)
           .text(`Date: ${po.createdAt.slice(0, 10)}`);
        doc.moveDown();

        doc.fontSize(13).text('Line Items', { underline: true }).moveDown(0.5);
        doc.fontSize(10);

        const top = doc.y;
        doc.text('Item',       50,  top, { width: 220 });
        doc.text('Qty',        280, top, { width: 60 });
        doc.text('Unit Price', 350, top, { width: 90 });
        doc.text('Total',      450, top, { width: 90 });
        doc.moveDown();

        let y = doc.y;
        for (const item of po.items) {
            doc.text(item.itemName,                   50,  y, { width: 220 });
            doc.text(String(item.quantity),            280, y, { width: 60 });
            doc.text(`$${Number(item.unitPrice).toFixed(2)}`,  350, y, { width: 90 });
            doc.text(`$${Number(item.lineTotal).toFixed(2)}`,  450, y, { width: 90 });
            y += 20;
        }

        doc.moveDown(2).fontSize(12).text(`Total: $${Number(po.totalAmount).toFixed(2)}`, { align: 'right' });
        doc.end();
    }));

    return router;
};
