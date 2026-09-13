// Account-lifecycle email flows: verification and password reset.
// Tokens are HMAC-signed with an embedded expiry; reset tokens also bind
// to a fingerprint of the current password hash, so changing the password
// (or using the link once) invalidates any outstanding reset links.

import crypto from 'node:crypto';
import { signToken, verifyToken } from './sessions.js';
import { sendEmail } from './email.js';
import * as users from './users.js';

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TTL_MS = 60 * 60 * 1000; // 1h

function passwordFingerprint(user) {
  return crypto.createHash('sha256').update(user.passwordHash).digest('hex').slice(0, 12);
}

export function makeVerifyToken(user) {
  return signToken({ verify: user.id, exp: Date.now() + VERIFY_TTL_MS });
}

export function checkVerifyToken(token) {
  const data = verifyToken(token);
  if (!data?.verify || Date.now() > data.exp) return null;
  return users.findById(data.verify);
}

export function makeResetToken(user) {
  return signToken({ reset: user.id, fp: passwordFingerprint(user), exp: Date.now() + RESET_TTL_MS });
}

export function checkResetToken(token) {
  const data = verifyToken(token);
  if (!data?.reset || Date.now() > data.exp) return null;
  const user = users.findById(data.reset);
  if (!user || data.fp !== passwordFingerprint(user)) return null; // used or password changed
  return user;
}

export async function sendVerificationEmail(user, baseUrl) {
  return sendEmail({
    to: user.email,
    subject: 'Confirm your SubSweep email',
    text:
`Hi,

Confirm your email to finish setting up your SubSweep account (and to receive monthly monitoring emails):

${baseUrl}/api/auth/verify?token=${makeVerifyToken(user)}

The link is valid for 24 hours. If you didn't create this account, you can ignore this email.

— SubSweep`
  });
}

export async function sendResetEmail(user, baseUrl) {
  return sendEmail({
    to: user.email,
    subject: 'Reset your SubSweep password',
    text:
`Hi,

Someone (hopefully you) asked to reset the password for this SubSweep account. Set a new one here:

${baseUrl}/app?reset_token=${makeResetToken(user)}

The link is valid for 1 hour and can be used once. If you didn't ask for this, you can ignore this email — your password is unchanged.

— SubSweep`
  });
}

// Minimal in-memory rate limit for email-sending endpoints.
const lastSent = new Map(); // key -> timestamp
export async function sendProActivatedEmail(user, baseUrl) {
  return sendEmail({
    to: user.email,
    subject: 'SubSweep Pro is active',
    text:
`Hi,

Thanks for upgrading. SubSweep Pro is now active on ${user.email}.

You now get every recurring charge we find (not just the first three), refund-request emails, and monthly monitoring for new charges and price hikes.

Open your dashboard: ${baseUrl}/app

Manage or cancel your subscription any time by clicking the Pro badge in the app. Stripe emails your receipts separately.

— SubSweep`
  });
}

export async function sendProEndedEmail(user, baseUrl) {
  return sendEmail({
    to: user.email,
    subject: 'Your SubSweep Pro subscription has ended',
    text:
`Hi,

Your SubSweep Pro subscription has ended and your account is back on the free plan. Your saved analysis is still there, showing the first three subscriptions.

You can upgrade again at any time: ${baseUrl}/app

— SubSweep`
  });
}

export function rateLimited(key, minIntervalMs = 5 * 60 * 1000) {
  const now = Date.now();
  if (now - (lastSent.get(key) || 0) < minIntervalMs) return true;
  lastSent.set(key, now);
  return false;
}
