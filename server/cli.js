/** Usage: node server/cli.js make-admin <email> | remove-admin <email> */
import { openDb, get, run, audit } from './lib/db.js';

const [cmd, email] = process.argv.slice(2);
openDb();
const u = email && get('SELECT id, role FROM users WHERE email = ?', email.toLowerCase());
if (!['make-admin', 'remove-admin'].includes(cmd) || !email) { console.error('Usage: node server/cli.js make-admin|remove-admin <email>'); process.exit(1); }
if (!u) { console.error('No user with that email. Register first, then run this again.'); process.exit(1); }
const role = cmd === 'make-admin' ? 'admin' : 'user';
run('UPDATE users SET role = ? WHERE id = ?', role, u.id);
audit(null, 'cli_role_change', `${email}:${role}`);
console.log(`${email} is now ${role}.`);
