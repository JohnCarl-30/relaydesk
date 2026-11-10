<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Relaydesk

A support widget that answers from a business's help center and opens a ticket when it can't. Read `README.md` for features and `eval/README.md` for how answers are scored.

## Before you push

```bash
npm test             # unit tests + eval/*.test.ts, keyless
npx tsc --noEmit     # the pre-push hook runs this and oxlint
npm run lint
```

## Rules that aren't obvious from the code

- **Retrieval or escalation changes** (`src/lib/rag.ts`, `escalate.ts`, `graph.ts`, `tokenize.ts`) must pass both help centers: Nimbus (`eval/escalation.ts`, `eval/compare-retrievers.ts`) and the accounting template (`eval/accounting.test.ts`). A fix for one has broken the other before.
- **Gates** live in `eval/suite.ts`. `escalation_precision` is 1.0 and the 30 attacks in `eval/attacks.ts` must all be blocked. Don't lower a threshold to make a change pass.
- **Don't edit a help article to make an eval pass.** Questions phrased in other words than the article are the point of the hard rows.
- **The CSVs in `eval/` are the source of truth** for the Langfuse datasets. Edit them, then sync with `eval/upload-datasets.ts`. Never edit the datasets in the Langfuse UI.
- **Templates** for other businesses are JSON in `templates/`, imported the way a business uploads articles (`parseJsonArticles`). Each gets its own `eval/<name>.test.ts`.

## Known limits

- The accounting template answers taxes it doesn't cover ("estate tax") from the 8% income tax article. Measured 2026-11-10: the question's only matched word ("tax") is in half the articles, the same shape as the Nimbus row "When exactly do old events get wiped each day?" ("events"), which must stay answered. Word-frequency rules, IDF-weighted coverage included, can't separate them. MiniLM similarity can (0.19–0.23 vs 0.52), but only combined with the word check, since answerable Nimbus rows such as "What can a viewer do?" score 0.15–0.23. See the `todo` tests in `eval/accounting.test.ts`.
