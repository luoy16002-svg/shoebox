// The shoebox on disk. Everything lives in one folder the person already syncs from their phone:
//
//   Shoebox/Inbox/           new receipt photos go here
//   Shoebox/Filed/2026-10/Food & drink/2026-10-14 Bakery Ana 60000.jpg   (+ .json with what was read)
//   Shoebox/Check me/        receipts whose figures would not agree, each with a .txt saying what disagreed
//   Shoebox/Books/ledger.jsonl, expenses-2026-10.csv, summary-2026-10.html
//   Shoebox/Good morning.txt the two-line note the night shift leaves
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

export const CATEGORIES = ['Food & drink', 'Groceries', 'Transport', 'Office & supplies', 'Software & services',
  'Travel & lodging', 'Health', 'Other'] as const;

export type Entry = {
  source: string; filedAs: string; date: string; merchant: string | null; currency: string | null;
  total: number; category: string; flagged: boolean; issues: string[]; lines: number; readAt: string;
};

export const IMAGE = /\.(jpe?g|png|webp|heic|heif)$/i;

export const paths = (folder: string) => ({
  inbox: join(folder, 'Inbox'),
  filed: join(folder, 'Filed'),
  check: join(folder, 'Check me'),
  books: join(folder, 'Books'),
  ledger: join(folder, 'Books', 'ledger.jsonl'),
  note: join(folder, 'Good morning.txt'),
});

export function ensure(folder: string) {
  const p = paths(folder);
  for (const d of [p.inbox, p.filed, p.check, p.books]) mkdirSync(d, { recursive: true });
  return p;
}

export function loadLedger(folder: string): Entry[] {
  const p = paths(folder);
  if (!existsSync(p.ledger)) return [];
  return readFileSync(p.ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function addToLedger(folder: string, e: Entry) {
  appendFileSync(ensure(folder).ledger, JSON.stringify(e) + '\n');
}

export function inboxFiles(folder: string): string[] {
  const p = ensure(folder);
  return readdirSync(p.inbox).filter((f) => IMAGE.test(f)).sort().map((f) => join(p.inbox, f));
}

/** A receipt's date as YYYY-MM-DD: the printed one when it can be read, else the photo's own time. */
export function receiptDate(printed: string | null, file: string): string {
  if (printed) {
    const s = printed.trim();
    let m = s.match(/(20\d\d)[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = s.match(/(\d{1,2})[-/.](\d{1,2})[-/.](20\d\d|\d\d)\b/);
    if (m) {
      const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
      const a = +m[1];
      const b = +m[2];
      // day first unless that is impossible (most of the world writes 14/10/2026)
      if (a > 12) return iso(y, b, a);
      if (b > 12) return iso(y, a, b);
      return iso(y, b, a);
    }
  }
  return new Date(statSync(file).mtimeMs).toISOString().slice(0, 10);
}

const iso = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : `${y}-01-01`;

export const safeName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

export function uniquePath(dir: string, stem: string, ext: string): string {
  let p = join(dir, `${stem}${ext}`);
  for (let i = 2; existsSync(p); i++) p = join(dir, `${stem} (${i})${ext}`);
  return p;
}

const money = (v: number, cur: string | null) =>
  `${cur ? cur + ' ' : ''}${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** The month's sheet (CSV for any spreadsheet) and a one-page summary to read or print. */
export function writeBooks(folder: string, month: string): { csv: string; html: string; total: number; currency: string | null } {
  const p = ensure(folder);
  const rows = loadLedger(folder).filter((e) => e.date.startsWith(month));
  const ok = rows.filter((e) => !e.flagged);
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['date,shop,category,total,currency,file', ...ok.map((e) =>
    [e.date, q(e.merchant), q(e.category), e.total, e.currency ?? '', q(e.filedAs)].join(','))].join('\n') + '\n';
  const csvPath = join(p.books, `expenses-${month}.csv`);
  writeFileSync(csvPath, csv);
  const total = ok.reduce((a, e) => a + e.total, 0);
  const currency = ok.find((e) => e.currency)?.currency ?? null;
  const byCat: Record<string, number> = {};
  for (const e of ok) byCat[e.category] = (byCat[e.category] ?? 0) + e.total;
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const waiting = rows.filter((e) => e.flagged);
  const monthName = new Date(`${month}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Expenses, ${esc(monthName)}</title>
<style>
:root{--paper:#f6f1e6;--ink:#2b2621;--faint:#8c8275;--rule:#d9cfbd;--red:#a3402a;--green:#3d6b4a}
*{box-sizing:border-box}body{margin:0;background:#e9e2d3;color:var(--ink);font:16px/1.5 Georgia,"Times New Roman",serif}
main{max-width:760px;margin:32px auto;padding:40px 48px 48px;background:var(--paper);
  box-shadow:0 1px 0 #cfc5b3,0 18px 40px -24px rgba(60,45,25,.45)}
h1{font-weight:normal;font-size:30px;margin:0 0 2px;letter-spacing:.01em}.sub{color:var(--faint);margin:0 0 28px;font-style:italic}
.sum{display:flex;gap:40px;margin:0 0 30px;align-items:baseline;flex-wrap:wrap}.big{font-size:34px;font-variant-numeric:tabular-nums}
.label{color:var(--faint);font-size:13px;letter-spacing:.08em;text-transform:uppercase;display:block}
.wait{color:var(--red)}h2{font-weight:normal;font-size:19px;margin:30px 0 6px;border-bottom:2px solid var(--ink);padding-bottom:2px}
table{border-collapse:collapse;width:100%}td{padding:5px 6px;border-bottom:1px solid var(--rule);vertical-align:top}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}td.d{white-space:nowrap;color:var(--faint);width:7em}
tr.total td{border-top:1px solid var(--ink);border-bottom:3px double var(--ink);font-weight:bold}
.why{color:var(--red);font-size:14px}.tick{color:var(--green)}
@media (max-width:600px){main{margin:0;padding:24px 16px}.big{font-size:26px}td.d{width:auto}}
</style>
<main>
<h1>Expenses, ${esc(monthName)}</h1>
<p class="sub">Filed by Shoebox overnight. Every total below was confirmed by other figures on its receipt.</p>
<div class="sum"><div><span class="label">Spent</span><span class="big">${esc(money(total, currency))}</span></div>
<div><span class="label">Receipts filed</span><span class="big">${ok.length}</span></div>
${waiting.length ? `<div><span class="label">Waiting in “Check me”</span><span class="big wait">${waiting.length}</span></div>` : ''}</div>
<h2>By category</h2>
<table>${cats.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${esc(money(v, currency))}</td></tr>`).join('')}
<tr class="total"><td>Total</td><td class="n">${esc(money(total, currency))}</td></tr></table>
<h2>Receipts</h2>
<table>${ok.sort((a, b) => a.date.localeCompare(b.date)).map((e) => `<tr><td class="d">${esc(e.date)}</td><td>${esc(e.merchant ?? 'Unnamed shop')}</td><td>${esc(e.category)}</td><td class="n">${esc(money(e.total, e.currency))}</td></tr>`).join('')}</table>
${waiting.length ? `<h2>Waiting in “Check me”</h2><table>${waiting.map((e) => `<tr><td class="d">${esc(e.date)}</td><td>${esc(e.merchant ?? 'Unnamed shop')}<div class="why">${esc(e.issues.join('; '))}</div></td><td class="n">${esc(money(e.total, e.currency))}</td></tr>`).join('')}</table>` : ''}
</main></html>`;
  const htmlPath = join(p.books, `summary-${month}.html`);
  writeFileSync(htmlPath, html);
  return { csv: csvPath, html: htmlPath, total, currency };
}

export { basename, extname };
