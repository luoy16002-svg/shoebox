# Shoebox on the CORD v2 test receipts

95 receipts from the CORD v2 test split that have a printed total (CC BY 4.0,
[naver-clova-ix/cord-v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2)), read by Gemma 4 E4B (Q4_0, llama.cpp,
CPU only, thinking off). Every receipt is read twice (whole, then the totals block enlarged). Reproduce: `npx tsx eval/cord.ts`, then `npx tsx eval/score.ts`.

| | receipts | |
|---|---|---|
| Total read correctly | 88 | 92.6% |
| Filed (total confirmed by other printed figures) | 80 | 84.2% |
| Filed with a wrong total | 1 | 1.1% |
| Set aside for a human ("Check me") | 15 | 15.8% |
| ... of which the total was in fact right | 9 | |
| Both looks read the same total | 84 | 88.4% |

Time per receipt on a Ryzen 7 9800X3D (6 threads, no GPU): median 20 s, mean 22 s.

## Every receipt that was not filed, or was filed wrong

| id | true total | read | filed | what disagreed |
|---|---|---|---|---|
| 013 | 51,300 | 51,300 | no | the subtotal 46,636 with discount, tax and service does not make the total 51,300; paid 700 minus change 0 is not the total 51,300 |
| 014 | 281,435 | 251,435 | no | the two readings of the total disagree (251,435 and 281,435); the subtotal 238,000 with discount, tax and service does not make the total 251,435; paid 100,000 minus change 18,565 is not the total 251,435 |
| 019 | 176,000 | 176,000 | no | the two readings of the total disagree (16,000 and 176,000); the subtotal 60,000 with discount, tax and service does not make the total 176,000 |
| 020 | 377,859 | 279,000 | no | the two readings of the total disagree (279,000 and 305,100) |
| 031 | 113,886 | 113,886 | no | lines add up to 199,386 but the subtotal reads 85,500; the subtotal 85,500 with discount, tax and service does not make the total 113,886 |
| 038 | 664,329 | 664,329 | no | the subtotal 561,800 with discount, tax and service does not make the total 664,329 |
| 040 | 68,000 | 48,000 | no | the two readings of the total disagree (48,000 and 100,000); paid 100,000 minus change 32,000 is not the total 48,000 |
| 043 | 165,000 | 1,650,000 | no | the two readings of the total disagree (1,650,000 and 165,000) |
| 048 | 25,000 | 25,000 | no | the two readings of the total disagree (25,000 and 100,000); lines add up to 25,000 but the subtotal reads 22.72; the subtotal 22.72 with discount, tax and service does not make the total 25,000 |
| 050 | 19,500 | 14,500 | no | the two readings of the total disagree (19,500 and 14,500); lines add up to 23,352 but the subtotal reads 11,121; the subtotal 11,121 with discount, tax and service does not make the total 14,500 |
| 059 | 680,500 | 680,339 | yes | - |
| 071 | 198,000 | - | no | the two readings of the total disagree (none and none); no total could be read |
| 074 | 330,264 | 330,264 | no | lines add up to 834,000 but the subtotal reads 214,000; the subtotal 214,000 with discount, tax and service does not make the total 330,264 |
| 083 | 23,000 | 23,000 | no | the two readings of the total disagree (23,000 and 25,000) |
| 087 | 40,150 | 40,150 | no | the two readings of the total disagree (40,150 and 40.15); the subtotal 36,500 with discount, tax and service does not make the total 40,150 |
| 091 | 21,000 | 21,000 | no | the total was read only once and cash and change do not confirm it; the subtotal 15,000 with discount, tax and service does not make the total 21,000 |
