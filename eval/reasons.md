# Why each Nimbus golden row exists

70 questions. Cap is 100. The first 40 are the seed set from the 2026-08-27 case study (36 in-corpus, 4 oos). Rows 41–50 were added 2026-08-28, rows 51–70 on 2026-10-22. Each new row has a reason. Do not add paraphrases of existing facts, unless the wording is what the row tests, and then say so in its reason.

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

Counts after this batch: **44 in-corpus**, **6 oos/refusal**. The harness case-study snapshots stay on the original 40.

## Hard rows (rows 51–70)

Rows 1–50 were written with the article open, so they reuse its words, and every retrieval and escalation check scored 1.0. A score that can't fall can't gate a PR or pick a model. These rows are phrased the way a customer would ask: no article vocabulary, a distracting article that shares the keywords, a typo, Taglish, or a near-miss question the help center can't answer. All 20 were written before the first scoring run, and none was dropped or reworded afterwards.

| Question | Tag | expected_slug | Why it exists |
| --- | --- | --- | --- |
| Marketing team only looks at dashboards, do they cost money? | vocabulary | billing-seats-events | "Viewers count as seats" with neither "viewer" nor "seat" in the question. "Dashboards" pulls `failed-payment`. |
| Pay for 10 people, how much data each month? | vocabulary | billing-plans | Growth's quota, asked as people and data instead of seats and events. |
| Cheapest plan and how many logins? | vocabulary | billing-plans | Starter's 3 seats. Not covered by any earlier row. |
| Charged for 1 million events over quota? | arithmetic | billing-plans | Overage rate times a volume. The answer is $120, which no article states. |
| Na-decline yung card namin, mabubura ba yung data namin? | multilingual | failed-payment | Taglish. "Decline" doesn't match "declined" because `tokenize()` has no stemming. |
| Downgrade to Starter, will SSO keep working? | multi-hop | sso | Needs "SSO is Growth and Scale". `data-retention` shares "downgrade", "Starter" and "keep". |
| SSO with Azure AD? | absence | sso | The answer is that only Google and Okta exist. The bot must say no, not invent steps. |
| Read key rejected when sending events from the server | troubleshooting | api-keys | A symptom, not a question. Read keys can't ingest. |
| When do old events get wiped each day? | vocabulary | data-retention | The 03:00 UTC nightly job. "Day" pulls `failed-payment` and `billing-seats-events`. |
| Does retention delete my saved funnels? | in-corpus | data-retention | Saved definitions survive. Not covered by any earlier row. |
| Can my developer create API keys without touching billing? | distractor | inviting-teammates | The editor role. The `api-keys` title outscores the roles article. |
| Who can delete the whole workspace? | distractor | inviting-teammates | Owner only. `workspaces` and `delete-project` both match on title. |
| Chart filtered to paying customers misses the free tier | vocabulary | funnel-zeros | The `plan = pro` filter hides free users. |
| Which plan keeps data unsampled? | wording | funnel-zeros | Same fact as row 31. The test is "unsampled", a word form the retriever can't match. |
| Automatically pull raw data out every night | vocabulary | csv-export | The query API for a recurring dump. "Raw" and "night" pull `data-retention`. |
| we acidentally trashed a projct yesterday | typo | delete-project | Restoring from the recycle bin, asked with typos on the key nouns. |
| Refund for seats we didn't use? | near-miss oos | (empty) | Billing words, no refund policy. Should open a ticket. |
| Export my events to BigQuery? | near-miss oos | (empty) | Export words, but there's only CSV and the query API. |
| Does Nimbus store our data in the EU? | near-miss oos | (empty) | "Data" matches everywhere; there's no residency article. |
| Price of the Scale plan? | near-miss oos | (empty) | `billing-plans` says Scale is custom, with no price. A person has to quote it. |

Counts now: **60 in-corpus**, **10 oos/refusal**. The four near-miss rows, and four of the answerable rows, are also in `escalation-labels.csv`.

