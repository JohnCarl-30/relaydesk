# Relaydesk

A support widget and a staff inbox. Nimbus is the fake analytics company they sit on.

The widget answers from `/help` and cites the article. An out-of-corpus question or "This didn't help" opens a ticket in `/inbox`. Staff reply from there. Why Salesforce must refuse is in [eval/escalation.md](eval/escalation.md).

## Run

```bash
cd ~/Documents/relaydesk
cp .env.example .env.local   # optional: add OPENAI_API_KEY for LLM answers
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

- `/` customer site and widget
- `/help` the articles the widget searches
- `/inbox` staff inbox, password `nimbus-demo`

Answers go through a LangGraph loop. Retrieve help articles, write a reply, rewrite the query and search again if the first pass is weak. No API key still quotes when retrieve is confident. Out of corpus refuses and opens a ticket. Set `OPENAI_API_KEY` (and optional `OPENAI_BASE_URL`) if you want the generate and rewrite nodes to call the model.

OpenTelemetry spans sit on those nodes. [`eval/traces/extractive.txt`](eval/traces/extractive.txt) is the no-key path. [`eval/traces/llm-rewrite.txt`](eval/traces/llm-rewrite.txt) is the rewrite loop. See [eval/traces/README.md](eval/traces/README.md).

## Demo path

1. Ask the widget about seats, SSO, API keys, or empty funnels.
2. It cites a help article.
3. Ask how to connect Nimbus to Salesforce, or tap **This didn't help**. The widget refuses and a ticket appears in `/inbox`.
4. Reply from `/inbox`.

Two fixture tickets are already in the inbox so it isn't empty on first open.

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
```

Details and past results: [eval/README.md](eval/README.md). Escalation: [eval/escalation.md](eval/escalation.md). Rewrite on vs off: [eval/rewrite.md](eval/rewrite.md). Extractive vs generate: [eval/generate.md](eval/generate.md). Latency and $: [eval/cost.md](eval/cost.md).
