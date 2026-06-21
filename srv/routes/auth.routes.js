// srv/routes/auth.routes.js

const express = require('express');
const bcrypt = require('bcryptjs');
const { signToken } = require('../middleware/auth');
const { newId, audit, asyncHandler, ApiError } = require('../utils');

const VALID_ROLES = ['Employee', 'Manager', 'Finance', 'ProcurementAdmin', 'Vendor', 'SystemAdmin'];

module.exports = function authRoutes(db) {
    const router = express.Router();

    router.post('/register', asyncHandler(async (req, res) => {
        const { name, email, password, role, department } = req.body;

        if (!name || !email || !password || !role) {
            throw new ApiError(400, 'name, email, password, and role are required');
        }
        if (!VALID_ROLES.includes(role)) {
            throw new ApiError(400, `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`);
        }

        const existing = db.get('SELECT id FROM Users WHERE email = ?', [email]);
        if (existing) throw new ApiError(409, 'An account with this email already exists');

        const passwordHash = bcrypt.hashSync(password, 10);
        const id = newId('USR');

        db.run(
            `INSERT INTO Users (id, name, email, passwordHash, role, department)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, name, email, passwordHash, role, department || null]
        );

        audit(db, { userId: id, action: 'REGISTER', entityType: 'User', entityId: id, details: { role } });

        const user = { id, name, email, role };
        res.status(201).json({ token: signToken(user), user });
    }));

    router.post('/login', asyncHandler(async (req, res) => {
        const { email, password } = req.body;
        if (!email || !password) throw new ApiError(400, 'email and password are required');

        const row = db.get('SELECT * FROM Users WHERE email = ?', [email]);
        if (!row || !bcrypt.compareSync(password, row.passwordHash)) {
            throw new ApiError(401, 'Invalid email or password');
        }
        if (!row.isActive) throw new ApiError(403, 'Account has been deactivated');

        audit(db, { userId: row.id, action: 'LOGIN', entityType: 'User', entityId: row.id });

        const user = { id: row.id, name: row.name, email: row.email, role: row.role };
        res.json({ token: signToken(user), user });
    }));

    return router;
};
