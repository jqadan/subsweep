// User store backed by SQLite (lib/db.js). The exported interface is
// unchanged from the original file store, so the rest of the app doesn't
// know or care. Raw transactions are NEVER stored — only the account
// record, billing state, and the derived subscription analysis.

import crypto from 'node:crypto';
import { db, migrateLegacyStore } from './db.js';

migrateLegacyStore();

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT_OPTS);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64, SCRYPT_OPTS);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    pro: Boolean(row.pro),
    emailVerified: Boolean(row.email_verified),
    stripeCustomerId: row.stripe_customer_id,
    proEndsAt: row.pro_ends_at || null,
    basiqUserId: row.basiq_user_id,
    savedAnalysis: row.saved_analysis ? JSON.parse(row.saved_analysis) : null,
    monitoring: row.monitoring ? JSON.parse(row.monitoring) : { enabled: false, lastScanAt: null, lastReminderAt: null },
    createdAt: row.created_at
  };
}

const COLUMN_FOR = {
  passwordHash: { col: 'password_hash', map: (v) => v },
  pro: { col: 'pro', map: (v) => (v ? 1 : 0) },
  emailVerified: { col: 'email_verified', map: (v) => (v ? 1 : 0) },
  stripeCustomerId: { col: 'stripe_customer_id', map: (v) => v },
  proEndsAt: { col: 'pro_ends_at', map: (v) => v || null },
  basiqUserId: { col: 'basiq_user_id', map: (v) => v },
  savedAnalysis: { col: 'saved_analysis', map: (v) => (v == null ? null : JSON.stringify(v)) },
  monitoring: { col: 'monitoring', map: (v) => (v == null ? null : JSON.stringify(v)) }
};

export function findByEmail(email) {
  const norm = String(email).trim().toLowerCase();
  return rowToUser(db.prepare('SELECT * FROM users WHERE email = ?').get(norm));
}

export function findById(id) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(String(id)));
}

export function findByStripeCustomer(customerId) {
  return rowToUser(db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(String(customerId)));
}

export function findAll() {
  return db.prepare('SELECT * FROM users').all().map(rowToUser);
}

export function createUser({ email, password }) {
  const norm = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(norm)) throw new Error('Invalid email address');
  if (String(password).length < 8) throw new Error('Password must be at least 8 characters');
  if (findByEmail(norm)) throw new Error('An account with that email already exists');
  const user = {
    id: crypto.randomUUID(),
    email: norm,
    passwordHash: hashPassword(password),
    pro: false,
    emailVerified: false,
    stripeCustomerId: null,
    basiqUserId: null,
    savedAnalysis: null,
    monitoring: { enabled: false, lastScanAt: null, lastReminderAt: null },
    createdAt: new Date().toISOString()
  };
  db.prepare(`
    INSERT INTO users (id, email, password_hash, pro, email_verified, stripe_customer_id, basiq_user_id, saved_analysis, monitoring, created_at)
    VALUES (?, ?, ?, 0, 0, NULL, NULL, NULL, ?, ?)`
  ).run(user.id, user.email, user.passwordHash, JSON.stringify(user.monitoring), user.createdAt);
  return user;
}

export function updateUser(id, patch) {
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(patch)) {
    const spec = COLUMN_FOR[key];
    if (!spec) continue; // unknown fields are ignored, same as before
    sets.push(`${spec.col} = ?`);
    values.push(spec.map(value));
  }
  if (sets.length) {
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values, String(id));
  }
  return findById(id);
}

// Accounts imported from the pre-verification era were grandfathered in
// during migration, so the flag is authoritative here.
export function isVerified(user) {
  return user.emailVerified !== false;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    pro: user.pro,
    verified: isVerified(user),
    hasSavedAnalysis: Boolean(user.savedAnalysis),
    monitoring: user.monitoring
  };
}
