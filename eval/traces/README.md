# Traces

OpenTelemetry spans on the LangGraph loop. A JSON file you can open in the editor is enough to point at retrieve vs rewrite.

The same spans go to Langfuse when `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set (see `.env.example`). Model calls on `generate`, `rewrite`, and `copilot.draft` carry `gen_ai.*` model and token attributes plus `langfuse.observation.input`/`output`, so Langfuse shows them as generations with cost. The chat route passes the conversation ID as `session.id`. A redacting span processor runs before every exporter, so emails, phone numbers, and card numbers are masked in the local file and in Langfuse alike. The text trees below hide the full prompts; the JSON dumps keep them.

Question captured here: `what is nimbus`. Retrieve score is 5, so `confident` is false. Without a key the graph still ends after generate. With an LLM (or `RELAYDESK_STUB_LLM=1`) it rewrites the query and searches again.

```bash
npx --yes tsx eval/trace-conversation.ts
```

Open [`extractive.txt`](extractive.txt) and [`llm-rewrite.txt`](llm-rewrite.txt). Same question, two trees.

Extractive: `retrieve` → `generate` → END. `usedLlm=false`, `attempts=1`, `graph.next=END`. Rewrite never runs.

Stub LLM path: `retrieve` → `generate` (`graph.next=rewrite`) → `rewrite` → `retrieve` → `generate` (`attempts=2`) → END. The rewritten query `nimbus workspace definition` raised `retrieve.top_score` from 5 to 14. That is why rewrite exists. Stub `llm.*_tokens` are placeholders (48/32). A real `OPENAI_API_KEY` fills usage from the model.

Widget calls `answerQuestion` too. Live spans append to `eval/traces/live.jsonl` (gitignored) unless you set `RELAYDESK_TRACE_FILE=0`.

CI does not require traces. `/api/eval` is still extractive on purpose. `answerQuestion(q, { rewrite: false })` skips the loop even when a stub or key is present. Golden-set on vs off: [eval/rewrite.md](../rewrite.md).
