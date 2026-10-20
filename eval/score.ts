// Re-score saved readings with the current parser and check (no model runs), and write eval/RESULTS.md.
//
//   npx tsx eval/score.ts [out/eval-cord.jsonl]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { amount, check, fmt, reconcile } from '../src/receipt.ts';

const file = process.argv[2] ?? 'out/eval-cord.jsonl';
const byId = new Map<string, any>();
for (const l of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l);
  if (!r.copied) continue; // rows from runs that did not keep the reading
  byId.set(r.id, r);
}
const rows = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)).map((r) => {
  const gt = JSON.parse(readFileSync(join('.data/cord', `${r.id}.json`), 'utf8'));
  const want = amount(gt.total?.total_price ?? null);
  const decided = r.firstLook && r.totalsLook ? reconcile(r.firstLook, r.totalsLook) : { copied: r.copied, check: check(r.copied) };
  const got = amount(decided.copied.total);
  const c = decided.check;
  return { id: r.id, want, got, right: want != null && got != null && Math.abs(got - want) < 0.5, ok: c.ok, issues: c.issues,
    agreed: c.agreed, looks: r.looks, seconds: r.seconds, tokens: r.tokens };
}).filter((r) => r.want != null);

const n = rows.length;
const right = rows.filter((r) => r.right).length;
const filed = rows.filter((r) => r.ok);
const filedWrong = filed.filter((r) => !r.right);
const flagged = rows.filter((r) => !r.ok);
const flaggedRight = flagged.filter((r) => r.right);
const twice = rows.filter((r) => r.agreed.includes('read twice')).length;
const secs = rows.map((r) => r.seconds).sort((a, b) => a - b);
const median = secs[Math.floor(secs.length / 2)] ?? 0;
const mean = secs.reduce((a, b) => a + b, 0) / Math.max(n, 1);
const pct = (k: number) => `${((100 * k) / Math.max(n, 1)).toFixed(1)}%`;

const md = `# Shoebox on the CORD v2 test receipts

${n} receipts from the CORD v2 test split that have a printed total (CC BY 4.0,
[naver-clova-ix/cord-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2)), read by Gemma 4 E4B (Q4_0, llama.cpp,
CPU only, thinking off). Every receipt is read twice (whole, then the totals block enlarged). Reproduce: \`npx tsx eval/cord.ts\`, then \`npx tsx eval/score.ts\`.

| | receipts | |
|---|---|---|
| Total read correctly | ${right} | ${pct(right)} |
| Filed (total confirmed by other printed figures) | ${filed.length} | ${pct(filed.length)} |
| Filed with a wrong total | ${filedWrong.length} | ${pct(filedWrong.length)} |
| Set aside for a human ("Check me") | ${flagged.length} | ${pct(flagged.length)} |
| ... of which the total was in fact right | ${flaggedRight.length} | |
| Both looks read the same total | ${twice} | ${pct(twice)} |

Time per receipt on a Ryzen 7 9800X3D (6 threads, no GPU): median ${median.toFixed(0)} s, mean ${mean.toFixed(0)} s.

## Every receipt that was not filed, or was filed wrong

| id | true total | read | filed | what disagreed |
|---|---|---|---|---|
${rows.filter((r) => !r.ok || !r.right).map((r) => `| ${r.id} | ${fmt(r.want!)} | ${r.got == null ? '-' : fmt(r.got)} | ${r.ok ? 'yes' : 'no'} | ${r.issues.join('; ') || '-'} |`).join('\n')}
`;
writeFileSync('eval/RESULTS.md', md);
console.log(md.split('\n').slice(0, 16).join('\n'));
