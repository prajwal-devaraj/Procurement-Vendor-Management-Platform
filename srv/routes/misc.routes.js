// srv/routes/misc.routes.js
// Audit logs, notifications, user list, and current user endpoint.

const express = require('express');
const { authorize } = require('../middleware/auth');
const { asyncHandler } = require('../utils');

module.exports = function miscRoutes(db) {
    const router = express.Router();

    router.get('/auditLogs', authorize('SystemAdmin', 'ProcurementAdmin'), asyncHandler(async (req, res) => {
        const { entityType, entityId, limit } = req.query;
        let sql = 'SELECT * FROM AuditLogs WHERE 1=1';
        const params = [];
        if (entityType) { sql += ' AND entityType = ?'; params.push(entityType); }
        if (entityId)   { sql += ' AND entityId = ?';   params.push(entityId); }
        sql += ' ORDER BY createdAt DESC LIMIT ?';
        params.push(Number(limit) || 100);
        res.json(db.all(sql, params));
    }));

    router.get('/notifications', asyncHandler(async (req, res) => {
        res.json(db.all(
            'SELECT * FROM Notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 50',
            [req.user.id]
        ));
    }));

    router.patch('/notifications/:id/read', asyncHandler(async (req, res) => {
        db.run('UPDATE Notifications SET isRead = 1 WHERE id = ? AND userId = ?', [req.params.id, req.user.id]);
        res.json({ ok: true });
    }));

    // Don't expose passwordHash in the response
    router.get('/users', authorize('SystemAdmin', 'ProcurementAdmin'), asyncHandler(async (req, res) => {
        res.json(db.all(
            'SELECT id, name, email, role, department, isActive, createdAt FROM Users ORDER BY createdAt DESC'
        ));
    }));

    router.get('/me', asyncHandler(async (req, res) => {
        res.json(req.user);
    }));

    return router;
};
