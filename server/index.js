/** Start the MediGuide AI server: static front-end + JSON API on one origin. */
import { openDb } from './lib/db.js';
import { createApp } from './app.js';
import { config } from './lib/config.js';

openDb();
createApp().listen(config.port, () => {
  console.log(`MediGuide AI running at http://localhost:${config.port}`);
  console.log('Make an admin:  npm run make-admin -- you@example.com');
});
