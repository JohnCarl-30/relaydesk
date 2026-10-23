# Evals

`golden.csv` is 70 Nimbus questions ([reasons.md](reasons.md)). Rows 51–70 are phrased the way customers ask, so the scores below have room to fall. Everything here is keyless and runs locally. CI runs only the unit and browser tests.

Until 2026-09-29, CI also scored a `POST /api/eval` endpoint with [rag-eval-harness](https://github.com/JohnCarl-30/rag-eval-harness) against a committed baseline. The gate, the endpoint, and the baseline were removed. The "lexical means" tables below are dated snapshots from it.

## Langfuse datasets

The CSVs stay the source of truth. Edit `golden.csv` or `escalation-labels.csv` in a PR, then sync them to Langfuse:

```bash
npx --yes tsx eval/upload-datasets.ts            # needs LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY
npx --yes tsx eval/upload-datasets.ts --dry-run  # prints the plan, writes nothing
```

| CSV | Langfuse dataset | `expectedOutput` | `metadata` |
| --- | --- | --- | --- |
| `golden.csv` | `relaydesk-golden` | `{ slug, answer }`, `slug` is `null` for out-of-corpus rows | `{ source }` |
| `escalation-labels.csv` | `relaydesk-escalation` | `{ shouldEscalate }` | `{ source, why }` |

`input` is `{ question }` in both. Each item's id is the dataset name plus a hash of the question, so rerunning the script updates items instead of adding them. Only changed rows are written. Editing a question creates a new item, and a row removed from the CSV is archived in Langfuse, not deleted. Langfuse keeps a version per write. The script prints a timestamp at the end, and listing a dataset with that `version` returns exactly what was uploaded.

Don't edit these datasets in the Langfuse UI. The next sync overwrites edited items and archives added ones.

## Langfuse experiments

Each dataset item goes through `answerQuestion`, the widget's answer path. Each item becomes one experiment trace that holds the widget's spans, with scores attached:

```bash
npx --yes tsx eval/run-experiments.ts                       # both; or name one: golden, escalation
npx --yes tsx eval/run-experiments.ts --run-name baseline   # the run name defaults to <branch>@<sha>
```

| Dataset | Item scores | Run scores |
| --- | --- | --- |
| `relaydesk-golden` | `hit_at_1`, `hit_at_3` (in-corpus rows only), `faithfulness` | Mean of each |
| `relaydesk-escalation` | `escalation_correct` | `escalation_precision`, `escalation_recall`, mean `escalation_correct` |

- **Hit@k** uses the top 3 articles from the widget's first retrieval, the same check as `compare-retrievers.ts`.
- **Faithfulness** is an LLM judge. It gives each answer a score from 0 to 1 for how well the articles it cites support it. Escalations and answers without citations get no score.
- **Model use:** with `OPENAI_API_KEY` set, the model writes the answers, as in the widget, and also runs the judge. Without the key, answers are extractive and the judge is skipped.
- **Without Langfuse keys**, the script runs the same task and evaluators on the CSVs and prints the scores without recording anything.
- **Failure:** the script exits non-zero when an item fails, a run score is missing, or a run score is below its threshold.

### PR gate

`.github/workflows/experiments.yml` runs `eval/ci/golden.ts` and `eval/ci/escalation.ts` on every pull request through [`langfuse/experiment-action`](https://github.com/langfuse/experiment-action). It posts one comment with both runs and fails the check when a run score drops below its threshold in `eval/suite.ts`:

| Score | Threshold | main, 2026-10-22 |
| --- | --- | --- |
| `hit_at_1` | 0.83 | 0.8333 (50/60) |
| `hit_at_3` | 0.91 | 0.9167 (55/60) |
| `escalation_precision` | 1.0 | 1.0 (7/7) |
| `escalation_recall` | 0.63 | 0.6364 (7/11) |
| `faithfulness` | 0.8 | not scored yet |

- **How strict:** retrieval and escalation are deterministic, so each threshold sits at main's score and a single extra miss fails the check. When a change raises a score, raise its threshold in the same PR.
- **Faithfulness:** checked only when the `OPENAI_API_KEY` secret is set. Without it, answers are extractive and the score is absent.
- **Secrets:** the workflow needs `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`. Fork PRs and runs without them skip with a notice. `experiments.test.ts` checks the same thresholds on the CSVs in `npm test`, so forks are still covered.
- **Rows:** adding rows to `golden.csv` or `escalation-labels.csv` changes the ratios. Update the thresholds and run `upload-datasets.ts` after merging.
- **Traces:** the action runs its own OpenTelemetry setup. CI traces hold the item, its scores and any model calls, but not the widget's `relaydesk` spans. For those, use `run-experiments.ts`.

2026-10-19, keyless (extractive answers, against a local Langfuse): hit@1 and hit@3 **1.0** (44/44), escalation precision and recall **1.0** (tp=7, fp=0, fn=0). These match `compare-retrievers.ts` and `escalation.ts`.

2026-10-22, keyless, CSVs only, after the hard rows went in: hit@1 **0.8333** (50/60), hit@3 **0.9167** (55/60), escalation precision **1.0**, recall **0.6364** (tp=7, fp=0, fn=4).

## Retrieval

Hit@k vs `expected_slug` (no server):

```bash
npx --yes tsx eval/compare-retrievers.ts
```

After the 2026-09-11 corpus split, count was **44/44** hit@1 and hit@3 on the 44 labeled rows, and chunked 42/44 and 43/44. With the hard rows (2026-10-22), count is **50/60** and **55/60**, chunked **46/60** and **49/60**. Do not promote chunked.

The 10 count misses at hit@1 are all hard rows. Five still miss at hit@3: "pay for 10 people", "who can delete the whole workspace", "data to stay unsampled", "pull our raw data out every night" and the typo row. Most are vocabulary gaps, which a lexical retriever with no stemming can't close. That makes them the rows to watch when hybrid comes back. The tables below are the 2026-08-28 A/B snapshots.

`compare-retrievers.ts` runs count and chunked. BM25 and hybrid below came from the old endpoint's variants; `retrieve(q, { mode: "bm25" })` and `retrieveHybrid()` in `src/lib/rag.ts` still exist to re-run them in code.

Lexical means (rag-eval-harness), 40-row golden, 2026-08-28:

| Metric | count (then the CI baseline) | bm25 | Delta |
| --- | --- | --- | --- |
| context_recall | 0.8799 | 0.8776 | -0.0023 |
| faithfulness | 0.7772 | 0.7713 | -0.0059 |
| answer_relevancy | 0.6381 | 0.6393 | +0.0012 |
| context_precision | 0.0634 | 0.0642 | +0.0008 |

Hit@1 / hit@3 vs `expected_slug` on 36 in-corpus rows: both **30/36** and **35/36**. BM25 reorders some lists (mid-cycle overage prefers `failed-payment` over `billing-seats-events`) but does not recover the miss. Do not promote BM25. The corpus is 10 short articles; IDF barely moves.

## Hybrid (MiniLM + RRF)

Local `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers`. First call downloads the model into `.cache/transformers` (gitignored). The widget does not use it.

Lexical means (rag-eval-harness), 40-row golden, 2026-08-28:

| Metric | count | hybrid | Delta |
| --- | --- | --- | --- |
| context_recall | 0.8799 | 0.8906 | +0.0107 |
| faithfulness | 0.7772 | 0.7805 | +0.0033 |
| answer_relevancy | 0.6381 | 0.6738 | +0.0357 |
| context_precision | 0.0634 | 0.0570 | -0.0064 |

Hit@1 **30/36 → 34/36**. Hit@3 **35/36 → 36/36**. The recovered hit@3 row is "Does Starter sample events?" (`funnel-zeros`). Count ranked billing and CSV first because "Starter" and "events" are everywhere; MiniLM put the sampling article in the list.

Do not promote hybrid to the widget yet. Recall moved. Precision fell because RRF pads lists that used to be one article (JIT, viewer, 429) with extra full articles that are not in the short reference.

## Chunking (paragraphs)

Help bodies split on blank lines. 32 chunks from 10 articles. Title is a weighted field, not glued onto the body as one bag. Contexts are title + paragraph, not the whole article. The widget stays on article count.

```bash
npx --yes tsx eval/compare-retrievers.ts
```

Lexical means (rag-eval-harness), 40-row golden, 2026-08-28:

| Metric | count | chunked | hybrid-chunked |
| --- | --- | --- | --- |
| context_recall | 0.8799 | 0.7816 | 0.8508 |
| faithfulness | 0.7772 | 0.7543 | 0.7442 |
| answer_relevancy | 0.6381 | 0.5954 | 0.6258 |
| context_precision | 0.0634 | 0.1496 | 0.1564 |

Hit@1 / hit@3 vs unique `expected_slug` (count vs chunked, no MiniLM): **30/36 → 29/36** and **35/36 → 31/36**.

Naive top-3 chunks often all come from one article. Unique-slug hit@3 looks worse because there are not three articles in the list. Lexical precision more than doubles because the contexts are paragraphs. Recall on `chunked` drops **0.0983**, which failed the 0.05 gate of the time. Worst rows: frontend read-key question, Starter retention, CSV row cap. Those answers live in a different article than the title-matched paragraphs.

`hybrid-chunked` keeps most of the precision gain and only loses **0.0291** recall, within that gate. Do not promote it. The widget still answers from whole articles. Next knob is unique-slug after scoring chunks, not swapping the widget's retriever.

## Rewrite

Disable the extra retrieve, or cap the graph at one generate. Keyword rewrite does not move hit@k. Keep the LLM loop on the widget. [rewrite.md](rewrite.md).

```bash
npx --yes tsx eval/rewrite.ts
```

## Generate

The widget's retrieve, then its answer step: the model if a key exists, else an extractive quote. [generate.md](generate.md).

```bash
npx --yes tsx eval/generate.ts
```

## Escalation

Whether to refuse is scored on its own 23-row labels. Policy recall is **0.6364**: 7 of the 11 rows that should escalate do. The 4 that don't are the near-miss rows added 2026-10-22 (refund, BigQuery, EU data, Scale price), which share enough words with an article to clear the coverage check. `always-answer` recall is 0. That is the drop. Chat opens the ticket. See [escalation.md](escalation.md).

```bash
npx --yes tsx eval/escalation.ts
```

## Follow-ups

`conversations.jsonl` is 44 conversations, 46 checked turns. The categories follow IBM's [MTRAG](https://github.com/IBM/mt-rag-benchmark): `nonstandalone` needs the earlier turn, `standalone` switches topic and must not drag the old one along, `unanswerable` should escalate, `conversational` is thanks or ok, `handoff` asks for a person. Each turn replays through `answerQuestion` with the real replies as history. Keyless.

```bash
npx --yes tsx eval/conversations.ts
```

2026-09-27, first run: **26/28**. "Does that also happen on Growth?" after a sampling question went to `data-retention`, because "also" and "happen" kept the topic rule from firing. "how much does it cost?" after SSO answered from the SSO article.

Before fixing, 8 more rows went in: three more generic-word follow-ups, three price questions the help center cannot answer, and two it can (overage rate, reactivation fee). That run was **31/36**; every unanswerable price question failed. Two rule changes followed. The topic article stays first unless another hit matches more of the follow-up's words. A price question escalates when the article it would answer from has no price or fee. Now **36/36**. The same author wrote the rows and the rules, so treat this as a regression check, not a held-out score. Real transcripts would make a better test set.

2026-09-28, code review: a separate reviewer found 8 more failures, and they went in as rows first.
- Interjections read as named subjects ("Well, what about Scale?", "Then what about Scale?").
- A quantifier read as a subject ("with multiple projects").
- A three-deep chain lost the sampling topic.
- Three acknowledgements pushed the question out of the history window.
- Answerable questions escalated as prices ("charged for pending invites", "How much raw data", "in charge of billing").

That run was **37/45**. After the fixes it is **45/45**:
- A sentence-opening word before a comma or a question word is a discourse marker, not a subject.
- Determiners and quantifiers are skipped.
- The topic comes from the chain's first question.
- Acknowledgements do not count against the history window.
- "how much" is a price question only when a verb follows ("how much does it…"), and "charge" is not a price word.

The price check still runs on every chat question, not just follow-ups. Limited to follow-ups, "what does an extra seat cost?" and "how much is Growth per month?" go through as standalone questions, get answered from the wrong article, and the score drops to 43/45.

## Co-pilot

`copilot-tickets.jsonl` holds 13 conversations. Each replays through `answerQuestion` the way the chat route does, opening a ticket on escalation. The co-pilot then runs on the ticket, and the eval checks three things: why the ticket exists (out of scope, answer didn't help, asked for a person, or policy), its topic, and which customer question it is about. Keyless, with a temporary database.

```bash
npx --yes tsx eval/copilot.ts
```

2026-10-07: **13/13** on reason, topic, and question. The same author wrote the cases and the rules, so treat this as a regression check.

The eval first found that "I need a human" got an article answer instead of a ticket. `VISITOR_ESCALATE` only knew a few exact phrases. It now matches requests for a person by intent ("talk/speak/chat to…", "need a human", "…please"), while questions that only mention a person or an agent, like "a person's email" or "the user agent filter", stay questions. Both evals carry that case now (follow-ups **46/46**).

## Traces

LangGraph nodes emit OpenTelemetry spans. Same question, extractive vs rewrite: [eval/traces/README.md](traces/README.md).

## Cost and p95

Extractive answers (retrieve + extractiveAnswer) are 0.12 ms/row and $0. LLM generate+rewrite is about $0.007 for 40 rows. [cost.md](cost.md).

```bash
npx --yes tsx eval/bench.ts
```
