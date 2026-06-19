require('dotenv').config();
const { init } = require('./db/connection');
const { createApp } = require('./srv/app');

const PORT = process.env.PORT || 4000;

init().then((db) => {
    const app = createApp(db);
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
    });
}).catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
});
