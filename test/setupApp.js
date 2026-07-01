// test/setupApp.js
//
// Builds a test app instance with its own isolated SQLite file.
// Each call gets a unique temp file so test suites don't interfere.
//
// Note: I originally used jest.resetModules() here to get fresh module
// instances per test suite, but that approach broke when the test files
// required setupApp.js before the reset ran. Since connection.js now
// accepts a dbFile argument directly, I can skip the module cache tricks
// entirely and just pass a unique path per suite.

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { init }       = require('../db/connection');
const { createApp }  = require('../srv/app');

async function buildTestApp(label) {
    const dbFile = path.join(
        os.tmpdir(),
        `pv-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );

    const db  = await init(dbFile);
    const app = createApp(db);

    return {
        app,
        db,
        dbFile,
        teardown() {
            try { fs.unlinkSync(dbFile); } catch (_) {}
        }
    };
}

module.exports = { buildTestApp };
