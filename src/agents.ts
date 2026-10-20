// The two Mastra agents, both running on the local open-weight model:
// - the filing clerk puts a receipt in a category (structured output, one of a fixed list);
// - the bookkeeper answers questions about the books in plain words, using tools that read the ledger, so its
//   numbers come from the ledger and never from the model's head.
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { CATEGORIES, loadLedger, type Entry } from './ledger.ts';
import { MODEL, MODEL_URL } from './read.ts';

const model = { providerId: 'llamacpp', modelId: MODEL, url: MODEL_URL, apiKey: 'local' };

export const filingClerk = new Agent({
  id: 'filing-clerk',
  name: 'Filing clerk',
  instructions:
    'You file receipts for a freelancer\'s expense records. Given the shop name and the lines on a receipt, pick the ' +
    'one category it belongs to. Restaurants, cafes and takeaway are "Food & drink"; supermarkets and markets are ' +
    '"Groceries"; taxis, fuel, parking and tickets are "Transport". When unsure, choose "Other".',
  model,
});

export async function categorize(merchant: string | null, items: string[]): Promise<string> {
  const r = await filingClerk.generate(
    `Shop: ${merchant ?? 'unknown'}\nLines: ${items.slice(0, 12).join('; ') || 'none readable'}`,
    { structuredOutput: { schema: z.object({ category: z.enum(CATEGORIES) }) } },
  );
  return (r.object as { category: string } | undefined)?.category ?? 'Other';
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z]+/g, ' ').trim();

/** The category the person meant ("food and drink", "Food & Drink", "food") among the eight, or the text itself. */
function sameCategory(asked: string, filed: string): boolean {
  const a = norm(asked);
  const b = norm(filed);
  return a === b || b.startsWith(a) || a.startsWith(b);
}

/** A month as YYYY-MM from "2026-10", "October 2026", "Oct 2026" or "this month". */
function monthOf(asked: string | undefined): string | undefined {
  if (!asked) return undefined;
  const s = asked.trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/this month|current month/i.test(s)) return new Date().toISOString().slice(0, 7);
  const d = new Date(`1 ${s.replace(/^this\s+/i, '')}`);
  return Number.isNaN(d.getTime()) ? s : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const pick = (e: Entry) => ({ date: e.date, merchant: e.merchant, category: e.category, total: e.total,
  currency: e.currency, file: e.filedAs });

export function bookkeeper(folder: string) {
  const expenses = createTool({
    id: 'list-expenses',
    description: `List filed receipts, optionally only one month (YYYY-MM), one category (${CATEGORIES.join(', ')}) or shops whose name contains a word.`,
    inputSchema: z.object({ month: z.string().optional(), category: z.string().optional(), shop: z.string().optional() }),
    execute: async ({ month, category, shop }) => {
      const rows = loadLedger(folder).filter((e) => !e.flagged)
        .filter((e) => !month || e.date.startsWith(monthOf(month)!))
        .filter((e) => !category || sameCategory(category, e.category))
        .filter((e) => !shop || (e.merchant ?? '').toLowerCase().includes(shop.toLowerCase()));
      return { count: rows.length, receipts: rows.slice(0, 40).map(pick) };
    },
  });
  const totals = createTool({
    id: 'totals',
    description: `Add up filed receipts for a month (YYYY-MM), grouped by category (${CATEGORIES.join(', ')}) or by shop.`,
    inputSchema: z.object({ month: z.string(), by: z.enum(['category', 'shop']).default('category') }),
    execute: async ({ month, by }) => {
      const sums: Record<string, number> = {};
      let currency = '';
      for (const e of loadLedger(folder)) {
        if (e.flagged || !e.date.startsWith(monthOf(month)!)) continue;
        const k = by === 'shop' ? (e.merchant ?? 'unknown') : e.category;
        sums[k] = (sums[k] ?? 0) + e.total;
        currency = e.currency ?? currency;
      }
      const all = Object.values(sums).reduce((a, b) => a + b, 0);
      return { month, currency, total: all, groups: sums };
    },
  });
  const waiting = createTool({
    id: 'needs-a-look',
    description: 'Receipts the night shift could not make add up, with what disagreed.',
    inputSchema: z.object({}),
    execute: async () => ({ receipts: loadLedger(folder).filter((e) => e.flagged).map((e) => ({ file: e.filedAs, why: e.issues })) }),
  });
  return new Agent({
    id: 'bookkeeper',
    name: 'Bookkeeper',
    instructions:
      'You answer questions about a person\'s receipts. Always use the tools to get numbers; never invent or estimate ' +
      'an amount. Answer in one or two short sentences. Write amounts with thousands separators (12,500) and put the ' +
      'currency code before them when the tool gives one; when it gives none, leave the currency out. Today is ' +
      new Date().toISOString().slice(0, 10) + '.',
    model,
    tools: { expenses, totals, waiting },
  });
}
