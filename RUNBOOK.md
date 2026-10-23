# Relaydesk runbook

What to check and do when something is wrong, and how to host it. Production is `docker compose` on one machine (see [Hosting](#hosting)). `HOST` below stands for its address, e.g. `http://127.0.0.1:3000` on the machine itself.

## Where things are

| Thing | Where | Control |
| --- | --- | --- |
| App | Next.js 16 in Docker, service `relaydesk` | `docker compose up -d --build`; `/api/health` is its health check |
| Data | SQLite `/data/relaydesk.db` (+ `-wal`, `-shm`) in the `relaydesk-data` volume (`data/relaydesk.db` without Docker) | `RELAYDESK_DB_PATH` |
| Backups | Service `backup`: daily snapshot to `/data/backups` (last 7), plus an S3-compatible bucket if set | `RELAYDESK_BACKUP_*`; last result in `/data/backups/last.json` |
| Secrets | `.env.docker` on the host, never in git or the image | Copy `.env.example` |
| Traces | `eval/traces/live.jsonl`, one OpenTelemetry span per line | `RELAYDESK_TRACE_FILE` (a path, or `0` for none) |
| Model | Optional. Without a key everything still works without a model. | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` (default `gpt-4o-mini`) |
| Businesses | `businesses`, `articles`, `staff`, `invites` tables; Nimbus is seeded | `/signup` (gate it with `RELAYDESK_SIGNUP_CODE`), or `scripts/add-business.ts`. `businesses.live = 0` hides one from the public |
| MCP | `/api/mcp`, Streamable HTTP, stateless | Per-business tokens in `mcp_tokens` (hashed; **Setup** to create or revoke). `RELAYDESK_MCP_TOKEN` is the Nimbus demo's. 404 when neither exists |
| Public URL | Embed snippets and invite links | `RELAYDESK_PUBLIC_URL`, else the request's `Host` / `X-Forwarded-Host` |
| Staff login | `/login`, email + password, signed 7-day cookie | Nimbus demo: `staff@nimbus.demo` / `RELAYDESK_ADMIN_PASSWORD` (default `nimbus-demo`). Signing key: `RELAYDESK_SESSION_SECRET`, else one generated into `settings` |
| Co-pilot | Drafts on every new ticket | **AI drafts on/off** in the inbox header, or `business_settings` key `copilot` |
| CI | `.github/workflows/test.yml` | `npm test`, `npm run test:e2e` |

## Health check

The two chat checks write real rows. The second opens a ticket, so close it afterwards, or point `RELAYDESK_DB_PATH` at a scratch file first.

```bash
# 1. Site is up: expect 200
curl -s -o /dev/null -w "%{http_code}\n" "$HOST/"

# 2. The widget answers and cites: expect citations to include api-keys and escalated false
curl -s -X POST "$HOST/api/chat" -H 'content-type: application/json' \
  -d '{"business":"nimbus","message":"What is the write-key rate limit?"}' \
  | jq '{escalated, citations: [.citations[].slug]}'

# 3. Escalation opens a ticket: expect escalated true and a ticketId
curl -s -X POST "$HOST/api/chat" -H 'content-type: application/json' \
  -d '{"business":"nimbus","message":"How do I connect Nimbus to Salesforce?"}' | jq '{escalated, ticketId}'

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
  - **SQL:** `sqlite3 data/relaydesk.db "INSERT INTO business_settings (business_id, key, value) VALUES ('nimbus','copilot','off') ON CONFLICT(business_id, key) DO UPDATE SET value='off';"` (swap in the business id)
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

- **Back up now**, safe while the app runs: `docker compose run --rm --no-deps backup node scripts/backup.mjs --once`
- **Restore:** see [Restore a backup](#restore-a-backup).
- **Schema changes are additive.** New tables and columns are created when the app opens the database, and older code ignores them. So a code rollback never needs a database rollback. One exception in behavior, not schema: code from before businesses ignores `business_id` and shows every business's tickets in one inbox. Don't roll back past that change once a real business is on the database.

### Staff login problems or a leaked password

- **Rotate the demo login:** change `RELAYDESK_ADMIN_PASSWORD` and restart; the Nimbus demo staff password is re-hashed on start.
- **Sign everyone out:** change `RELAYDESK_SESSION_SECRET` (or, without it, delete the `session_secret` row from `settings`) and restart. Sessions are signed with it, so old cookies stop working.
- **Remove someone:** **Team** → **Remove**, or `DELETE FROM staff WHERE email = '...'`. Their session stops working on the next request.
- **Known limit:** there is no password reset. Remove the login and send a new invite, or add one with `scripts/add-business.ts --id <business> --staff-email <email>`.

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
- **Deployed code:** on the host, `git checkout <good-sha> && docker compose up -d --build`. The database needs nothing, because schema changes are additive (see above).
- **Data:** [Restore a backup](#restore-a-backup).
- **Before deploying to Vercel:** move data off SQLite first, because a serverless function's filesystem doesn't keep writes. Then Vercel's Instant Rollback becomes the code rollback.

## Hosting

One machine running `docker compose`: the app, a `backup` service, and (optionally) a Cloudflare Tunnel for HTTPS. The same files work on any of these:

| Where | Cost | Good for | Catch |
| --- | --- | --- | --- |
| Your own computer + Cloudflare Tunnel | Free | The first pilot shop | Down whenever the computer sleeps or is off |
| Oracle Cloud Always Free (Ampere A1) | Free | Always-on | Card for sign-up; free capacity can run out in a region |
| Any VPS, 2 GB RAM (optionally with Dokploy) | ~$5–7/month | Paying customers | Costs money |

### First deploy

1. Install Docker (Docker Desktop on a Mac; `curl -fsSL https://get.docker.com | sh` on a Linux VM), then `git clone` the repo.
2. `cp .env.example .env.docker` and set at least:
   - `RELAYDESK_SESSION_SECRET`: `openssl rand -base64 32`
   - `RELAYDESK_SIGNUP_CODE`: so strangers can't create businesses
   - `RELAYDESK_ADMIN_PASSWORD`: the Nimbus demo login is public otherwise
   - `RELAYDESK_PUBLIC_URL`: the `https://` address people will use
   - `OPENAI_API_KEY`: optional; without it answers quote the articles
3. `docker compose up -d --build`. Check `curl -s 127.0.0.1:3000/api/health` returns `{"ok":true}`.
4. Run the [health check](#health-check) against `http://127.0.0.1:3000`.

### HTTPS with a Cloudflare Tunnel

No open ports or public IP needed, so it works from home and behind CGNAT.

1. Put the domain's DNS on Cloudflare (free plan).
2. Cloudflare dashboard → Zero Trust → Networks → Tunnels → **Create a tunnel** (cloudflared). Copy its token into `.env.docker` as `TUNNEL_TOKEN`.
3. In the tunnel's **Public hostname**, add e.g. `relaydesk.example.com` → service `http://relaydesk:3000`.
4. `docker compose --profile tunnel up -d`. Then `curl -s https://relaydesk.example.com/api/health` should return `{"ok":true}`.

On a VPS with Dokploy instead, deploy this `docker-compose.yml` as a Compose app, put the `.env.docker` values in Dokploy's environment settings, and use Dokploy's domain settings for HTTPS rather than the tunnel.

### Backups

- **When:** daily at `RELAYDESK_BACKUP_AT` (HH:MM UTC, default 18:00, which is 02:00 in Manila). The last 7 snapshots stay in `/data/backups`.
- **Off the machine:** set the four `RELAYDESK_BACKUP_S3_*` values (Cloudflare R2, Backblaze B2, or any S3-compatible bucket) and add a lifecycle rule on the bucket to delete objects after 30 days. A snapshot only on the same disk doesn't survive losing the disk.
- **Check:** `docker compose exec backup cat /data/backups/last.json` should show `"ok":true` from the last day. `docker compose logs backup` has a line per run.
- **Back up now:** `docker compose run --rm --no-deps backup node scripts/backup.mjs --once`

### Restore a backup

1. `docker compose stop relaydesk`. Restoring under a running app loses what it writes next.
2. Run one of these:
   - newest on disk: `docker compose run --rm --no-deps backup node scripts/restore.mjs --latest --yes`
   - newest in the bucket: `docker compose run --rm --no-deps backup node scripts/restore.mjs --from-s3 --yes`
   - a specific one: `... restore.mjs --file /data/backups/<name>.db.gz --yes`

   Without `--yes` it only prints what it would do. It checks the backup's integrity first and keeps the replaced database as `relaydesk.db.before-restore-<time>`.
3. `docker compose up -d relaydesk`, then sign in and check the newest tickets are there.

### Restore drill

`scripts/restore-drill.sh` does all of this on real Docker against a throwaway bucket: it makes a business, an article, and a ticket, backs up off the machine, deletes the database and the local snapshots, restores from the bucket, and checks the login, ticket, and help center are back. It uses its own project and port (3420), so a running relaydesk isn't touched. Run it after changing anything about backups, and before trusting a new host.

## After an incident

Write a short postmortem in the PR that fixes it:

- **What happened:** who was affected, and for how long.
- **Timeline:** detected, mitigated, resolved.
- **Root cause.**
- **Fix:** the PR.
- **What stops it happening again:** a test, an eval row, or an alert. Turn the failing case into a regression check. That's how "I need a human" became a row in both evals.
