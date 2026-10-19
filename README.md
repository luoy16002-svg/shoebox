# Shoebox

A shoebox for receipts that empties itself overnight.

Photograph receipts whenever you get them and let the photos land in one folder (your phone's photo sync, a shared
drive, anything). Every night Shoebox reads the new ones **on your own computer** with Gemma 4, checks each one's
arithmetic, files it by month and category with a sensible name, and writes the month's expense sheet. In the morning
there is a two-line note:

```
Filed 12 receipts overnight; 1 would not add up and waits in “Check me”.
This month so far: IDR 1,284,500 (Books/expenses-2026-10.csv).
```

Nothing is uploaded anywhere. The model runs locally, the night shift survives the laptop sleeping or the process
being killed halfway (it is a [Temporal](https://temporal.io) workflow), and you can ask about the books in plain
words:

```
$ shoebox ask "how much did I spend on food and drink this month?"
Food & drink came to IDR 412,000 across 9 receipts in October.
```

## How it decides what to believe

The model only **copies** what is printed: every line, the subtotal, discount, tax, service, total, cash paid and
change, as strings. Code turns them into numbers and checks them against each other:

- do the lines add up to the subtotal (or, where the line shows a unit price, quantity times price)?
- does the subtotal, with discount, tax (included or added) and service, make the total?
- does cash paid minus change make the total?

A receipt is filed only when its total is confirmed by at least one other printed figure. If nothing confirms it,
Shoebox takes a second, closer look at the bottom of the receipt; if the figures still disagree, the photo goes to
`Check me/` with a note saying exactly what disagreed. It never guesses a number.

On the 95 receipts of the CORD v2 test set that have a printed total (CC BY 4.0, naver-clova-ix/cord-v2):
see [`eval/RESULTS.md`](eval/RESULTS.md) (`npx tsx eval/cord.ts` reproduces it).

## The folder

```
Shoebox/Inbox/                       new photos go here
Shoebox/Filed/2026-10/Food & drink/  2026-10-14 Bakery Ana 60000.jpg  (+ .json: everything that was read)
Shoebox/Check me/                    receipts that would not add up, each with a .txt saying why
Shoebox/Books/                       ledger.jsonl, expenses-2026-10.csv, summary-2026-10.html
Shoebox/Good morning.txt             the note from last night
```

## Run it

You need Node 20+, a vision model behind an OpenAI-compatible server, and the Temporal CLI.

```bash
# 1. the model: Gemma 4 E4B through llama.cpp (CPU is fine; it is a night shift)
llama-server -m gemma-4-E4B-it-Q4_0.gguf --mmproj mmproj-gemma-4-E4B-it-Q8_0.gguf -a gemma-4-e4b \
  --port 8181 -ngl 0 --reasoning off
#    (from https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF; LM Studio or Ollama work too:
#     set SHOEBOX_MODEL_URL and SHOEBOX_MODEL)

# 2. Shoebox
npm install
npx tsx src/cli.ts start ~/Shoebox --at 02:00     # starts a local Temporal server and the worker; leave it running
npx tsx src/cli.ts now ~/Shoebox                  # or run a shift right away
npx tsx src/cli.ts ask ~/Shoebox "what did I spend at the bakery?"
npx tsx src/cli.ts read photo.jpg                 # read one receipt and show the check
```

The Temporal web UI (http://localhost:8233) shows every shift, every receipt and every retry.

## How it is built

- **Gemma 4 E4B** (Apache 2.0) reads the photos through llama.cpp's server, with a JSON schema turned into a grammar
  so the answer always parses. Thinking is turned off: copying a receipt needs eyes, not deliberation, and it is
  three times faster without.
- **Temporal** runs the night shift: a scheduled `nightShift` workflow starts one child workflow per receipt; reading
  is an activity that heartbeats every ten seconds while the model works, so a dead worker is noticed within a minute
  and the read is retried; filing checks the ledger first, so a retry never files a receipt twice.
- **Mastra** holds the two agents: the filing clerk picks a category (structured output over a fixed list) and the
  bookkeeper answers questions with tools that read the ledger, so its numbers come from the books, not from the
  model.

## License

MIT. The test receipts are from CORD v2 (CC BY 4.0) and are not included in the repository.

---

## 中文说明

Shoebox 是一个会在夜里自己清空的收据鞋盒。随手拍下收据，让照片同步到一个文件夹；每天夜里，Shoebox 在你自己的电脑上用
Gemma 4 读新收据，核对每张的算术，按月份和类别改名归档，写出当月的报销表，早上留一句话告诉你结果。

- 模型只抄写票面上印的内容，数字由代码换算并互相核对：明细合计、小计加减折扣税费、实付减找零。总额能被另一组数字证实才归档；
  对不上就再细看一次底部，仍对不上就放进 `Check me/` 并写明哪里不一致，绝不猜数。
- 夜班是 Temporal 工作流：电脑睡眠或进程被杀，醒来后从中断的那张收据接着做，不会重复归档。
- Mastra 负责两个代理：归类员（从固定类别里选一个）和记账员（用读账本的工具回答问题，数字只来自账本）。
- 全部在本机运行，不上传任何东西。
