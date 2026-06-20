// db/seed.js
//
// Populates demo users (one per role) and some vendors in different states.
// Run this once after cloning: npm run seed
//
// Passwords are all "demo1234" - obviously not for production.
// I set riskScore randomly per vendor just to make the analytics dashboard
// look like real data rather than all zeros.

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { init } = require('./connection');

function id(prefix) {
    return `${prefix}-${uuidv4()}`;
}

async function seed() {
    const db = await init();
    const hash = bcrypt.hashSync('demo1234', 10);

    const users = [
        { id: id('USR'), name: 'Sarah Admin',       email: 'admin@demo.com',       role: 'SystemAdmin',       department: 'IT' },
        { id: id('USR'), name: 'Priya Procurement', email: 'procurement@demo.com', role: 'ProcurementAdmin',  department: 'Procurement' },
        { id: id('USR'), name: 'Marcus Manager',    email: 'manager@demo.com',     role: 'Manager',           department: 'Engineering' },
        { id: id('USR'), name: 'Fiona Finance',     email: 'finance@demo.com',     role: 'Finance',           department: 'Finance' },
        { id: id('USR'), name: 'Eddie Employee',    email: 'employee@demo.com',    role: 'Employee',          department: 'Engineering' },
        { id: id('USR'), name: 'Vera Vendor',       email: 'vendor@demo.com',      role: 'Vendor',            department: null },
    ];

    for (const u of users) {
        const exists = db.get('SELECT id FROM Users WHERE email = ?', [u.email]);
        if (exists) {
            console.log(`  skip  ${u.email} (already exists)`);
            continue;
        }
        db.run(
            `INSERT INTO Users (id, name, email, passwordHash, role, department)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [u.id, u.name, u.email, hash, u.role, u.department]
        );
        console.log(`  created  ${u.email}  (${u.role})`);
    }

    const procAdmin = db.get(`SELECT id FROM Users WHERE email = 'procurement@demo.com'`);

    const vendors = [
        { name: 'Acme Office Supplies',   category: 'Office Equipment',      email: 'sales@acme.com',          country: 'USA',     status: 'Active',  rating: 4.2 },
        { name: 'NorthStar IT Hardware',  category: 'IT Hardware',           email: 'orders@northstar.io',     country: 'Canada',  status: 'Active',  rating: 4.6 },
        { name: 'CloudLicense Software',  category: 'Software & Licensing',  email: 'billing@cloudlicense.com',country: 'Ireland', status: 'Active',  rating: 3.9 },
        { name: 'Apex Logistics Group',   category: 'Logistics',             email: 'contracts@apex.com',      country: 'USA',     status: 'Pending', rating: 0   },
        { name: 'Meridian Raw Materials', category: 'Raw Materials',         email: 'sales@meridian-rm.com',   country: 'Germany', status: 'Active',  rating: 4.0 },
        { name: 'BlackPine Consulting',   category: 'Professional Services', email: 'hello@blackpine.co',      country: 'UK',      status: 'Blocked', rating: 1.5 },
    ];

    for (const v of vendors) {
        const exists = db.get('SELECT id FROM Vendors WHERE name = ?', [v.name]);
        if (exists) {
            console.log(`  skip  ${v.name}`);
            continue;
        }
        const risk = Math.round(20 + Math.random() * 60);
        db.run(
            `INSERT INTO Vendors (id, name, category, contactEmail, country, status, riskScore, rating, createdBy)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id('VEN'), v.name, v.category, v.email, v.country, v.status, risk, v.rating, procAdmin.id]
        );
        console.log(`  created  ${v.name}  (${v.status})`);
    }

    console.log('\nDone. Demo logins (password: demo1234):');
    users.forEach(u => console.log(`  ${u.email.padEnd(28)} ${u.role}`));
}

seed().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
