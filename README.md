# Relaydesk

A support widget and a staff inbox. Nimbus is the fake analytics company they sit on.

This folder is separate from the eval harness in `~/Documents/agentic-system` ([JohnCarl-30/rag-eval-harness](https://github.com/JohnCarl-30/rag-eval-harness)).

The widget answers from `/help` and cites the article. "This didn't help" opens a ticket. Staff reply from `/inbox`.

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

Answers go through a LangGraph loop. Retrieve help articles, write a reply, rewrite the query and search again if the first pass is weak. No API key still quotes the best matching article. Set `OPENAI_API_KEY` (and optional `OPENAI_BASE_URL`) if you want the generate and rewrite nodes to call the model.

## Demo path

1. Ask the widget about seats, SSO, API keys, or empty funnels.
2. It cites a help article.
3. If that's wrong, leave an email. The transcript becomes a ticket.
4. Reply from `/inbox`.

Two tickets are already in the inbox so it isn't empty on first open.

## Quality gate

CI scores `POST /api/eval` with [rag-eval-harness](https://github.com/JohnCarl-30/rag-eval-harness) (`--evaluator lexical`) against [`eval/golden.csv`](eval/golden.csv). A drop of more than 0.05 vs [`eval/baseline.json`](eval/baseline.json) fails the PR.

```bash
# with the app running on :3000
rag-eval eval eval/golden.csv --sut-url http://127.0.0.1:3000/api/eval \
  --evaluator lexical -o /tmp/head.json
rag-eval regress --baseline eval/baseline.json --head /tmp/head.json --threshold 0.05
```
