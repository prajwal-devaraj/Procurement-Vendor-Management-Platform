// srv/routes/vendors.routes.js

const express = require('express');
const { authorize } = require('../middleware/auth');
const { newId, audit, asyncHandler, ApiError } = require('../utils');

module.exports = function vendorRoutes(db) {
    const router = express.Router();

    router.get('/', asyncHandler(async (req, res) => {
        const { status, category, search } = req.query;
        let sql = 'SELECT * FROM Vendors WHERE 1=1';
        const params = [];
        if (status)   { sql += ' AND status = ?';     params.push(status); }
        if (category) { sql += ' AND category = ?';   params.push(category); }
        if (search)   { sql += ' AND name LIKE ?';    params.push(`%${search}%`); }
        sql += ' ORDER BY createdAt DESC';
        res.json(db.all(sql, params));
    }));

    router.get('/:id', asyncHandler(async (req, res) => {
        const vendor = db.get('SELECT * FROM Vendors WHERE id = ?', [req.params.id]);
        if (!vendor) throw new ApiError(404, 'Vendor not found');
        const ratings = db.all(
            'SELECT * FROM VendorRatings WHERE vendorId = ? ORDER BY createdAt DESC',
            [req.params.id]
        );
        res.json({ ...vendor, ratings });
    }));

    router.post('/', authorize('ProcurementAdmin', 'SystemAdmin'), asyncHandler(async (req, res) => {
        const { name, category, contactEmail, phone, country, taxId } = req.body;
        if (!name || !category || !contactEmail) {
            throw new ApiError(400, 'name, category, and contactEmail are required');
        }

        const id = newId('VEN');
        db.run(
            `INSERT INTO Vendors (id, name, category, contactEmail, phone, country, taxId, status, riskScore, rating, createdBy)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', 50, 0, ?)`,
            [id, name, category, contactEmail, phone || null, country || null, taxId || null, req.user.id]
        );

        audit(db, { userId: req.user.id, action: 'CREATE_VENDOR', entityType: 'Vendor', entityId: id, details: { name } });
        res.status(201).json(db.get('SELECT * FROM Vendors WHERE id = ?', [id]));
    }));

    router.patch('/:id', authorize('ProcurementAdmin', 'SystemAdmin'), asyncHandler(async (req, res) => {
        const vendor = db.get('SELECT * FROM Vendors WHERE id = ?', [req.params.id]);
        if (!vendor) throw new ApiError(404, 'Vendor not found');

        const allowed = ['name', 'category', 'contactEmail', 'phone', 'country', 'taxId', 'riskScore'];
        const sets = [], params = [];
        for (const f of allowed) {
            if (req.body[f] !== undefined) { sets.push(`${f} = ?`); params.push(req.body[f]); }
        }
        if (!sets.length) throw new ApiError(400, 'No updatable fields provided');
        params.push(req.params.id);

        db.run(`UPDATE Vendors SET ${sets.join(', ')} WHERE id = ?`, params);
        audit(db, { userId: req.user.id, action: 'UPDATE_VENDOR', entityType: 'Vendor', entityId: req.params.id });
        res.json(db.get('SELECT * FROM Vendors WHERE id = ?', [req.params.id]));
    }));

    router.patch('/:id/status', authorize('ProcurementAdmin', 'SystemAdmin'), asyncHandler(async (req, res) => {
        const valid = ['Active', 'Pending', 'Rejected', 'Blocked'];
        const { status } = req.body;
        if (!valid.includes(status)) throw new ApiError(400, `status must be one of: ${valid.join(', ')}`);

        const vendor = db.get('SELECT * FROM Vendors WHERE id = ?', [req.params.id]);
        if (!vendor) throw new ApiError(404, 'Vendor not found');

        db.run('UPDATE Vendors SET status = ? WHERE id = ?', [status, req.params.id]);
        audit(db, {
            userId: req.user.id, action: 'VENDOR_STATUS_CHANGE',
            entityType: 'Vendor', entityId: req.params.id,
            details: { from: vendor.status, to: status }
        });
        res.json(db.get('SELECT * FROM Vendors WHERE id = ?', [req.params.id]));
    }));

    router.post('/:id/ratings', authorize('ProcurementAdmin', 'Finance', 'Manager', 'SystemAdmin'), asyncHandler(async (req, res) => {
        const { score, comment } = req.body;
        if (score === undefined || score < 0 || score > 5) {
            throw new ApiError(400, 'score must be between 0 and 5');
        }

        const vendor = db.get('SELECT * FROM Vendors WHERE id = ?', [req.params.id]);
        if (!vendor) throw new ApiError(404, 'Vendor not found');

        db.run(
            `INSERT INTO VendorRatings (id, vendorId, raterUserId, score, comment)
             VALUES (?, ?, ?, ?, ?)`,
            [newId('RAT'), req.params.id, req.user.id, score, comment || null]
        );

        // Recalculate average and push it back to Vendors
        const { avg } = db.get('SELECT AVG(score) as avg FROM VendorRatings WHERE vendorId = ?', [req.params.id]);
        db.run('UPDATE Vendors SET rating = ? WHERE id = ?', [avg, req.params.id]);

        audit(db, { userId: req.user.id, action: 'RATE_VENDOR', entityType: 'Vendor', entityId: req.params.id, details: { score } });
        res.status(201).json(db.get('SELECT * FROM Vendors WHERE id = ?', [req.params.id]));
    }));

    router.delete('/:id', authorize('SystemAdmin'), asyncHandler(async (req, res) => {
        const vendor = db.get('SELECT * FROM Vendors WHERE id = ?', [req.params.id]);
        if (!vendor) throw new ApiError(404, 'Vendor not found');
        db.run('DELETE FROM Vendors WHERE id = ?', [req.params.id]);
        audit(db, { userId: req.user.id, action: 'DELETE_VENDOR', entityType: 'Vendor', entityId: req.params.id });
        res.status(204).send();
    }));

    return router;
};
