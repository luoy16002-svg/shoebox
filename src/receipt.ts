// A receipt as the model copied it, and the arithmetic that decides whether to believe it.
//
// The model only copies what is printed (amounts as strings, separators and all). Code turns the strings into
// numbers and checks that the printed figures agree with each other: lines against the subtotal, the subtotal with
// discount, tax and service against the total, and cash paid minus change against the total. A receipt whose figures
// agree is filed; one whose figures disagree gets a second, closer look, and if they still disagree it is flagged
// for a human instead of being guessed at.

export type Line = { name: string; qty: string | null; amount: string | null };

export type Copied = {
  merchant: string | null;
  date: string | null;
  currency: string | null;
  items: Line[];
  subtotal: string | null;
  discount: string | null;
  tax: string | null;
  service: string | null;
  total: string | null;
  paid: string | null;
  change: string | null;
};

export type Check = {
  ok: boolean;          // the total is confirmed by figures printed elsewhere on the receipt
  agreed: string[];     // the cross-checks that held
  issues: string[];     // figures that disagree (a receipt is flagged only when nothing confirms its total)
};

// Lines that are not purchases: totals, payment and change copied into the item list by mistake.
const NOT_AN_ITEM = /^(sub\s*-?\s*total|total|tl|ttl|grand\s*total|cash|tunai|change|kembali(an)?|cg|kembalian|card|debit|credit|bayar|pay(ment)?|tax|ppn|pb1|service|disc(ount)?|diskon|amount\s*due|balance)\b/i;

/** An amount as printed ("60.000", "Rp 45,500", "1.234,56", "-12.50") as a number, or null. */
export function amount(text: string | null | undefined): number | null {
  if (text == null) return null;
  let s = String(text).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || /^-|-$/.test(s.replace(/[^\d.,()-]/g, ''));
  s = s.replace(/[^\d.,]/g, '').replace(/^[.,]+|[.,]+$/g, ''); // "Rp. 91,000": the dot after Rp is not a separator
  if (!/\d/.test(s)) return null;
  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  let decimal: string | null = null;
  if (dots && commas) decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  else if (dots + commas === 1) {
    const sep = dots ? '.' : ',';
    const tail = s.length - s.lastIndexOf(sep) - 1;
    decimal = tail === 3 ? null : sep; // "60.000" groups thousands; "12.50" has cents
  } else decimal = null; // "1.250.000": every separator groups thousands
  let digits = s;
  if (decimal) {
    const i = s.lastIndexOf(decimal);
    digits = s.slice(0, i).replace(/[.,]/g, '') + '.' + s.slice(i + 1).replace(/[.,]/g, '');
  } else digits = s.replace(/[.,]/g, '');
  const v = Number(digits);
  if (!Number.isFinite(v)) return null;
  return negative ? -v : v;
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);

/** The purchase lines, without totals or payment lines the model copied into the list. */
export function purchases(r: Copied): Line[] {
  return r.items.filter((l) => !NOT_AN_ITEM.test(l.name.trim()));
}

/** Is the total confirmed by the other printed figures? Every cross-check that can be made is made. */
export function check(r: Copied): Check {
  const agreed: string[] = [];
  const issues: string[] = [];
  const total = amount(r.total);
  const sub = amount(r.subtotal);
  const disc = Math.abs(amount(r.discount) ?? 0);
  const tax = amount(r.tax) ?? 0;
  const svc = amount(r.service) ?? 0;
  const paid = amount(r.paid);
  const change = amount(r.change) ?? 0;
  const lines = purchases(r);
  const vals = lines.map((l) => amount(l.amount)).filter((v): v is number => v != null);
  const linesSum = vals.reduce((a, b) => a + b, 0);
  // some receipts print the unit price on the line: quantity times it is the line's amount
  const qtySum = lines.reduce((a, l) => {
    const v = amount(l.amount);
    const q = Number(String(l.qty ?? '1').replace(/[^\d.]/g, '')) || 1;
    return v == null ? a : a + v * q;
  }, 0);
  const sums = vals.length ? [linesSum, qtySum] : [];
  if (total == null || total <= 0) issues.push('no total could be read');
  if (vals.length && sub != null) {
    if (sums.some((s) => close(s, sub) || close(s - disc, sub))) agreed.push('lines = subtotal');
    else issues.push(`lines add up to ${fmt(linesSum)} but the subtotal reads ${fmt(sub)}`);
  }
  if (total != null && sub != null) {
    const options = [sub - disc + tax + svc, sub - disc + svc, sub + tax + svc, sub - disc, sub + tax, sub];
    if (options.some((o) => close(o, total))) agreed.push('subtotal = total');
    else issues.push(`the subtotal ${fmt(sub)} with discount, tax and service does not make the total ${fmt(total)}`);
  }
  if (total != null && sums.length) {
    const options = sums.flatMap((s) => [s - disc + tax + svc, s - disc + svc, s + tax + svc, s + tax, s]);
    if (options.some((o) => close(o, total))) agreed.push('lines = total');
    else if (sub == null) issues.push(`lines add up to ${fmt(linesSum)} but the total reads ${fmt(total)}`);
  }
  if (total != null && paid != null && paid > 0) {
    if (close(paid - change, total)) agreed.push(change ? 'paid - change = total' : 'paid = total');
    else issues.push(`paid ${fmt(paid)} minus change ${fmt(change)} is not the total ${fmt(total)}`);
  }
  // Cash handed over minus change is the strongest proof: two figures printed apart from the total, rarely misread
  // into agreement. When it is printed it decides; otherwise the lines or the subtotal must confirm the total.
  const cash = total != null && paid != null && paid > 0 ? (close(paid - change, total) ? 'agree' : 'disagree') : 'none';
  const other = agreed.includes('subtotal = total') || agreed.includes('lines = total');
  return { ok: total != null && total > 0 && (cash === 'agree' || (cash === 'none' && other)), agreed, issues };
}

export const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** The JSON schema the model's answer must follow (llama.cpp turns it into a grammar). */
export const COPY_SCHEMA = {
  type: 'object',
  properties: {
    merchant: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] },
    currency: { type: ['string', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, qty: { type: ['string', 'null'] }, amount: { type: ['string', 'null'] } },
        required: ['name', 'qty', 'amount'],
      },
    },
    subtotal: { type: ['string', 'null'] },
    discount: { type: ['string', 'null'] },
    tax: { type: ['string', 'null'] },
    service: { type: ['string', 'null'] },
    total: { type: ['string', 'null'] },
    paid: { type: ['string', 'null'] },
    change: { type: ['string', 'null'] },
  },
  required: ['merchant', 'date', 'currency', 'items', 'subtotal', 'discount', 'tax', 'service', 'total', 'paid', 'change'],
} as const;

export const TOTALS_SCHEMA = {
  type: 'object',
  properties: {
    subtotal: { type: ['string', 'null'] },
    discount: { type: ['string', 'null'] },
    tax: { type: ['string', 'null'] },
    service: { type: ['string', 'null'] },
    total: { type: ['string', 'null'] },
    paid: { type: ['string', 'null'] },
    change: { type: ['string', 'null'] },
  },
  required: ['subtotal', 'discount', 'tax', 'service', 'total', 'paid', 'change'],
} as const;

export const TOTAL_FIELDS = ['subtotal', 'discount', 'tax', 'service', 'total', 'paid', 'change'] as const;
export type Totals = Pick<Copied, (typeof TOTAL_FIELDS)[number]>;

const cashAgrees = (c: Check) => c.agreed.includes('paid - change = total') || c.agreed.includes('paid = total');

/**
 * Two independent readings of the same receipt: the whole receipt, and its totals block alone, enlarged. Like
 * double entry, the total must come out the same both times. When it does, the readings are merged (a line one
 * look missed is taken from the other) and the arithmetic decides as usual. When it does not, a reading is used only
 * if cash and change confirm its total; otherwise the receipt goes to a human.
 */
export function reconcile(first: Copied, second: Totals): { copied: Copied; check: Check } {
  const t1 = amount(first.total);
  const t2 = amount(second.total);
  // the first look with the gaps filled from the second, and the first look's lines with the second look's totals
  const filled: Copied = { ...first };
  for (const k of TOTAL_FIELDS) if (filled[k] == null && second[k] != null) filled[k] = second[k];
  const theirs: Copied = { ...filled };
  for (const k of TOTAL_FIELDS) if (second[k] != null) theirs[k] = second[k];
  if (t1 != null && t2 != null && close(t1, t2)) {
    // read twice: the total stands if either look's figures confirm it
    const options = [filled, theirs].map((c) => ({ copied: c, check: check(c) }));
    const best = options.find((o) => o.check.ok) ?? options[0];
    return { copied: best.copied, check: { ...best.check, agreed: ['read twice', ...best.check.agreed] } };
  }
  if ((t1 == null) !== (t2 == null)) {
    // one look found no total: nothing contradicts the other, but with a single reading only cash and change may confirm it
    const c = check(filled);
    const ok = c.ok && cashAgrees(c);
    return { copied: filled, check: { ...c, ok, issues: ok ? c.issues : ['the total was read only once and cash and change do not confirm it', ...c.issues] } };
  }
  // the looks disagree: cash and change may settle it, but only if both looks read the cash and the change the same
  const same = (a: string | null, b: string | null) => {
    const x = amount(a);
    const y = amount(b);
    return (x == null && y == null) || (x != null && y != null && close(x, y));
  };
  const cashSeenTwice = amount(first.paid) != null && same(first.paid, second.paid) && same(first.change, second.change);
  const c1 = check(first);
  const c2 = check(theirs);
  const pick = !cashSeenTwice ? 0 : cashAgrees(c1) && !cashAgrees(c2) ? 1 : cashAgrees(c2) && !cashAgrees(c1) ? 2 : 0;
  const note = `the two readings of the total disagree (${t1 == null ? 'none' : fmt(t1)} and ${t2 == null ? 'none' : fmt(t2)})`;
  if (pick === 1) return { copied: first, check: { ...c1, issues: [note + '; cash and change settled it', ...c1.issues] } };
  if (pick === 2) return { copied: theirs, check: { ...c2, issues: [note + '; cash and change settled it', ...c2.issues] } };
  const base = c1.agreed.length >= c2.agreed.length ? { copied: first, c: c1 } : { copied: theirs, c: c2 };
  return { copied: base.copied, check: { ok: false, agreed: base.c.agreed, issues: [note, ...base.c.issues] } };
}

const SIGNS: [RegExp, string][] = [[/\bRp\b|Rp\.?\s?\d|IDR/i, 'IDR'], [/US\$|\bUSD\b|^\s*\$/i, 'USD'], [/€|\bEUR\b/i, 'EUR'],
  [/£|\bGBP\b/i, 'GBP'], [/¥|\bJPY\b|\bRMB\b|\bCNY\b/i, 'JPY/CNY'], [/₹|\bINR\b|\bRs\.?/i, 'INR'], [/\bRM\s?\d|\bMYR\b/i, 'MYR'],
  [/S\$|\bSGD\b/i, 'SGD'], [/₱|\bPHP\b/i, 'PHP'], [/฿|\bTHB\b/i, 'THB'], [/₫|\bVND\b/i, 'VND']];

/** The currency a receipt is in: what the model said, else the sign printed beside the amounts, else null. */
export function currencyOf(r: Copied): string | null {
  if (r.currency && /^[A-Z]{3}$/.test(r.currency.trim())) return r.currency.trim();
  const texts = [r.total, r.subtotal, r.paid, r.change, r.currency, ...r.items.map((l) => l.amount)].filter(Boolean).join(' ');
  for (const [re, code] of SIGNS) if (re.test(texts)) return code;
  return null;
}
