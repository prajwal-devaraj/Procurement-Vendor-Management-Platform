// srv/routes/purchaseRequests.routes.js
//
// The approval chain is: Employee submits → Manager approves → Finance approves
// → Procurement Admin converts to PO. Each stage creates an Approvals record.
// I model this as explicit stage transitions rather than a generic state machine
// because the business rules are simple enough that explicit code is clearer.

const express = require('express');
const { authorize } = require('../middleware/auth');
const { newId, genNumber, audit, notify, asyncHandler, ApiError } = require('../utils');

module.exports = function purchaseRequestRoutes(db) {
    const router = express.Router();

    function getFullRequest(id) {
        const pr = db.get('SELECT * FROM PurchaseRequests WHERE id = ?', [id]);
        if (!pr) return null;
        pr.items     = db.all('SELECT * FROM PurchaseRequestItems WHERE requestId = ?', [id]);
        pr.approvals = db.all(
            `SELECT * FROM Approvals WHERE entityType = 'PurchaseRequest' AND entityId = ? ORDER BY createdAt`,
            [id]
        );
        return pr;
    }

    router.get('/', asyncHandler(async (req, res) => {
        const { status, requesterId, department } = req.query;
        let sql = 'SELECT * FROM PurchaseRequests WHERE 1=1';
        const params = [];
        if (status)      { sql += ' AND status = ?';      params.push(status); }
        if (requesterId) { sql += ' AND requesterId = ?'; params.push(requesterId); }
        if (department)  { sql += ' AND department = ?';  params.push(department); }
        sql += ' ORDER BY createdAt DESC';
        const rows = db.all(sql, params);
        res.json(rows.map(r => ({
            ...r,
            items: db.all('SELECT * FROM PurchaseRequestItems WHERE requestId = ?', [r.id])
        })));
    }));

    router.get('/:id', asyncHandler(async (req, res) => {
        const pr = getFullRequest(req.params.id);
        if (!pr) throw new ApiError(404, 'Purchase request not found');
        res.json(pr);
    }));

    router.post('/', asyncHandler(async (req, res) => {
        const { department, justification, items } = req.body;
        if (!department || !Array.isArray(items) || items.length === 0) {
            throw new ApiError(400, 'department and at least one item are required');
        }

        const id = newId('PR');
        const requestNumber = genNumber('PR');
        const total = items.reduce((sum, i) => sum + (Number(i.quantity) * Number(i.estimatedCost)), 0);

        db.run(
            `INSERT INTO PurchaseRequests (id, requestNumber, requesterId, department, justification, status, totalEstimatedCost)
             VALUES (?, ?, ?, ?, ?, 'Draft', ?)`,
            [id, requestNumber, req.user.id, department, justification || null, total]
        );
        for (const item of items) {
            db.run(
                `INSERT INTO PurchaseRequestItems (id, requestId, itemName, quantity, estimatedCost, notes)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [newId('PRI'), id, item.itemName, item.quantity, item.estimatedCost, item.notes || null]
            );
        }

        audit(db, { userId: req.user.id, action: 'CREATE_PR', entityType: 'PurchaseRequest', entityId: id, details: { requestNumber } });
        res.status(201).json(getFullRequest(id));
    }));

    router.patch('/:id/submit', asyncHandler(async (req, res) => {
        const pr = db.get('SELECT * FROM PurchaseRequests WHERE id = ?', [req.params.id]);
        if (!pr) throw new ApiError(404, 'Purchase request not found');
        if (pr.status !== 'Draft') throw new ApiError(409, `Cannot submit a request with status '${pr.status}'`);

        db.run(`UPDATE PurchaseRequests SET status = 'Submitted', updatedAt = datetime('now') WHERE id = ?`, [req.params.id]);
        db.run(
            `INSERT INTO Approvals (id, entityType, entityId, stage, decision) VALUES (?, 'PurchaseRequest', ?, 'ManagerReview', 'Pending')`,
            [newId('APR'), req.params.id]
        );

        audit(db, { userId: req.user.id, action: 'SUBMIT_PR', entityType: 'PurchaseRequest', entityId: req.params.id });
        res.json(getFullRequest(req.params.id));
    }));

    router.post('/:id/approve', authorize('Manager', 'Finance', 'SystemAdmin'), asyncHandler(async (req, res) => {
        const pr = db.get('SELECT * FROM PurchaseRequests WHERE id = ?', [req.params.id]);
        if (!pr) throw new ApiError(404, 'Purchase request not found');

        const { comment } = req.body;
        let stageName, nextStatus, nextStage;

        if (req.user.role === 'Manager' && pr.status === 'Submitted') {
            stageName = 'ManagerReview'; nextStatus = 'ManagerApproved'; nextStage = 'FinanceReview';
        } else if (req.user.role === 'Finance' && pr.status === 'ManagerApproved') {
            stageName = 'FinanceReview'; nextStatus = 'FinanceApproved'; nextStage = null;
        } else if (req.user.role === 'SystemAdmin') {
            stageName   = pr.status === 'Submitted' ? 'ManagerReview' : 'FinanceReview';
            nextStatus  = pr.status === 'Submitted' ? 'ManagerApproved' : 'FinanceApproved';
            nextStage   = pr.status === 'Submitted' ? 'FinanceReview' : null;
        } else {
            throw new ApiError(409, `A ${req.user.role} cannot approve a request in status '${pr.status}'`);
        }

        const pending = db.get(
            `SELECT * FROM Approvals WHERE entityType='PurchaseRequest' AND entityId=? AND stage=? AND decision='Pending'`,
            [req.params.id, stageName]
        );
        if (!pending) throw new ApiError(409, `No pending ${stageName} approval found`);

        db.run(
            `UPDATE Approvals SET decision='Approved', approverId=?, comment=?, decidedAt=datetime('now') WHERE id=?`,
            [req.user.id, comment || null, pending.id]
        );
        db.run(`UPDATE PurchaseRequests SET status=?, updatedAt=datetime('now') WHERE id=?`, [nextStatus, req.params.id]);

        if (nextStage) {
            db.run(
                `INSERT INTO Approvals (id, entityType, entityId, stage, decision) VALUES (?, 'PurchaseRequest', ?, ?, 'Pending')`,
                [newId('APR'), req.params.id, nextStage]
            );
        }

        notify(db, {
            userId: pr.requesterId,
            title: 'Purchase request approved',
            message: `${pr.requestNumber} was approved at the ${stageName} stage.`
        });
        audit(db, { userId: req.user.id, action: 'APPROVE_PR', entityType: 'PurchaseRequest', entityId: req.params.id, details: { stage: stageName } });
        res.json(getFullRequest(req.params.id));
    }));

    router.post('/:id/reject', authorize('Manager', 'Finance', 'SystemAdmin'), asyncHandler(async (req, res) => {
        const pr = db.get('SELECT * FROM PurchaseRequests WHERE id = ?', [req.params.id]);
        if (!pr) throw new ApiError(404, 'Purchase request not found');
        if (!['Submitted', 'ManagerApproved'].includes(pr.status)) {
            throw new ApiError(409, `Cannot reject a request with status '${pr.status}'`);
        }

        const { comment } = req.body;
        const stageName = pr.status === 'Submitted' ? 'ManagerReview' : 'FinanceReview';

        const pending = db.get(
            `SELECT * FROM Approvals WHERE entityType='PurchaseRequest' AND entityId=? AND stage=? AND decision='Pending'`,
            [req.params.id, stageName]
        );
        if (pending) {
            db.run(
                `UPDATE Approvals SET decision='Rejected', approverId=?, comment=?, decidedAt=datetime('now') WHERE id=?`,
                [req.user.id, comment || null, pending.id]
            );
        }

        db.run(`UPDATE PurchaseRequests SET status='Rejected', updatedAt=datetime('now') WHERE id=?`, [req.params.id]);
        notify(db, {
            userId: pr.requesterId,
            title: 'Purchase request rejected',
            message: `${pr.requestNumber} was rejected. Reason: ${comment || 'none given'}`
        });
        audit(db, { userId: req.user.id, action: 'REJECT_PR', entityType: 'PurchaseRequest', entityId: req.params.id, details: { comment } });
        res.json(getFullRequest(req.params.id));
    }));

    return router;
};
