// srv/utils.js
//
// Small helpers used across routes. Nothing fancy here.

const { v4: uuidv4 } = require('uuid');

// Prefixed IDs make logs and debugging way easier than raw UUIDs
function newId(prefix) {
    return `${prefix}-${uuidv4()}`;
}

// Human-readable document numbers: PR-41205312-847, PO-41205312-293, etc.
function genNumber(prefix) {
    const ts = Date.now().toString().slice(-8);
    const rand = Math.floor(100 + Math.random() * 900);
    return `${prefix}-${ts}-${rand}`;
}

function audit(db, { userId, action, entityType, entityId, details }) {
    db.run(
        `INSERT INTO AuditLogs (id, userId, action, entityType, entityId, details)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [newId('AUD'), userId || null, action, entityType, entityId,
         details ? JSON.stringify(details) : null]
    );
}

function notify(db, { userId, title, message }) {
    db.run(
        `INSERT INTO Notifications (id, userId, title, message) VALUES (?, ?, ?, ?)`,
        [newId('NOTIF'), userId, title, message]
    );
}

// Wraps async route handlers so thrown errors propagate to Express's
// error handler instead of becoming unhandled promise rejections
function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

module.exports = { newId, genNumber, audit, notify, asyncHandler, ApiError };
