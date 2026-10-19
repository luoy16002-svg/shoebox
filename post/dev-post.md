---
title: Shoebox: a small model reads your receipts overnight, slowly, and never guesses a number
published: false
description: Drop receipt photos in a folder. At night Gemma 4 reads them on your own CPU, the arithmetic decides what to believe, a Temporal workflow keeps the shift going through crashes, and in the morning the month's expense sheet is waiting.
tags: devchallenge, hf26challenge, opensource, ai
cover_image: COVER_URL
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 3: Slow and Steady](https://dev.to/challenges/hacktoberfest-week3-2026-10-19)*

## What I Built

Receipts are the paperwork nobody does on time. They go into a wallet, then a drawer, then a shoebox, and at the end of the month (or the end of the tax year) someone sits down and types them into a spreadsheet one by one: date, shop, total, category, then files the paper or the photo somewhere it can be found again. Every freelancer and small-business owner knows the evening it takes.

**Shoebox** is a folder that does that evening for you while you sleep. You photograph receipts whenever you get them and let the photos land in `Shoebox/Inbox` (phone photo sync, a shared drive, anything). Every night at two, Shoebox wakes up and works through the new ones, one at a time, on your own computer:

- **Gemma 4** looks at each photo and copies down what is printed: every line, the subtotal, discount, tax, total, cash paid and change.
- **The arithmetic** decides whether to believe it. A receipt is filed only when its total is confirmed by other figures printed on the same receipt.
- Each believed receipt is renamed (`2026-10-14 Bakery Ana 60000.jpg`), filed under its month and category, and added to the month's expense sheet.
- A receipt whose figures will not agree is never guessed at. It goes to `Check me/` with a note saying exactly what disagreed.

In the morning there is one file waiting, `Good morning.txt`:

```
GOOD_MORNING
```

And if you want to know something, you ask in plain words:

```
ASK_DEMO
```

It is slow on purpose. It runs a 4-billion-parameter model on the CPU, so it can share a laptop with everything else you do, and because it has all night it can afford to look twice. That is the trade this week's theme asked for: nothing about it is fast, and you never have to think about it.

## Demo

DEMO_MEDIA

## Code

{% github luoy16002-svg/shoebox %}

## How I Built It

Three open pieces, each doing one job.

### Gemma 4 copies; it never calculates

The reader is Gemma 4 E4B (Apache 2.0) in llama.cpp, quantized to Q4_0 and running on six CPU threads. The prompt asks it to *copy* every money line exactly as printed, separators and all ("60.000", "Rp. 91,000", "12.50"), and the request carries a JSON schema that llama.cpp turns into a grammar, so the answer always parses.

Copying instead of calculating matters more than it sounds. Receipts from the test set I used print "60.000" for sixty thousand rupiah, "26,818" for twenty-six thousand, and "Rp. 91,000" with a dot that belongs to the currency. If the model normalised those numbers it would make a different mistake on each format. Instead the code reads the strings: a separator followed by exactly three digits groups thousands, a single one followed by one or two digits marks cents, and anything stuck to the currency sign is ignored. That parser has unit tests; the model never has to know any of it.

The first version had thinking turned on (Gemma 4 thinks by default in llama.cpp's chat template). It wrote a long "Here's a thinking process..." before every receipt, took about 75 seconds each, and on one receipt spent its whole token budget thinking and returned nothing. Copying a receipt needs eyes, not deliberation: with `--reasoning off` it takes TIME_MEDIAN seconds and the answers did not get worse.

### The arithmetic decides, and the receipt is read twice

Every receipt prints its own proof. The lines add up to the subtotal. The subtotal, with discount, tax (included in the prices or added on top) and service, makes the total. The cash handed over minus the change is the total. Shoebox checks every one of these it can make.

Getting from there to a rule I trust took three tries, and I measured each one on the 95 receipts in the [CORD v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2) test split (real Indonesian receipts, CC BY 4.0) that print a total.

**Try one: every figure must agree.** On the first night it set aside four of five receipts, and all four had the right total. The model had copied the TOTAL and CHANGE lines into the item list, or written a ticket's unit price where the line meant quantity times price, so the lines never added up even though the total was fine. Too strict to be useful.

**Try two: the total must be confirmed by something else on the receipt.** Cash minus change, or the lines, or the subtotal. Lines that are obviously totals or payments ("TL", "CG", "TUNAI", "KEMBALI") are taken out before adding, and a line can count as quantity times price. This filed ONELOOK_FILED of the 95 receipts, and ONELOOK_WRONG of those had the wrong total. Those were the interesting ones, because the arithmetic agreed with itself:

- the model missed some lines, then wrote a subtotal and a total that matched the lines it had seen;
- a shop printed "Rp 165000.00" and the model copied every amount on the receipt without the decimal point, so the lines, the subtotal, the total, the cash and the change were all ten times too big and all agreed;
- the total and the change were misread by the same 5,000, so cash minus change still came out right.

A model can be consistently wrong, and arithmetic on its own output cannot see it.

**Try three: read it twice.** Now every receipt gets two looks. The first reads the whole receipt; the second sees only the bottom of the photo, cropped and enlarged, and copies the totals block. Like double entry, the two readings must give the same total. When they do, they are merged (a tax line the first look missed comes from the second) and the arithmetic decides. When they do not, a reading is used only if cash and change confirm it, because those are two figures printed apart from the total; otherwise the receipt goes to `Check me/`.

RESULTS_TABLE

RESULTS_SENTENCE

### Temporal keeps the night shift going

A night shift on a laptop gets interrupted: the lid closes, Windows restarts for an update, the process dies. The shift is a [Temporal](https://temporal.io) workflow so none of that matters.

- A **schedule** starts the `nightShift` workflow every night at 02:00 (`shoebox start --at 02:00`).
- `nightShift` lists the inbox and starts one **child workflow per receipt**, one after another, so the CPU is never asked for two at once.
- Reading a receipt is an **activity** that sends a heartbeat every ten seconds while Gemma works. The heartbeat timeout is one minute, so if the worker dies mid-receipt, Temporal notices within a minute and retries the read with backoff when the worker comes back.
- Filing checks the ledger before it moves anything, so a retry after a crash never files a receipt twice.

I tested it the rude way: started a shift, killed the worker in the middle of a receipt, waited, and started it again. KILL_RESULT

TEMPORAL_SCREENSHOT

The whole Temporal server is the open-source dev server (`temporal server start-dev`) with its history in a SQLite file in your home folder. Nothing about it needs a cloud account.

### Mastra keeps the books

Two small agents run on the same local Gemma through [Mastra](https://mastra.ai), pointed at llama.cpp's OpenAI-compatible endpoint:

- The **filing clerk** puts each believed receipt in one of eight categories, using Mastra's structured output with an enum, so it cannot invent a ninth.
- The **bookkeeper** answers questions about the ledger. It has three tools (list expenses by month, category or shop; total a month by category or shop; list what is waiting in `Check me/`) and instructions to take every number from a tool. The model chooses which tool to call and phrases the answer; the amounts come from the books.

## Why Does Open Innovation Matter?

A shoebox of receipts is a diary. It says where you were, at what time, what you ate, which pharmacy you went to, and often the last four digits of your card. The receipt apps that do this job today work by uploading the photos to their servers and charging a monthly fee per user. Shoebox does the same job with the photos never leaving the folder they were taken into.

That is only possible because the model's weights are open. Gemma 4 E4B is small enough to run on a CPU, licensed so anyone can, and good enough at reading print that the arithmetic around it can catch the rest. Llama.cpp makes it a local server in one command; Temporal and Mastra are open source and run on the same machine. There is no API key anywhere in the project, no bill that grows with the number of receipts, and nothing to stop working when a vendor changes its pricing.

Open weights also made the design possible. Because the model is mine to run, I could turn its thinking off, constrain its output with a grammar, give it all night, and ask it to look twice. None of those are knobs a per-request API makes cheap.

## The Lazy Payoff

LAZY_PAYOFF

## Prize Categories

- **Best Use of Gemma**: Gemma 4 E4B reads every receipt and powers both agents, locally on the CPU through llama.cpp.
- **Best Use of Temporal**: the night shift is a scheduled Temporal workflow with a child workflow per receipt, heartbeating activities and idempotent filing; killed mid-shift, it picks up where it stopped.
- **Best Use of Mastra**: the filing clerk (structured output) and the bookkeeper (tools over the ledger) are Mastra agents on the local model.
