// Bank statement CSV parser tolerant of common Australian bank exports
// (CBA, Westpac, NAB, ANZ, ING, Up, etc.). Handles:
//  - with or without header row
//  - date formats dd/mm/yyyy, yyyy-mm-dd, dd-mm-yyyy, "12 Mar 2026"
//  - single signed Amount column, or separate Debit/Credit columns
//  - quoted fields with embedded commas

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseDate(raw) {
  const s = raw.trim().replace(/"/g, '');
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(Date.UTC(year, +m[2] - 1, +m[1])); // AU convention: dd/mm
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    return new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
  }
  return null;
}

function parseAmount(raw) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).replace(/[$,\s"]/g, '');
  if (s === '' || s === '-') return null;
  const n = Number(s.replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : null;
}

// Returns [{date: Date, description, amount}] where amount < 0 means money out.
export function parseStatementCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return { transactions: [], warnings: ['Empty file'] };

  const warnings = [];
  const firstCells = splitCsvLine(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = firstCells.some((c) => /date|description|narrative|amount|debit|credit|details|memo/.test(c));

  let cols = { date: -1, desc: -1, amount: -1, debit: -1, credit: -1 };
  if (hasHeader) {
    firstCells.forEach((c, i) => {
      if (cols.date === -1 && /date/.test(c)) cols.date = i;
      if (cols.desc === -1 && /(description|narrative|details|memo|transaction)/.test(c)) cols.desc = i;
      if (cols.debit === -1 && /debit/.test(c)) cols.debit = i;
      if (cols.credit === -1 && /credit/.test(c)) cols.credit = i;
      if (cols.amount === -1 && /^amount|amount\b/.test(c) && !/debit|credit/.test(c)) cols.amount = i;
    });
  }

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const transactions = [];

  for (const line of dataLines) {
    const cells = splitCsvLine(line);
    if (cells.length < 2) continue;

    let date, description, amount;
    if (hasHeader && cols.date !== -1) {
      date = parseDate(cells[cols.date] || '');
      description = cells[cols.desc] ?? '';
      if (cols.amount !== -1) amount = parseAmount(cells[cols.amount]);
      if ((amount === null || amount === undefined) && cols.debit !== -1) {
        const debit = parseAmount(cells[cols.debit]);
        const credit = cols.credit !== -1 ? parseAmount(cells[cols.credit]) : null;
        if (debit !== null && debit !== 0) amount = -Math.abs(debit);
        else if (credit !== null) amount = Math.abs(credit);
      }
    } else {
      // Headerless (CBA style): date, amount, description[, balance]
      date = parseDate(cells[0]);
      amount = parseAmount(cells[1]);
      description = cells[2] ?? '';
      if (amount === null && cells.length >= 3) {
        // or: date, description, amount
        amount = parseAmount(cells[2]);
        description = cells[1] ?? '';
      }
    }

    if (!date || !description || amount === null || amount === undefined) continue;
    transactions.push({ date, description, amount });
  }

  if (!transactions.length) {
    warnings.push('No transactions recognised — expected columns like Date, Description, Amount (or Debit/Credit).');
  }
  transactions.sort((a, b) => a.date - b.date);
  return { transactions, warnings };
}
