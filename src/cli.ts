// shoebox: a receipts shoebox that empties itself overnight.
//
//   shoebox start [FOLDER] [--at 02:00]   run the night shift every night (starts a local Temporal server and the worker)
//   shoebox now [FOLDER]                  run a shift right away (the start command must be running)
//   shoebox ask [FOLDER] "QUESTION"       ask the bookkeeper: "how much did I spend on food in October?"
//   shoebox read IMAGE                    read one receipt and show what was copied and whether it adds up
//   shoebox books [FOLDER] [YYYY-MM]      write the month's sheet and summary again
//
// FOLDER defaults to ~/Shoebox. The model is any OpenAI-compatible server with a vision model (SHOEBOX_MODEL_URL,
// default http://127.0.0.1:8181/v1, model SHOEBOX_MODEL, default gemma-4-e4b): llama.cpp, LM Studio or Ollama.
import { Client, Connection } from '@temporalio/client';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { bookkeeper } from './agents.ts';
import { ensure, writeBooks } from './ledger.ts';
import { MODEL_URL, readReceipt } from './read.ts';
import { amount, fmt } from './receipt.ts';
import { runWorker, TASK_QUEUE } from './temporal/worker.ts';

const TEMPORAL = process.env.SHOEBOX_TEMPORAL ?? 'localhost:7233';
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const positional = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')));
const folderArg = (i = 0) => resolve(positional[i] ?? join(homedir(), 'Shoebox'));

function reachable(hostport: string): Promise<boolean> {
  const [host, port] = hostport.split(':');
  return new Promise((ok) => {
    const s = connect({ host, port: Number(port) }, () => { s.end(); ok(true); });
    s.on('error', () => ok(false));
    s.setTimeout(1500, () => { s.destroy(); ok(false); });
  });
}

async function ensureTemporal(folder: string) {
  if (await reachable(TEMPORAL)) return;
  const bin = process.env.SHOEBOX_TEMPORAL_BIN ?? (existsSync(join('.tools', 'temporal.exe')) ? join('.tools', 'temporal.exe') : 'temporal');
  const state = join(homedir(), '.shoebox');
  mkdirSync(state, { recursive: true });
  const child = spawn(bin, ['server', 'start-dev', '--db-filename', join(state, 'temporal.db'), '--ui-port', '8233',
    '--log-level', 'error'], { stdio: 'ignore', detached: true });
  child.unref();
  for (let i = 0; i < 60 && !(await reachable(TEMPORAL)); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await reachable(TEMPORAL))) throw new Error(`could not start Temporal (${bin}); install the Temporal CLI or set SHOEBOX_TEMPORAL`);
  console.log(`Temporal is running (its web UI: http://localhost:8233), keeping its history in ${state}`);
}

async function client() {
  return new Client({ connection: await Connection.connect({ address: TEMPORAL }) });
}

async function start() {
  const folder = folderArg();
  ensure(folder);
  await ensureTemporal(folder);
  const at = flag('--at', '02:00');
  const [hh, mm] = at.split(':').map(Number);
  const c = await client();
  const id = 'shoebox-night';
  const spec = { calendars: [{ hour: hh, minute: mm }], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
  const action = { type: 'startWorkflow' as const, workflowType: 'nightShift', taskQueue: TASK_QUEUE, args: [{ folder }],
    workflowId: 'night-shift' };
  try {
    await c.schedule.create({ scheduleId: id, spec, action, policies: { overlap: 'SKIP' } });
  } catch {
    await c.schedule.getHandle(id).update((prev) => ({ ...prev, spec, action }));
  }
  console.log(`Shoebox: photos in ${join(folder, 'Inbox')} get filed every night at ${at}. Leave this running.`);
  await runWorker(TEMPORAL);
}

async function now() {
  const folder = folderArg();
  const c = await client();
  const id = `shift-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const h = await c.workflow.start('nightShift', { taskQueue: TASK_QUEUE, workflowId: id, args: [{ folder }] });
  console.log(`Started ${id} (follow it at http://localhost:8233/namespaces/default/workflows/${id}). Waiting...`);
  const r: any = await h.result();
  console.log(r.note);
}

async function ask() {
  const q = positional[positional.length - 1];
  const folder = positional.length > 1 ? resolve(positional[0]) : join(homedir(), 'Shoebox');
  const r = await bookkeeper(folder).generate(q, { maxSteps: 5 });
  console.log(r.text.trim());
}

async function read() {
  const file = positional[0];
  const r = await readReceipt(file);
  const c = r.copied;
  console.log(`${c.merchant ?? '(no shop name)'}  ${c.date ?? ''}  ${c.currency ?? ''}`);
  for (const l of c.items) console.log(`  ${(l.qty ?? '').padEnd(4)} ${l.name.padEnd(32).slice(0, 32)} ${l.amount ?? ''}`);
  for (const k of ['subtotal', 'discount', 'tax', 'service', 'total', 'paid', 'change'] as const) {
    if (c[k] != null) console.log(`  ${k.padEnd(9)} ${c[k]}  (${fmt(amount(c[k]) ?? 0)})`);
  }
  console.log(r.check.ok ? `adds up: ${r.check.agreed.join(', ')}` : `does not add up: ${r.check.issues.join('; ')}`);
  console.log(`${r.looks} look(s), ${r.seconds.toFixed(0)} s on ${MODEL_URL}`);
}

async function books() {
  const folder = folderArg();
  const month = positional[1] ?? new Date().toISOString().slice(0, 7);
  const b = writeBooks(folder, month);
  console.log(`${b.csv}\n${b.html}`);
}

const commands: Record<string, () => Promise<void>> = { start, now, ask, read, books };
if (!cmd || !commands[cmd]) {
  console.log('usage: shoebox start [FOLDER] [--at 02:00] | now [FOLDER] | ask [FOLDER] "QUESTION" | read IMAGE | books [FOLDER] [YYYY-MM]');
  process.exit(cmd ? 1 : 0);
}
commands[cmd]().catch((e) => {
  console.error(`shoebox ${cmd}: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
