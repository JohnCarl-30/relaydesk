# Relaydesk runbook

What to check and do when something is wrong. Relaydesk is not deployed anywhere yet. The commands assume one Node server started with `npm run build && npm run start`, with `HOST` standing for its address.

## Where things are

| Thing | Where | Control |
| --- | --- | --- |
| App | Next.js 16 | `npm run build && npm run start` |
| Data | SQLite `data/relaydesk.db` (+ `-wal`, `-shm`) | `RELAYDESK_DB_PATH` |
| Traces | `eval/traces/live.jsonl`, one OpenTelemetry span per line | `RELAYDESK_TRACE_FILE` (a path, or `0` for none) |
| Model | Optional. Without a key everything still works without a model. | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` (default `gpt-4o-mini`) |
| Staff login | `/login` | `RELAYDESK_ADMIN_PASSWORD` (default `nimbus-demo`) |
| Co-pilot | Drafts on every new ticket | **AI drafts on/off** in the inbox header, or `settings` key `copilot` |
| CI | `.github/workflows/test.yml` | `npm test`, `npm run test:e2e` |

## Health check

The two chat checks write real rows. The second opens a ticket, so close it afterwards, or point `RELAYDESK_DB_PATH` at a scratch file first.

```bash
# 1. Site is up: expect 200
curl -s -o /dev/null -w "%{http_code}\n" "$HOST/"

# 2. The widget answers and cites: expect citations to include api-keys and escalated false
curl -s -X POST "$HOST/api/chat" -H 'content-type: application/json' \
  -d '{"message":"What is the write-key rate limit?"}' \
  | jq '{escalated, citations: [.citations[].slug]}'

# 3. Escalation opens a ticket: expect escalated true and a ticketId
curl -s -X POST "$HOST/api/chat" -H 'content-type: application/json' \
  -d '{"message":"How do I connect Nimbus to Salesforce?"}' | jq '{escalated, ticketId}'

# 4. The co-pilot ran on that ticket: expect holding or answer, not error
sqlite3 data/relaydesk.db \
  "SELECT outcome, detail, created_at FROM agent_runs ORDER BY created_at DESC LIMIT 5;"
```

## Incidents

Order: **stop the damage first, then find the cause.** Write down times as you go; the postmortem needs them.

### Wrong or off-topic answers after a change

- **Check:**
  - Recent commits to `src/lib/articles.ts`, `rag.ts`, `conversation-context.ts`, or `escalate.ts`.
  - Run the evals. Each one is keyless and takes seconds:
    ```bash
    npx --yes tsx eval/compare-retrievers.ts   # hit@1 on golden.csv
    npx --yes tsx eval/conversations.ts        # multi-turn follow-ups
    npx --yes tsx eval/escalation.ts           # when to open a ticket
    npx --yes tsx eval/copilot.ts              # co-pilot triage
    ```
- **Mitigate:** revert the commit (see Rollback).
- **Find one bad answer:**
  ```bash
  jq -c 'select(.name=="support.answer") | {trace: .traceId, q: .attributes.question, escalated: .attributes.escalated}' \
    eval/traces/live.jsonl | tail -20
  jq -c 'select(.traceId=="<trace>") | {name, ms: .durationMs, attributes}' eval/traces/live.jsonl
  ```
  `retrieve.top_slug` is the article it used. `generate.unsupported_anchors` and `generate.unsupported_price` explain an escalation.

### Model provider down, slow, or too expensive

- **What already happens:** a failed model call falls back on its own. The widget quotes articles, and the co-pilot writes holding replies.
- **Mitigate:** unset `OPENAI_API_KEY` and restart. Everything then runs without a model, with no further model cost.

### The co-pilot drafts badly

- **Mitigate:** turn it off. Pending drafts stay; reject them from each ticket. Any of these works:
  - **Inbox:** click **AI drafts on** in the header.
  - **API:** `POST /api/copilot` with `{"enabled": false}` (needs a staff session).
  - **SQL:** `sqlite3 data/relaydesk.db "INSERT INTO settings (key, value) VALUES ('copilot','off') ON CONFLICT(key) DO UPDATE SET value='off';"`
- **Check:**
  ```bash
  sqlite3 data/relaydesk.db "SELECT outcome, COUNT(*) FROM agent_runs GROUP BY outcome;"
  sqlite3 data/relaydesk.db "SELECT reject_reason, COUNT(*) FROM agent_drafts WHERE status='rejected' GROUP BY reject_reason;"
  ```
  Each ticket is limited to 5 runs a day, so a loop shows up as `rate_limited`, not runaway cost.

### Visitors can't reach a person

- **Check:** does their phrase escalate? The phrases live in `VISITOR_ESCALATE` in `src/lib/escalate.ts`. `eval/escalation.ts` should pass, and so should the hand-off rows in `eval/conversations.jsonl` (`payment-person`, `seats-didnt-help`, `invoice-need-human`).
- **Fix:** add the phrase together with a test of look-alike questions that must not escalate (see `escalate.test.ts`), then add an eval row.

### Database locked, corrupt, or disk full

- **Back up**, safe while the app runs:
  ```bash
  mkdir -p backups && sqlite3 data/relaydesk.db ".backup 'backups/relaydesk-$(date +%F-%H%M).db'"
  ```
- **Restore:**
  1. Stop the app.
  2. Copy the backup over `data/relaydesk.db`.
  3. Delete `relaydesk.db-wal` and `relaydesk.db-shm`.
  4. Start the app.
- **Schema changes are additive.** New tables and columns are created when the app opens the database, and older code ignores them. So a code rollback never needs a database rollback.

### Staff login problems or a leaked password

- **Rotate:** change `RELAYDESK_ADMIN_PASSWORD` and restart.
- **Known limit:** the staff session is an unsigned cookie (`relaydesk_admin=1`, 7 days). Rotating the password doesn't sign anyone out, and the cookie can be forged. Treat the inbox as demo-only, and don't expose `/inbox` publicly until auth is replaced.

## Rollback

- **Code:**
  1. `git revert <sha>` on a branch.
  2. Open a PR and let CI run.
  3. Merge.

  Don't force-push `main`.
- **If `main` must be rewritten** (this happened once, 2026-09-29, to remove commit trailers):
  1. Keep a backup: `git branch backup/main-<reason> <old-sha>`.
  2. Push with the exact old tip as the lease: `git push --force-with-lease=main:<old-sha> origin main`.
  3. Check `git rev-parse main^{tree}` matches the backup's tree when only messages changed.
- **Data:** restore from a backup (above).
- **Before deploying to Vercel:** move data off SQLite first, because a serverless function's filesystem doesn't keep writes. Then Vercel's Instant Rollback becomes the code rollback.

## After an incident

Write a short postmortem in the PR that fixes it:

- **What happened:** who was affected, and for how long.
- **Timeline:** detected, mitigated, resolved.
- **Root cause.**
- **Fix:** the PR.
- **What stops it happening again:** a test, an eval row, or an alert. Turn the failing case into a regression check. That's how "I need a human" became a row in both evals.
