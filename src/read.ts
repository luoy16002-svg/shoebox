// Reading a receipt photo with an open-weight vision model on this computer (Gemma 4 through llama.cpp's
// OpenAI-compatible server by default). The model copies; the arithmetic in receipt.ts decides.
//
// First look: the whole receipt, everything printed on it. If the figures disagree, a second look at the bottom of
// the receipt only (where the totals are), enlarged, asking for the totals block alone. The better-agreeing reading
// wins; a receipt that still disagrees is returned with its issues so it can be flagged rather than guessed.

import sharp from 'sharp';
import { check, COPY_SCHEMA, TOTALS_SCHEMA, type Check, type Copied } from './receipt.ts';

export const MODEL_URL = process.env.SHOEBOX_MODEL_URL ?? 'http://127.0.0.1:8181/v1';
export const MODEL = process.env.SHOEBOX_MODEL ?? 'gemma-4-e4b';

const COPY_PROMPT = `You are reading a photo of a shop receipt. Copy what is printed; never calculate or guess.
- merchant: the shop's name as printed at the top (null if none).
- date: the purchase date as printed (null if none).
- currency: the currency code if you can tell (IDR, USD, EUR, JPY, ...), else null.
- items: every purchased line, top to bottom. name as printed, qty as printed (null if none), amount = the money on
  the right of that line, copied exactly as printed with its separators (for example "60.000" or "12.50").
- subtotal, discount, tax, service, total, paid (cash or card tendered), change: copy each amount exactly as printed,
  or null when that line is not on the receipt.
Answer with the JSON object only.`;

const TOTALS_PROMPT = `This is the bottom part of a shop receipt, enlarged. Copy the money lines exactly as printed,
with their separators (for example "60.000" or "12.50"): subtotal, discount, tax, service, total (the amount due),
paid (cash or card tendered) and change. Use null for any line that is not printed. Never calculate.
Answer with the JSON object only.`;

export type Reading = { copied: Copied; check: Check; looks: number; seconds: number; tokens: number };

async function prepare(file: string | Buffer, crop?: { top: number }): Promise<string> {
  let img = sharp(file).rotate();
  const meta = await img.metadata();
  const w = meta.width ?? 1000;
  const h = meta.height ?? 1000;
  if (crop) {
    const top = Math.round(h * crop.top);
    img = sharp(await img.toBuffer()).extract({ left: 0, top, width: w, height: h - top });
    img = img.resize({ width: Math.max(1024, Math.min(w, 1600)), withoutEnlargement: false });
  } else {
    img = img.resize({ width: 1280, height: 1600, fit: 'inside', withoutEnlargement: true });
  }
  const buf = await img.jpeg({ quality: 90 }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function ask(prompt: string, image: string, schema: object, maxTokens = 1400): Promise<{ json: any; tokens: number }> {
  const res = await fetch(`${MODEL_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: 'json_schema', json_schema: { name: 'receipt', schema } },
      messages: [
        { role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: prompt }] },
      ],
    }),
  });
  if (!res.ok) throw new Error(`model server ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body: any = await res.json();
  const text: string = body.choices?.[0]?.message?.content ?? '';
  const tokens = body.usage?.completion_tokens ?? 0;
  try {
    return { json: JSON.parse(text), tokens };
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`the model did not answer with JSON: ${text.slice(0, 200)}`);
    return { json: JSON.parse(m[0]), tokens };
  }
}

function normalise(j: any): Copied {
  const s = (v: unknown) => (v == null || v === '' ? null : String(v));
  return {
    merchant: s(j.merchant),
    date: s(j.date),
    currency: s(j.currency),
    items: Array.isArray(j.items)
      ? j.items.map((l: any) => ({ name: String(l?.name ?? ''), qty: s(l?.qty), amount: s(l?.amount) }))
      : [],
    subtotal: s(j.subtotal),
    discount: s(j.discount),
    tax: s(j.tax),
    service: s(j.service),
    total: s(j.total),
    paid: s(j.paid),
    change: s(j.change),
  };
}

const score = (c: Check) => (c.ok ? 100 : 0) + c.agreed.length * 10 - c.issues.length;

/** Read one receipt: a first look, and a closer look at the totals when the figures disagree. */
export async function readReceipt(file: string | Buffer, opts: { secondLook?: boolean } = {}): Promise<Reading> {
  const t0 = Date.now();
  const first = await ask(COPY_PROMPT, await prepare(file), COPY_SCHEMA);
  let copied = normalise(first.json);
  let result = check(copied);
  let looks = 1;
  let tokens = first.tokens;
  if (!result.ok && opts.secondLook !== false) {
    const second = await ask(TOTALS_PROMPT, await prepare(file, { top: 0.45 }), TOTALS_SCHEMA, 400);
    looks = 2;
    tokens += second.tokens;
    const merged: Copied = { ...copied, ...normalise({ ...copied, ...second.json, items: copied.items }) };
    merged.items = copied.items;
    const c2 = check(merged);
    if (score(c2) > score(result)) {
      copied = merged;
      result = c2;
    }
  }
  return { copied, check: result, looks, seconds: (Date.now() - t0) / 1000, tokens };
}
