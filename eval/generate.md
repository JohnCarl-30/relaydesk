# When Relaydesk stays extractive

The widget can call a model. `/api/eval` should not. Retrieve is the thing CI can break. Prose style is not.

```bash
npx --yes tsx eval/generate.ts
```

`POST /api/eval?variant=generate` uses the same retrieve as baseline, then the generate-node prompt if `OPENAI_API_KEY` is set. Empty hits, no key, or a ticket-worthy question fall back to quotes. Rewrite stays off. Do not point the PR gate at this variant.

## Same retrieve, two generators

50 golden rows. Hit@1 **34/44**. Hit@3 **43/44**. Both arms. Retrieve did not change, so context recall cannot move.

Lexical means, keyless, refuse lines included:

| Metric | extractive | generate |
| --- | --- | --- |
| context_recall | 0.8639 | 0.8639 |
| context_precision | 0.0602 | 0.0602 |
| faithfulness | 0.7049 | 0.7049 |
| answer_relevancy | 0.5838 | 0.5838 |

No key was present. Generate fell back to quotes. The means match because the answers match. A live model would change faithfulness and answer_relevancy. It would not change context recall unless retrieve changed. That is why the lexical gate stays on retrieved context.

Faithfulness is below the CI lock (0.782) because week 9 refuses 7 rows on `/api/eval`. Do not re-lock `baseline.json` to hide that.

## Who would call the model

43 of 50 rows are not escalations and have hits. Those would hit ChatOpenAI. 7 would still refuse. 0 rows actually called a model in this run.

Rewrite is a different filter. Only 5 of 50 are unconfident enough to search again. Generate is the common path once a key exists. Most questions would pay for a completion, not a second retrieve.

## Latency and $

Extractive stays about **0.1 ms/row** and **$0**. Keyless generate is the same work plus a function call. Do not read the 0.15 vs 0.22 means as a model round trip.

Generate-only at gpt-4o-mini list prices is about **$0.006** for 50 rows (43 completions, chars/4, 120 output tokens). Generate+rewrite on the old 40-row set was about **$0.007**. Money is not why CI stays extractive. A live p95 would be the HTTP round trip, hundreds of milliseconds, not 0.2 ms.

## Fine-tune vs RAG

LoRA on a small model starts to beat retrieve-and-quote when you have on the order of **2,000** labeled question and answer pairs for this product, plus a holdout that can fail CI. Nimbus has 50 golden rows and 10 help articles. That is a retrieval problem. It is not a fine-tune set. Do not train. Stay on RAG. Stay extractive on `/api/eval`.

The widget may still generate when a key exists. Visitors read sentences. CI reads whether the right article came back.

## What stayed in production

Eval and CI stay on `extractiveAnswer`. `?variant=generate` exists so the fallback is reproducible. Do not promote it.

Raw: [`generate.json`](generate.json).
