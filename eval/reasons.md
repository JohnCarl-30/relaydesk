# Why each Nimbus golden row exists

50 questions. Cap is 100. The first 40 are the seed set from the 2026-08-27 case study (36 in-corpus, 4 oos). Rows 41–50 were added 2026-08-28. Each new row has a reason. Do not add paraphrases of existing facts.

CSV columns stay `question,ground_truth,expected_slug` so `compare-retrievers.ts` and `golden.ts` keep working. This file is the reasons column.

rag-eval-harness keeps a copy as `examples/nimbus/reasons.md`.

Corpus split, 2026-09-11: `billing-plans` holds plan quotas and mid-cycle overage. `billing-seats-events` keeps seats, invites, `nimbus.*`, and the invoice snapshot. CSV row cap is `csv-export` only. Growth 90 days is in the `data-retention` body.

## Seed (rows 1–40)

| Tag | Count | Why |
| --- | --- | --- |
| in-corpus | 36 | One fact per help-center sentence, enough to fail when `k` or title weight drops. |
| oos | 4 | Salesforce, SOC 2, crypto, iOS. The widget should refuse, not cite a random article. |

## Added (rows 41–50)

| Question | Tag | expected_slug | Why it exists |
| --- | --- | --- | --- |
| ¿Los datos de eventos cruzan workspaces de Nimbus? | multilingual | workspaces | Same fact as the English workspace-boundary row. Tokenize() strips accents. This is the dummy-rag Spanish pattern on the real tenant. |
| Starter 200k sampling, then upgrade | multi-hop | funnel-zeros | Needs funnel-zeros (sampling) and data-retention (plan change does not rewrite history). One article is not enough. |
| How long does Growth keep raw events? | in-corpus | data-retention | Growth 90 days lives in the retention body, not the billing grab-bag. Summary-only facts still fail because `retrieve()` scores title+body. |
| Password login after SSO | policy | sso | Security policy, not a how-to. Easy to miss next to the ACS loop FAQ. |
| Invent a 50% off coupon | refusal | (empty) | Jailbreak-shaped. Ground truth is the same refuse line as oos, not a made-up code. |
| HIPAA BAA | oos | (empty) | Compliance question with no help-center article. Distinct from SOC 2. |
| Can an editor change billing or SSO? | policy | inviting-teammates | Role boundary. Owner vs editor is the kind of thing a bot invents if retrieval is sloppy. |
| Read-key rate limit | in-corpus | api-keys | Golden already had write-key 100 rps and 429. Not the 10/s read cap. |
| Dashboards during payment retry | in-corpus | failed-payment | Golden had pause-writes and no reactivation fee. Not "dashboards stay readable". |
| Keys created before March 2025 | in-corpus | api-keys | Legacy 50 rps cap. Easy to retrieve the new limits and miss the grandfather rule. |

Counts now: **44 in-corpus**, **6 oos/refusal**. The harness case-study snapshots stay on the original 40.
