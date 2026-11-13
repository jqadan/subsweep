// Email delivery with two backends:
//  - Resend (https://resend.com) when RESEND_API_KEY is set — one REST call.
//  - Otherwise a local outbox file (data/outbox.json), so reminders are
//    fully testable in development and nothing silently disappears.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const OUTBOX_FILE = path.join(DATA_DIR, 'outbox.json');

const FROM = process.env.EMAIL_FROM || 'SubSweep <reminders@subsweep.example>';

export function emailBackend() {
  return process.env.RESEND_API_KEY ? 'resend' : 'outbox';
}

export async function sendEmail({ to, subject, text }) {
  if (process.env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from: FROM, to: [to], subject, text })
    });
    if (!res.ok) throw new Error(`Resend failed (${res.status}): ${await res.text()}`);
    return { backend: 'resend', id: (await res.json()).id };
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  let outbox = [];
  try {
    outbox = JSON.parse(fs.readFileSync(OUTBOX_FILE, 'utf8'));
  } catch { /* fresh outbox */ }
  const entry = { to, subject, text, at: new Date().toISOString() };
  outbox.push(entry);
  fs.writeFileSync(OUTBOX_FILE, JSON.stringify(outbox, null, 2));
  console.log(`[email outbox] to=${to} subject="${subject}"`);
  return { backend: 'outbox' };
}
