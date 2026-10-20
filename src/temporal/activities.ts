// The night shift's steps that touch the world. Each one is safe to run again: reading is read-only, and filing
// checks the ledger first, so a retry after a crash never files a receipt twice.
import { Context } from '@temporalio/activity';
import { copyFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { categorize as clerk } from '../agents.ts';
import { addToLedger, ensure, inboxFiles, loadLedger, receiptDate, safeName, uniquePath, writeBooks } from '../ledger.ts';
import { readReceipt, type Reading } from '../read.ts';
import { amount, currencyOf, type Copied } from '../receipt.ts';

export type Filed = { file: string; filedAs: string; flagged: boolean; total: number | null; category: string };

export async function listNew(folder: string): Promise<string[]> {
  const seen = new Set(loadLedger(folder).map((e) => e.source));
  return inboxFiles(folder).filter((f) => !seen.has(basename(f)));
}

export async function readReceiptActivity(file: string): Promise<Reading> {
  const ctx = Context.current();
  const beat = setInterval(() => ctx.heartbeat({ file: basename(file) }), 10_000);
  try {
    return await readReceipt(file);
  } finally {
    clearInterval(beat);
  }
}

export async function categorize(copied: Copied): Promise<string> {
  return clerk(copied.merchant, copied.items.map((l) => l.name));
}

export async function fileIt(folder: string, file: string, reading: Reading, category: string): Promise<Filed> {
  const done = loadLedger(folder).find((e) => e.source === basename(file));
  if (done) return { file, filedAs: done.filedAs, flagged: done.flagged, total: done.total, category: done.category };
  const p = ensure(folder);
  const c = reading.copied;
  const total = amount(c.total);
  const date = receiptDate(c.date, file);
  const ext = extname(file).toLowerCase();
  const shop = safeName(c.merchant ?? 'Unknown shop');
  const flagged = !reading.check.ok;
  const dir = flagged ? p.check : join(p.filed, date.slice(0, 7), category);
  ensure(folder);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  const stem = `${date} ${shop}${total != null ? ' ' + total : ''}`;
  const target = uniquePath(dir, stem, ext);
  try {
    renameSync(file, target);
  } catch {
    copyFileSync(file, target);
  }
  writeFileSync(target.slice(0, -ext.length) + '.json', JSON.stringify(reading, null, 2));
  if (flagged) {
    writeFileSync(target.slice(0, -ext.length) + '.txt',
      `The figures on this receipt did not agree, so it was not filed:\n- ${reading.check.issues.join('\n- ')}\n\n` +
      'Retake the photo (flat, the whole receipt, the totals sharp), or file it by hand.\n');
  }
  addToLedger(folder, { source: basename(file), filedAs: target, date, merchant: c.merchant, currency: currencyOf(c) ?? (process.env.SHOEBOX_CURRENCY || null),
    total: total ?? 0, category, flagged, issues: reading.check.issues, lines: c.items.length, readAt: new Date().toISOString() });
  return { file, filedAs: target, flagged, total, category };
}

export async function closeBooks(folder: string, counts: { filed: number; flagged: number; failed: number }): Promise<string> {
  const month = new Date().toISOString().slice(0, 7);
  const months = new Set(loadLedger(folder).map((e) => e.date.slice(0, 7)));
  months.add(month);
  let line2 = '';
  for (const m of months) {
    const b = writeBooks(folder, m);
    if (m === month) line2 = `This month so far: ${b.currency ? b.currency + ' ' : ''}${b.total.toLocaleString('en-US')} (Books/expenses-${m}.csv).`;
  }
  const line1 = counts.filed + counts.flagged + counts.failed === 0
    ? 'Nothing new in the shoebox last night.'
    : `Filed ${counts.filed} receipt${counts.filed === 1 ? '' : 's'} overnight` +
      (counts.flagged ? `; ${counts.flagged} would not add up and wait in “Check me”` : '') +
      (counts.failed ? `; ${counts.failed} could not be read and stay in the Inbox for tonight` : '') + '.';
  const note = `${line1}\n${line2}\n`;
  writeFileSync(ensure(folder).note, note);
  return note;
}
