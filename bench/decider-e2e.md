# PRD 4.5b e2e: the local decider (jevos)

Date: 2026-10-05 · jevos-v2 (int8, OpenVINO) on the owner's Windows laptop (16 threads, 7.5 GB RAM) · agentos master d79e621 plus the question change in this PR

## Install and start

- `agentos decider install` asked first, then downloaded `jev-windows-x64.zip` and `jevos-v2-openvino-int8.zip` (732 MB on disk). Both passed the SHA-256 check.
- The first `decider start` was **refused**: 433 MB free, below the 1200 MB check, as designed. After the owner freed memory (about 2 GB free), it started and was ready in 3.2 s. It used about 800 MB once loaded.
- Latency per request was 0.3–0.7 s on this laptop with apps open, compared with 25–110 ms in the jevos README on an idle machine. A run asks two requests, so that is fine.

## Eval

Probabilities are P(yes). Thresholds: auto-quick at 0.8, content flag at 0.6.

### Auto-quick: the wording decides everything

The same 10 labelled tasks (5 small, 5 multi-part) were asked with four wordings:

| Wording | Small tasks | Big tasks | at 0.8 |
|---|---|---|---|
| "Can one developer finish this whole task as a single focused change…" (first plan) | 0.31–0.73 | 0.18–0.49 | 0/5 small, 0 false |
| "Is this a small coding task, such as a typo fix…" | 0.09–0.95 | 0.04–0.06 | 3/5, 0 false |
| **"Does this task ask for exactly one small change, not several features or screens?"** | **0.89–0.97** | **0.05–0.25** | **5/5, 0 false** |
| "Could an experienced developer do this task in under 30 minutes?" | 0.72–0.80 | 0.68–0.72 | useless (no separation) |

**Held-out set** (12 new tasks, never used to pick the wording):
- **11/12 right at 0.8.**
- The one miss was a small task ("show the stock quantity next to each item", 0.66). That is the safe direction: the planner runs.
- No big task was called small. The closest was a MySQL→PostgreSQL migration at 0.67, which is why the threshold stays at 0.8 and not 0.7.

### Content risk

| Question | Labelled set | Held-out |
|---|---|---|
| money, first wording ("touch money: prices, payments…") | 1/2. A discount calculation on `total_cents` scored 0.12 | — |
| **money, new wording ("calculate or change an amount of money, such as a price, a total, a discount…")** | **2/2, 0 false** (0.98, 0.95) | **5/6**. A balance check scored 0.46 and was missed; 0 false flags |
| data-loss | 2/2 (0.90, 0.91), 0 false | — |
| access | 3/3 (0.65–0.79), 0 false (0.07–0.21) | — |

### Real run

The run used `agentos run "Create the file notes.txt containing exactly the word hello."` with no flags, a scratch repo and a fake `gh`. The decider ran both questions:
- **Auto-quick: P = 0.71.** That is below 0.8, so the planner ran. This is the safe side; `--quick` is still available.
- **Content risk:** money 0.17, data-loss 0.07, access 0.29. No flag, which is correct.
- The run reached `pr_open`.

## Conclusion

Every miss above was on the safe side: a small task still planned, or a money change not flagged, which the path rules and the reviewer still cover. There were **no false quick decisions and no false flags**, which is what an advisory decider must avoid. The wordings were changed to the best ones measured.

**Limits:**
- This is 40 examples, not a benchmark.
- jevos is sensitive to phrasing.
- It needs about 1 GB of free memory, so on this laptop it is something to start when apps are closed (for example at night with the daemon), not something to keep always on.
