# Shoebox on the CORD v2 test receipts

95 receipts from the CORD v2 test split that have a printed total (CC BY 4.0,
[naver-clova-ix/cord-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2)), read by Gemma 4 E4B (Q4_0, llama.cpp,
CPU only, thinking off). Reproduce: `npx tsx eval/cord.ts`, then `npx tsx eval/score.ts`.

| | receipts | |
|---|---|---|
| Total read correctly | 88 | 92.6% |
| Filed (total confirmed by other printed figures) | 87 | 91.6% |
| Filed with a wrong total | 4 | 4.2% |
| Set aside for a human ("Check me") | 8 | 8.4% |
| ... of which the total was in fact right | 5 | |
| Needed a second, closer look | 14 | |

Time per receipt on a Ryzen 7 9800X3D (6 threads, no GPU): median 16 s, mean 20 s.

## Every receipt that was not filed, or was filed wrong

| id | true total | read | filed | what disagreed |
|---|---|---|---|---|
| 013 | 51300 | 51300 | no | lines add up to 46636 but the subtotal reads 3000; the subtotal 3000 with discount, tax and service does not make the total 51300; paid 700 minus change 0 is not the total 51300 |
| 014 | 281435 | 251435 | no | the subtotal 238000 with discount, tax and service does not make the total 251435; paid 100000 minus change 18565 is not the total 251435 |
| 020 | 377859 | 279000 | yes | - |
| 031 | 113886 | 113886 | no | lines add up to 199386 but the total reads 113886 |
| 038 | 664329 | 664329 | no | the subtotal 561800 with discount, tax and service does not make the total 664329 |
| 040 | 68000 | 48000 | no | paid 100000 minus change 32000 is not the total 48000 |
| 041 | 365000 | 365000 | no | lines add up to 584415 but the total reads 365000 |
| 043 | 165000 | 1650000 | yes | - |
| 050 | 19500 | 14500 | yes | lines add up to 23352 but the subtotal reads 11121; the subtotal 11121 with discount, tax and service does not make the total 14500 |
| 059 | 680500 | 680339 | yes | - |
| 071 | 198000 | - | no | no total could be read |
| 074 | 330264 | 330264 | no | lines add up to 834000 but the total reads 330264 |
