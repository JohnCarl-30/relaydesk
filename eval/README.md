# Retrieval gate

`golden.csv` is 50 Nimbus questions ([reasons.md](reasons.md)). `baseline.json` is the lexical means from title-boosted top-3 **bag-of-words** retrieval on that 50-row set. That is still the CI default. The harness case study snapshots stay on the original 40.

`POST /api/eval?variant=`

| variant | Retriever |
| --- | --- |
| omitted / `baseline` | count, top-3 articles, title weight 4 |
| `norewrite` | same as baseline. Named off switch for the rewrite A/B. |
| `rewrite` | second retrieve when the first pass is weak. Keyless query uses the same tokens retrieve already bags. A/B only. |
| `always-answer` | same retriever as baseline, never escalate, quotes even on OOS. Escalation A/B only. Not the CI default. |
| `weak` | count, top-1, no title boost |
| `bm25` | Okapi BM25 on title+body, top-3 articles, title weight 4 |
| `hybrid` | bag-of-words + MiniLM cosine, RRF (`k=10`), top-3 articles |
| `chunked` | count over paragraphs, title as a field, top-3 chunks |
| `hybrid-chunked` | hybrid over paragraphs. Needs MiniLM. |
| `generate` | same retrieve as baseline, then the generate-node prompt when a key exists. Falls back to extractive. A/B only. See [generate.md](generate.md). |

Hit@k vs `expected_slug` (no server):

```bash
npx --yes tsx eval/compare-retrievers.ts
```

After the 2026-09-11 corpus split, count is **44/44** hit@1 and hit@3 on the 44 labeled rows. Chunked is 42/44 and 43/44. Do not promote chunked. The tables below are the 2026-08-28 A/B snapshots.

Lexical means for BM25, with the app on :3000:

```bash
rag-eval eval eval/golden.csv \
  --sut-url 'http://127.0.0.1:3000/api/eval?variant=bm25' \
  --evaluator lexical -o /tmp/nimbus-bm25.json
rag-eval regress --baseline eval/baseline.json --head /tmp/nimbus-bm25.json --threshold 0.05
```

Lexical means, 40-row golden, 2026-08-28, lexical evaluator:

| Metric | count (locked baseline) | bm25 | Delta |
| --- | --- | --- | --- |
| context_recall | 0.8799 | 0.8776 | -0.0023 |
| faithfulness | 0.7772 | 0.7713 | -0.0059 |
| answer_relevancy | 0.6381 | 0.6393 | +0.0012 |
| context_precision | 0.0634 | 0.0642 | +0.0008 |

Hit@1 / hit@3 vs `expected_slug` on 36 in-corpus rows: both **30/36** and **35/36**. BM25 reorders some lists (mid-cycle overage prefers `failed-payment` over `billing-seats-events`) but does not recover the miss. Do not promote BM25. The corpus is 10 short articles; IDF barely moves.

## Hybrid (MiniLM + RRF)

Local `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers`. First call downloads the model into `.cache/transformers` (gitignored). CI does not use this variant.

```bash
npx --yes tsx eval/compare-retrievers.ts
rag-eval eval eval/golden.csv \
  --sut-url 'http://127.0.0.1:3000/api/eval?variant=hybrid' \
  --evaluator lexical -o /tmp/nimbus-hybrid.json
rag-eval regress --baseline eval/baseline.json --head /tmp/nimbus-hybrid.json --threshold 0.05
```

Lexical means, 40-row golden, 2026-08-28:

| Metric | count | hybrid | Delta |
| --- | --- | --- | --- |
| context_recall | 0.8799 | 0.8906 | +0.0107 |
| faithfulness | 0.7772 | 0.7805 | +0.0033 |
| answer_relevancy | 0.6381 | 0.6738 | +0.0357 |
| context_precision | 0.0634 | 0.0570 | -0.0064 |

Hit@1 **30/36 → 34/36**. Hit@3 **35/36 → 36/36**. The recovered hit@3 row is "Does Starter sample events?" (`funnel-zeros`). Count ranked billing and CSV first because "Starter" and "events" are everywhere; MiniLM put the sampling article in the list.

Do not promote hybrid to the widget yet. Recall moved. Precision fell because RRF pads lists that used to be one article (JIT, viewer, 429) with extra full articles that are not in the short reference.

## Chunking (paragraphs)

Help bodies split on blank lines. 32 chunks from 10 articles. Title is a weighted field, not glued onto the body as one bag. `retrieved_contexts` are title + paragraph, not the whole article. Widget and CI stay on article count.

```bash
npx --yes tsx eval/compare-retrievers.ts
rag-eval eval eval/golden.csv \
  --sut-url 'http://127.0.0.1:3000/api/eval?variant=chunked' \
  --evaluator lexical -o /tmp/nimbus-chunked.json
rag-eval eval eval/golden.csv \
  --sut-url 'http://127.0.0.1:3000/api/eval?variant=hybrid-chunked' \
  --evaluator lexical --timeout 60 -o /tmp/nimbus-hybrid-chunked.json
rag-eval regress --baseline eval/baseline.json --head /tmp/nimbus-chunked.json --threshold 0.05
rag-eval diff --baseline /tmp/nimbus-count.json --head /tmp/nimbus-chunked.json
```

Lexical means, 40-row golden, 2026-08-28:

| Metric | count | chunked | hybrid-chunked |
| --- | --- | --- | --- |
| context_recall | 0.8799 | 0.7816 | 0.8508 |
| faithfulness | 0.7772 | 0.7543 | 0.7442 |
| answer_relevancy | 0.6381 | 0.5954 | 0.6258 |
| context_precision | 0.0634 | 0.1496 | 0.1564 |

Hit@1 / hit@3 vs unique `expected_slug` (count vs chunked, no MiniLM): **30/36 → 29/36** and **35/36 → 31/36**.

Naive top-3 chunks often all come from one article. Unique-slug hit@3 looks worse because there are not three articles in the list. Lexical precision more than doubles because the contexts are paragraphs. Recall on `chunked` drops **0.0983** and fails the 0.05 gate. Worst rows: frontend read-key question, Starter retention, CSV row cap. Those answers live in a different article than the title-matched paragraphs.

`hybrid-chunked` keeps most of the precision gain and only loses **0.0291** recall, so it would pass `rag-eval regress --threshold 0.05`. Do not promote it. CI cannot download MiniLM, and the widget still answers from whole articles. Next knob is unique-slug after scoring chunks, not swapping the CI default.

## Rewrite

Disable the extra retrieve, or cap the graph at one generate. Keyword rewrite does not move hit@k. Keep the LLM loop on the widget. [rewrite.md](rewrite.md).

```bash
npx --yes tsx eval/rewrite.ts
```

## Generate

Same retrieve as baseline. Then the generate-node prompt if a key exists. Eval and CI stay extractive. [generate.md](generate.md).

```bash
npx --yes tsx eval/generate.ts
```

## Escalation

Lexical CI still scores quotes. The refuse line would tank faithfulness, so the ticket policy has its own 15-row labels. Policy recall is 1.0 on those 7 out-of-corpus rows. `always-answer` recall is 0. That is the drop. Chat opens the ticket. `POST /api/eval` does not. See [escalation.md](escalation.md).

```bash
npx --yes tsx eval/escalation.ts
```

## Traces

LangGraph nodes emit OpenTelemetry spans. Same question, extractive vs rewrite: [eval/traces/README.md](traces/README.md).

## Cost and p95

Extractive `/api/eval` is 0.12 ms/row and $0. LLM generate+rewrite is about $0.007 for 40 rows. Lexical still owns CI. [cost.md](cost.md).

```bash
npx --yes tsx eval/bench.ts
```
