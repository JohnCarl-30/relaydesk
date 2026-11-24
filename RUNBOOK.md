# Relaydesk runbook

What to check and do when something is wrong, and how to host it. Production is `docker compose` on one machine (see [Hosting](#hosting)). `HOST` below stands for its address, e.g. `http://127.0.0.1:3000` on the machine itself.

## Where things are

| Thing | Where | Control |
| --- | --- | --- |
| App | Next.js 16 in Docker, service `relaydesk` | `docker compose up -d --build`; `/api/health` is its health check |
| Data | Postgres at `DATABASE_URL` (Neon in production). Without it, PGlite (embedded Postgres) in `/data/pglite` in the `relaydesk-data` volume, or `data/pglite` without Docker | `DATABASE_URL`, `RELAYDESK_DB_PATH` |
| Backups | Neon keeps every change for the plan's restore window; see [Restore](#restore) | Neon console |
| Secrets | `.env.docker` on the host, never in git or the image | Copy `.env.example` |
| Traces | `eval/traces/live.jsonl`, one OpenTelemetry span per line | `RELAYDESK_TRACE_FILE` (a path, or `0` for none) |
| Model | Optional. Without a key everything still works without a model. | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` (default `gpt-4o-mini`) |
| Businesses | `businesses`, `articles`, `staff`, `invites` tables; Nimbus is seeded | `/signup` (gate it with `RELAYDESK_SIGNUP_CODE`), or `scripts/add-business.ts`. `businesses.live = 0` hides one from the public |
| MCP | `/api/mcp`, Streamable HTTP, stateless | Per-business tokens in `mcp_tokens` (hashed; **Setup** to create or revoke). `RELAYDESK_MCP_TOKEN` is the Nimbus demo's. 404 when neither exists |
| Public URL | Embed snippets, invite links, links in staff emails | `RELAYDESK_PUBLIC_URL`, else the request's `Host` (never `X-Forwarded-Host`, which visitors can set) |
| Staff login | `/login`, email + password, signed 7-day cookie | Nimbus demo: `staff@nimbus.demo` / `RELAYDESK_ADMIN_PASSWORD` (default `nimbus-demo`). Signing key: `RELAYDESK_SESSION_SECRET`, else one generated into `settings` |
| Co-pilot | Drafts on every new ticket | **AI drafts on/off** in the inbox header, or `business_settings` key `copilot` |
| CI | `.github/workflows/test.yml` | `npm test`, `npm run test:e2e` |

## Health check

The two chat checks write real rows. The second opens a ticket, so close it afterwards, or run them against a Neon branch instead of production.

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
psql "$DATABASE_URL" -c \
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
  - **SQL:** `psql "$DATABASE_URL" -c "INSERT INTO business_settings (business_id, key, value) VALUES ('nimbus','copilot','off') ON CONFLICT(business_id, key) DO UPDATE SET value='off';"` (swap in the business id)
- **Check:**
  ```bash
  psql "$DATABASE_URL" -c "SELECT outcome, COUNT(*) FROM agent_runs GROUP BY outcome;"
  psql "$DATABASE_URL" -c "SELECT reject_reason, COUNT(*) FROM agent_drafts WHERE status='rejected' GROUP BY reject_reason;"
  ```
  Each ticket is limited to 5 runs a day, so a loop shows up as `rate_limited`, not runaway cost.

### Visitors can't reach a person

- **Check:** does their phrase escalate? The phrases live in `VISITOR_ESCALATE` in `src/lib/escalate.ts`. `eval/escalation.ts` should pass, and so should the hand-off rows in `eval/conversations.jsonl` (`payment-person`, `seats-didnt-help`, `invoice-need-human`).
- **Fix:** add the phrase together with a test of look-alike questions that must not escalate (see `escalate.test.ts`), then add an eval row.

### Database down or data lost

- **Check:** `/api/health` fails when the database can't be reached. Neon's status page and the project's console show compute and connection errors.
- **Restore:** see [Restore](#restore).
- **Schema changes are additive.** New tables and columns are created when the app opens the database, and older code ignores them. So a code rollback never needs a database rollback. One exception in behavior, not schema: code from before businesses ignores `business_id` and shows every business's tickets in one inbox. Don't roll back past that change once a real business is on the database.

### Staff login problems or a leaked password

- **Rotate the demo login:** change `RELAYDESK_ADMIN_PASSWORD` and restart; the Nimbus demo staff password is re-hashed on start.
- **Sign everyone out:** change `RELAYDESK_SESSION_SECRET` (or, without it, delete the `session_secret` row from `settings`) and restart. Sessions are signed with it, so old cookies stop working.
- **Remove someone:** **Team** → **Remove** (only the business's first login, the one that signed up, can do this). Their session stops working on the next request, and their MCP tokens and unaccepted invites are deleted with them.
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
  Rolling back past the move to Postgres sends the app back to the old SQLite file, without anything written since. Revert forward instead.
- **Data:** [Restore](#restore).

## Hosting

One machine running `docker compose`: the app and (optionally) a Cloudflare Tunnel for HTTPS. The same files work on any of these:

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

### HTTPS on a VPS with Dokploy

Dokploy runs this `docker-compose.yml` from `main` and gets the certificate itself, so skip the tunnel.

1. **VPS:** Ubuntu 24.04, 2 GB RAM. The image build runs `next build`, which can run out of memory on 2 GB, so add swap first:
   ```bash
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   ```
2. **Dokploy:** as root, `curl -sSL https://dokploy.com/install.sh | sh`. It needs ports 80, 443 and 3000 free. Open `http://<vps-ip>:3000` and create the admin account.
3. **App:** new project → **Compose**, provider GitHub, repo `JohnCarl-30/relaydesk`, branch `main`, compose path `./docker-compose.yml`. Turn on **Autodeploy** so a merge to `main` deploys.
4. **Environment tab:** the values from [First deploy](#first-deploy) step 2, plus:
   - `RELAYDESK_PUBLIC_URL=https://relaydesk.dyeyc.dev` (or whatever domain you use)
   - `RELAYDESK_PORT=3100`: Dokploy's dashboard holds host port 3000.

   Dokploy writes these to `.env` beside the compose file; `env_file` in `docker-compose.yml` passes them to the containers.
5. **DNS:** an `A` record for the hostname pointing at the VPS IP. On Cloudflare, set it to **DNS only** (grey cloud) so Let's Encrypt can reach the server.
6. **Domains tab:** the hostname, path `/`, service `relaydesk`, container port `3000`, HTTPS on with Let's Encrypt. Then **Deploy**.
7. **Check:** `curl -s https://relaydesk.dyeyc.dev/api/health` returns `{"ok":true}`. Then run the [health check](#health-check) with that address as `HOST`.

Set `DATABASE_URL` in the Environment tab so data lives in Neon. Without it, data stays in PGlite in the `relaydesk-data` volume, which survives redeploys but has no backups. Once the dashboard has its own domain, close its raw port: `docker service update --publish-rm "published=3000,target=3000,mode=host" dokploy`.

### Restore

Neon keeps the history of every change for your plan's restore window. That history is the backup; there is no separate backup service.

1. In the Neon console, open the project and restore the production branch to a time just before the problem. Restoring to a new branch first lets you look before you switch.
2. If you restored to a new branch, point `DATABASE_URL` at it and redeploy.
3. Sign in and check the newest tickets are there.

The restore window depends on the Neon plan. If it is shorter than you could go without noticing a problem, take your own copies too, e.g. a scheduled `pg_dump "$DATABASE_URL"` to a bucket.

### Moving from SQLite

Before Postgres, data lived in `/data/relaydesk.db` in the `relaydesk-data` volume. To move it:

1. Create a Neon project and copy its pooled connection string.
2. Stop the old app so nothing is written during the copy: `docker compose stop relaydesk`.
3. Copy the database file off the server: `docker compose cp relaydesk:/data/relaydesk.db ./relaydesk.db` (with Dokploy, run it in the app's compose directory on the VPS, then `scp` the file down).
4. From a checkout of this repo: `DATABASE_URL='<neon url>' npx tsx scripts/sqlite-to-postgres.ts ./relaydesk.db` prints the row counts. Add `--yes` to copy. It replaces everything in that database and checks every table's count afterwards.
5. Set `DATABASE_URL` in Dokploy's Environment tab and deploy.
6. Run the [health check](#health-check) and sign in. Keep `relaydesk.db` until you're sure nothing is missing.

## After an incident

Write a short postmortem in the PR that fixes it:

- **What happened:** who was affected, and for how long.
- **Timeline:** detected, mitigated, resolved.
- **Root cause.**
- **Fix:** the PR.
- **What stops it happening again:** a test, an eval row, or an alert. Turn the failing case into a regression check. That's how "I need a human" became a row in both evals.
