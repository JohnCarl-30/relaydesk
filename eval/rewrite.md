# Rewrite on vs off

_Written while a rag-eval-harness gate scored `POST /api/eval` in CI. The gate, the endpoint, and `baseline.json` were removed on 2026-09-29; the numbers here are a record._

The widget can rewrite a weak question and search again. CI should not. A second bag-of-words pass with the same tokens does not move hit@k or lexical recall. Keep the loop on chat when a key exists. Leave `/api/eval` on one retrieve.

```bash
npx --yes tsx eval/rewrite.ts
```

`POST /api/eval?variant=norewrite` is the named off switch. It matches the CI default. `?variant=rewrite` runs the extra retrieve. Do not point the PR gate at it.

`answerQuestion(question, { rewrite: false })` caps the LangGraph loop after the first generate. Chat still defaults to rewrite on.

## Who would rewrite

50 golden rows. 7 already escalate. 38 are confident (`score >= 6`). **5** would fire the loop.

| Question | expected | first retrieve |
| --- | --- | --- |
| What is the Growth plan event quota? | billing-seats-events | funnel-zeros, then billing |
| Is JIT provisioning on by default? | sso | sso |
| Do expired invites occupy a seat? | inviting-teammates | inviting-teammates |
| Can I demote the last owner? | inviting-teammates | inviting-teammates |
| What can a viewer do? | inviting-teammates | inviting-teammates |

Four of five already hit@1. The only miss at rank 1 is Growth quota. "plan" and "event" pull `funnel-zeros` above billing.

## Quality

Keyword rewrite is `tokenize(question).join(" ")`. Retrieve already bags those tokens. Rankings did not change. Hit@1 **34/44**. Hit@3 **43/44**. Both arms.

Lexical means on those traces, refuse lines included:

| Metric | norewrite | rewrite |
| --- | --- | --- |
| context_recall | 0.8639 | 0.8639 |
| context_precision | 0.0602 | 0.0602 |
| faithfulness | 0.7049 | 0.7049 |
| answer_relevancy | 0.5838 | 0.5838 |

Faithfulness is below the CI lock (0.782) because week 9 now refuses 7 rows on `/api/eval`. Context recall matches the lock. Rewrite did not move either number. Do not re-lock `baseline.json` this week.

If rewrite had searched `billing seats events`, Growth quota would be hit@1. The demo stub query `nimbus workspace definition` would have sent it to workspaces instead. A canned rewriter is worse than leaving the first list alone.

## Latency and $

Extractive `/api/eval` is still about **0.1 ms/row**. The extra retrieve on 5 rows is lost in timer noise. Do not read the 0.17 vs 0.12 means as rewrite being faster.

LangGraph with `rewrite: false` (no key): mean **1.7 ms**, p95 **4.6 ms**, first invoke still spikes. That is tracer setup, not the second search.

LLM generate+rewrite is still the [cost.md](cost.md) estimate: about **$0.007** for a 40-row set at gpt-4o-mini list prices. p95 of a live model call was not measured. It would be the HTTP round trip, hundreds of milliseconds, not 0.1 ms.

## What stayed in production

The widget still rewrites when `OPENAI_API_KEY` is set. The [traced](traces/README.md) `what is nimbus` pass went retrieve score **5 → 14** after `nimbus workspace definition`. That is query expansion, not a second tokenize. Cap stays at one extra attempt.

Eval and CI stay on one retrieve. `?variant=rewrite` exists so the no-op is reproducible. Do not promote it.

Raw: [`rewrite.json`](rewrite.json).
