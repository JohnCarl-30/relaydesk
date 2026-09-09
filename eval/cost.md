# Cost and p95 (2026-08-28)

Lexical stays the PR gate. Not because gpt-4o-mini is expensive on 40 Nimbus rows. It is not. The extractive `/api/eval` path is **0.12 ms/row** and **$0**. An LLM generate+rewrite pass is about **$0.007** for the whole golden set at gpt-4o-mini list prices. CI still should not call a model.

Reproduce:

```bash
# SUT latency + token $ (Relaydesk)
cd ~/Documents/relaydesk && npx --yes tsx eval/bench.ts

# Evaluator wall clock (harness, no SUT)
cd ~/Documents/agentic-system && uv run python scripts/bench_evaluators.py
```

## System under test

Same 40 questions as [`golden.csv`](golden.csv). Extractive work is `retrieve` + `extractiveAnswer`, which is what `POST /api/eval` does. Measured in-process on 2026-08-28 so a hung `:3000` does not contaminate p95.

| Path | mean ms/row | p50 | p95 | max | tokens/row | $ / 40 rows |
| --- | --- | --- | --- | --- | --- | --- |
| Extractive (`/api/eval`) | 0.122 | 0.120 | 0.165 | 0.183 | 0 | 0 |
| LangGraph, no key | 1.622 | 0.969 | 4.194 | 15.501 | 0 | 0 |
| LLM generate+rewrite (estimate) | n/a | n/a | n/a | n/a | 727 | 0.00706 |

9 of 40 rows have retrieve `top_score` under 6, so rewrite would fire. Prompt size is chars/4. Output is assumed 120 tokens for generate and 12 for rewrite. Prices: **$0.15 / $0.60 per 1M** input/output (gpt-4o-mini, Aug 2026). No live key in this run, so LLM p95 is unmeasured. That p95 would be the HTTP round trip to OpenAI, hundreds of milliseconds per call, not the 0.17 ms extractive number.

Generate-only, no rewrite loop, is cheaper. On the 50-row set, 43 rows would call the model and the estimate is about **$0.006**. See [generate.md](generate.md).

On the 50-row set, escalation eats the empty and out-of-corpus rows, so only **5** would still rewrite. A keyless second retrieve does not change ranking. See [rewrite.md](rewrite.md).

Graph max 15.5 ms is the first invoke (tracer register). After that it sits around 1 ms. Still $0.

Raw: [`cost.json`](cost.json).

## Evaluators

Scored the committed Nimbus snapshot in-process. No HTTP. Raw JSON: in rag-eval-harness `examples/nimbus/evaluator-bench.json`.

| Evaluator | n | wall ms | ms/row | context_recall | context_precision |
| --- | --- | --- | --- | --- | --- |
| stub | 40 | 0.6 | 0.02 | 0.7824 | 0.7515 |
| lexical | 40 | 1.6 | 0.04 | 0.8799 | 0.0634 |
| stub | 10 | 0.1 | 0.01 | 0.7415 | 0.6979 |
| lexical | 10 | 0.4 | 0.04 | 0.9611 | 0.0674 |
| ragas (live) | 10 | skipped | | | OPENAI_API_KEY unset |
| ragas (token floor) | 10 | n/a | n/a | | **$0.0056** |
| ragas (token floor) | 40 | n/a | n/a | | **$0.021** |

RAGAS floor assumes 5 gpt-4o-mini passes over question+answer+contexts plus a little embedding. Live faithfulness splits statements, so expect more. The evaluator also awaits each metric per row, so wall clock is seconds, not 1.6 ms.

## Why lexical stays

Stub finished in 0.6 ms and reported context precision **0.75**. Lexical reports **0.063** on the same rows because the answers are short and the retrieved articles are not. Stub hashes. It will not fail CI when you drop `k` from 3 to 1. Lexical will. That is the [weak retriever write-up](https://github.com/JohnCarl-30/rag-eval-harness/blob/main/docs/nimbus-case-study.md).

Token $ is the wrong reason to skip RAGAS in CI. **$0.02** a PR is fine. The reasons that stick: you need a key, the number is not reproducible, and a 10-row slice already leaves the millisecond budget. Do not fail the job on dollars. Fail it when mean context recall drops more than 0.05.
