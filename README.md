# Relaydesk

AI customer support as a widget plus an inbox — a product a support team would actually open.

This is a **separate folder** from the eval harness:

- Harness (already on GitHub): `~/Documents/agentic-system` → [JohnCarl-30/rag-eval-harness](https://github.com/JohnCarl-30/rag-eval-harness)
- This product: `~/Documents/relaydesk`

Nimbus is a seeded fictional analytics SaaS. The chat answers from its help center (with citations), and “This didn’t help” creates a ticket staff can reply to.

## Run

```bash
cd ~/Documents/relaydesk
cp .env.example .env.local   # optional: add OPENAI_API_KEY for LLM answers
npm install
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

- Customer site + widget: `/`
- Help center (the corpus): `/help`
- Staff inbox: `/inbox` — password `nimbus-demo`

Without an API key the bot still answers by quoting the best matching article. With `OPENAI_API_KEY` (and optional `OPENAI_BASE_URL`) it writes a short grounded reply.

## What a buyer sees

1. A visitor asks about seats, SSO, API keys, or empty funnels.
2. The widget cites a help article.
3. If that is wrong, they leave an email; a ticket lands in the inbox with the transcript.
4. Staff replies from `/inbox`.

Two tickets are seeded so the inbox is not empty on first open.
