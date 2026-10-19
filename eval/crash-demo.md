# The crash test

What it shows: a night shift that is killed in the middle of a receipt picks up where it stopped, without reading
any receipt twice into the books.

1. `npx tsx src/cli.ts start .shoebox/night --at 02:00` (starts the local Temporal server and the worker).
2. `npx tsx src/cli.ts now .shoebox/night` in another terminal.
3. When two or three receipts are filed and the next one is being read (the Temporal UI shows the
   `readReceiptActivity` running), kill the worker process tree (Ctrl+C is not the test; kill it).
4. Wait about a minute and a half. Nothing happens: the Temporal server keeps the shift's state.
5. Start the worker again (step 1). Within a minute the read whose heartbeats stopped times out and is scheduled again;
   the shift carries on and the `now` command in step 2, still waiting, prints the morning note.
6. Check the ledger: every receipt once, none twice.
