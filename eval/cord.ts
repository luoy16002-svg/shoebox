// Score the reader on the CORD v2 test receipts (CC BY 4.0, naver-clova-ix/cord-v2): is the total right, and is
// every wrong total flagged by the arithmetic? Resumable: results append to out/eval-cord.jsonl.
//
//   npx tsx eval/cord.ts [--limit N] [--no-second-look]
import { existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { readReceipt } from '../src/read.ts';
import { amount } from '../src/receipt.ts';

const DIR = '.data/cord';
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'out/eval-cord.jsonl';
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 1000;
mkdirSync('out', { recursive: true });
const done = new Set(existsSync(OUT) ? readFileSync(OUT, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
const ids = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, 3)).slice(0, limit);
for (const id of ids) {
  if (done.has(id)) continue;
  const gt = JSON.parse(readFileSync(join(DIR, `${id}.json`), 'utf8'));
  const want = amount(gt.total?.total_price ?? null);
  if (want == null) continue;
  const img = join(DIR, `${id}.png`);
  try {
    const r = await readReceipt(img);
    const got = amount(r.copied.total);
    const row = { id, want, got, right: got != null && Math.abs(got - want) < 0.5, ok: r.check.ok, looks: r.looks,
      seconds: r.seconds, tokens: r.tokens, issues: r.check.issues, agreed: r.check.agreed, merchant: r.copied.merchant,
      items: r.copied.items.length, copied: r.copied, firstLook: r.firstLook, totalsLook: r.totalsLook };
    appendFileSync(OUT, JSON.stringify(row) + '\n');
    console.log(`${id} want ${want} got ${got} ${row.right ? 'RIGHT' : 'wrong'} ${r.check.ok ? 'agrees' : 'FLAGGED'} ${r.looks} look(s) ${r.seconds.toFixed(1)}s`);
  } catch (e) {
    console.log(`${id} error ${(e as Error).message}`);
  }
}
const rows = readFileSync(OUT, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const n = rows.length;
const right = rows.filter((r) => r.right).length;
const okRight = rows.filter((r) => r.ok && r.right).length;
const okWrong = rows.filter((r) => r.ok && !r.right).length;
const flagged = rows.filter((r) => !r.ok).length;
const secs = rows.reduce((a, r) => a + r.seconds, 0) / Math.max(n, 1);
console.log(`\n${n} receipts: total right ${right} (${((100 * right) / n).toFixed(1)}%); filed as agreeing ${okRight + okWrong}, ` +
  `of which wrong ${okWrong}; flagged for a human ${flagged}; ${secs.toFixed(1)} s per receipt`);
