# Relaydesk

A support bot that knows when to hand off to a person, and evals that show it.

The widget answers from the help center and cites the article. When the help center has no answer, it says so and opens a ticket. In the staff inbox, a co-pilot triages the ticket and drafts a reply, and a person sends it. Nimbus is the fake analytics company it runs on.

![A visitor asks about SSO and gets a cited answer, asks about Salesforce and gets a ticket, then staff send the co-pilot's draft from the inbox](docs/demo.gif)

| Eval | Result | Details |
| --- | --- | --- |
| Retrieval, 44 labeled questions | hit@1 44/44, hit@3 44/44 | [eval/README.md](eval/README.md) |
| When to open a ticket, 15 labeled questions | precision 1.00, recall 1.00 (always answering: recall 0) | [eval/escalation.md](eval/escalation.md) |
| Co-pilot triage, 13 replayed tickets | reason, topic and question 13/13 | [eval/copilot.ts](eval/copilot.ts) |
| Cost, whole golden set | $0 without a key, about $0.007 with gpt-4o-mini | [eval/cost.md](eval/cost.md) |

All of them run locally without an API key.

## Run

```bash
cp .env.example .env.local   # optional: add OPENAI_API_KEY for LLM answers
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

- `/` customer site and widget
- `/help` the articles the widget searches
- `/inbox` staff inbox, password `nimbus-demo`

Or run the production build in Docker:

```bash
docker compose up --build
```

The SQLite database lives in the `relaydesk-data` volume, so tickets survive a restart. Keys and the staff password come from `.env.local` if it exists. Set `RELAYDESK_ADMIN_PASSWORD` before exposing it anywhere.

Answers go through a LangGraph loop. Retrieve help articles, write a reply, rewrite the query and search again if the first pass is weak. No API key still quotes when retrieve is confident. Out of corpus refuses and opens a ticket. Set `OPENAI_API_KEY` (and optional `OPENAI_BASE_URL`) if you want the generate and rewrite nodes to call the model.

OpenTelemetry spans sit on those nodes. [`eval/traces/extractive.txt`](eval/traces/extractive.txt) is the no-key path. [`eval/traces/llm-rewrite.txt`](eval/traces/llm-rewrite.txt) is the rewrite loop. See [eval/traces/README.md](eval/traces/README.md). Set the Langfuse keys in `.env.example` and the same spans go to Langfuse, with model calls as generations and each chat as one session.

## Demo path

1. Ask the widget about seats, SSO, API keys, or empty funnels.
2. It cites a help article.
3. Ask how to connect Nimbus to Salesforce, or tap **This didn't help**. The widget refuses and a ticket appears in `/inbox`.
4. Reply from `/inbox`.

Two fixture tickets are already in the inbox so it isn't empty on first open.

## Inbox co-pilot

Every new ticket gets a co-pilot pass right after the chat reply is sent:
- **Triage:** it files the ticket under a help-center topic, writes a one-line summary, and notes why a person is needed.
- **Draft:** it saves one suggested reply. Staff **Send**, edit and send, or **Reject** it with a reason.

It never sends on its own. Only the staff reply path posts to the customer.

Without a model key the draft is a holding reply ("I've passed this to the team…"), since every ticket exists because the article bot already failed. With `OPENAI_API_KEY` set, it drafts an answer from the cited articles. Refunds, discounts, cancellations, and legal questions always get a holding reply.

The **AI drafts on/off** switch in the inbox header turns it off. Each ticket gets at most 5 runs a day, and every run is logged in the ticket's sidebar.

## Tests and evals

CI runs the unit tests and the widget's browser tests on every push and PR:

```bash
npm test          # node:test, keyless
npm run test:e2e  # Playwright; builds and serves on :3217
```

The evals are keyless scripts you run by hand against [`eval/golden.csv`](eval/golden.csv) and the conversation set:

```bash
npx --yes tsx eval/compare-retrievers.ts  # hit@1 / hit@3 per retriever
npx --yes tsx eval/conversations.ts       # multi-turn follow-ups
npx --yes tsx eval/escalation.ts          # when to open a ticket
npx --yes tsx eval/copilot.ts             # co-pilot triage on replayed tickets
```

Details and past results: [eval/README.md](eval/README.md). Escalation: [eval/escalation.md](eval/escalation.md). Rewrite on vs off: [eval/rewrite.md](eval/rewrite.md). Extractive vs generate: [eval/generate.md](eval/generate.md). Latency and $: [eval/cost.md](eval/cost.md).

## Operations

[RUNBOOK.md](RUNBOOK.md) covers health checks, turning off the co-pilot, model outages, database backup and restore, and how to roll back.

## Roadmap

Each milestone is a set of issues. Progress is tracked there, not here.

| Milestone | Target | Goal |
| --- | --- | --- |
| [Evals in Langfuse](https://github.com/JohnCarl-30/relaydesk/milestone/1) | Nov 15, 2026 | Every change is traced and gated by Langfuse experiments. The model is picked by an experiment. |
| [Ready for real businesses](https://github.com/JohnCarl-30/relaydesk/milestone/2) | Dec 13, 2026 | A business can set up its own help center, hosted on a real domain. |
| [Real users](https://github.com/JohnCarl-30/relaydesk/milestone/3) | Feb 28, 2027 | Two or three businesses use relaydesk every week. |
| [Case study](https://github.com/JohnCarl-30/relaydesk/milestone/4) | Mar 31, 2027 | A written case study and demo, backed by real usage and eval numbers. |
