// SQLite database (better-sqlite3, WAL mode). One file in DATA_DIR —
// deploys anywhere with a persistent volume; the schema is plain enough
// that a later Postgres move is a driver swap in users.js.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'subsweep.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  pro INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  basiq_user_id TEXT,
  saved_analysis TEXT,        -- JSON: derived analysis only, never raw transactions
  monitoring TEXT,            -- JSON: {enabled, lastScanAt, lastReminderAt}
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_stripe ON users (stripe_customer_id);
`);

// Additive migrations for databases created before a column existed.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns.includes('pro_ends_at')) {
  // ISO date when a cancelled subscription stops (Pro stays on until then)
  db.exec('ALTER TABLE users ADD COLUMN pro_ends_at TEXT');
}

// One-time migration from the old JSON file store.
const LEGACY_FILE = path.join(DATA_DIR, 'users.json');
export function migrateLegacyStore() {
  if (!fs.existsSync(LEGACY_FILE)) return 0;
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  let imported = 0;
  if (count === 0) {
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
      const insert = db.prepare(`
        INSERT OR IGNORE INTO users
          (id, email, password_hash, pro, email_verified, stripe_customer_id, basiq_user_id, saved_analysis, monitoring, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const tx = db.transaction((all) => {
        for (const u of all) {
          insert.run(
            u.id, u.email, u.passwordHash,
            u.pro ? 1 : 0,
            u.emailVerified === false ? 0 : 1, // pre-verification accounts were grandfathered
            u.stripeCustomerId || null,
            u.basiqUserId || null,
            u.savedAnalysis ? JSON.stringify(u.savedAnalysis) : null,
            JSON.stringify(u.monitoring || { enabled: false, lastScanAt: null, lastReminderAt: null }),
            u.createdAt || new Date().toISOString()
          );
          imported++;
        }
      });
      tx(Object.values(legacy.users || {}));
    } catch (err) {
      console.error('[db] legacy import failed:', err.message);
      return 0;
    }
  }
  fs.renameSync(LEGACY_FILE, `${LEGACY_FILE}.imported`);
  if (imported) console.log(`[db] imported ${imported} user(s) from users.json`);
  return imported;
}
