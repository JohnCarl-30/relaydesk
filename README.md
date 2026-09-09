# Relaydesk

A support widget and a staff inbox. Nimbus is the fake analytics company they sit on.

This folder is separate from the eval harness in `~/Documents/agentic-system` ([JohnCarl-30/rag-eval-harness](https://github.com/JohnCarl-30/rag-eval-harness)).

The widget answers from `/help` and cites the article. An out-of-corpus question or "This didn't help" opens a ticket in `/inbox`. Staff reply from there. Why the lexical CI gate still quotes, and why Salesforce must refuse, is in [eval/escalation.md](eval/escalation.md).

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

## Quality gate

CI scores `POST /api/eval` with [rag-eval-harness](https://github.com/JohnCarl-30/rag-eval-harness) (`--evaluator lexical`) against [`eval/golden.csv`](eval/golden.csv). A drop of more than 0.05 vs [`eval/baseline.json`](eval/baseline.json) fails the PR. `?variant=bm25`, `hybrid`, `chunked`, `hybrid-chunked`, `always-answer`, `norewrite`, `rewrite`, and `generate` are A/B only. `generate` is not CI. Escalation: [eval/escalation.md](eval/escalation.md). Rewrite on vs off: [eval/rewrite.md](eval/rewrite.md). Extractive vs generate: [eval/generate.md](eval/generate.md). Latency and $: [eval/cost.md](eval/cost.md).

```bash
# with the app running on :3000
rag-eval eval eval/golden.csv --sut-url http://127.0.0.1:3000/api/eval \
  --evaluator lexical -o /tmp/head.json
rag-eval regress --baseline eval/baseline.json --head /tmp/head.json --threshold 0.05
```
