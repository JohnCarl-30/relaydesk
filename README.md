# Relaydesk

[![CodSpeed](https://img.shields.io/endpoint?url=https://codspeed.io/badge.json)](https://app.codspeed.io/JohnCarl-30/relaydesk?utm_source=badge)

A support bot that knows when to hand off to a person, and evals that show it.

The widget answers from the help center and cites the article. When the help center has no answer, it says so and opens a ticket. In the staff inbox, a co-pilot triages the ticket and drafts a reply, and a person sends it. Nimbus is the fake analytics company it runs on.

![A visitor asks about SSO and gets a cited answer, asks about Salesforce and gets a ticket, then staff send the co-pilot's draft from the inbox](docs/demo.gif)

| Eval | Result | Details |
| --- | --- | --- |
| Retrieval, 60 labeled questions | hit@1 50/60, hit@3 55/60 | [eval/README.md](eval/README.md) |
| When to open a ticket, 23 labeled questions | precision 1.00, recall 0.64 (always answering: recall 0) | [eval/escalation.md](eval/escalation.md) |
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

- `/` the Relaydesk landing page
- `/demo` Nimbus, a fake customer site with the widget
- `/help` the articles the widget searches
- `/inbox` staff inbox, sign in as `staff@nimbus.demo` with `nimbus-demo`

Or run the production build in Docker:

```bash
docker compose up --build
```

The SQLite database lives in the `relaydesk-data` volume, so tickets survive a restart, and a `backup` service snapshots it daily. Settings come from `.env.docker` (copy `.env.example`). To put it online for free from your own computer with a Cloudflare Tunnel, or on a server, see [RUNBOOK.md → Hosting](RUNBOOK.md#hosting).

Answers go through a LangGraph loop. Retrieve help articles, write a reply, rewrite the query and search again if the first pass is weak. No API key still quotes when retrieve is confident. Out of corpus refuses and opens a ticket. Set `OPENAI_API_KEY` (and optional `OPENAI_BASE_URL`) if you want the generate and rewrite nodes to call the model.

OpenTelemetry spans sit on those nodes. [`eval/traces/extractive.txt`](eval/traces/extractive.txt) is the no-key path. [`eval/traces/llm-rewrite.txt`](eval/traces/llm-rewrite.txt) is the rewrite loop. See [eval/traces/README.md](eval/traces/README.md). Set the Langfuse keys in `.env.example` and the same spans go to Langfuse, with model calls as generations and each chat as one session.

## Demo path

1. Ask the widget about seats, SSO, API keys, or empty funnels.
2. It cites a help article.
3. Ask how to connect Nimbus to Salesforce, or tap **This didn't help**. The widget refuses and a ticket appears in `/inbox`.
4. Reply from `/inbox`.

Two fixture tickets are already in the inbox so it isn't empty on first open.

## Ask by voice

Tap the mic in the widget and ask out loud. The speech becomes text, the text goes through the same answer loop as a typed message, and the answer is read back. It keeps its citation in the chat, and a question the help center can't answer still opens a ticket. The voice says it passed the question to the team rather than reading the ticket id.

- **No key, no new service by default.** It uses the browser's own `SpeechRecognition` and `speechSynthesis`. Chrome, Edge and Safari support it. Firefox has no speech recognition, so the mic doesn't appear there unless the business uses ElevenLabs.
- **Speaking interrupts the bot.** Tapping the mic while an answer is being read stops it and listens, as it would on a call.
- **Spoken answers are trimmed for listening** by `spokenText` in [`src/lib/voice.ts`](src/lib/voice.ts): no links or markdown read aloud, and long answers stop at a sentence with "The rest is in the chat."
- **Traces say which was which.** Voice questions carry `channel=voice` on the `support.answer` span and in Langfuse trace metadata, since their text is a speech-to-text transcript and can be misheard.
- **Language** follows the widget's `voiceLang` prop, `en-US` by default. Chrome also recognizes `en-PH` and `fil-PH`.

### Email when a ticket opens

With `RESEND_API_KEY` on the server, every staff member of a business gets an email when Relaydesk opens a ticket. The email has the customer's question, their email if they left one, and a link to the ticket. Set `RELAYDESK_EMAIL_FROM` to a sender on a domain you verified in Resend. If the email fails, the ticket is still in `/inbox` and the chat carries on.

### ElevenLabs, per business

With `ELEVENLABS_API_KEY` on the server, a business can switch its widget to ElevenLabs under **Setup → Voice**. The widget then records the question, ElevenLabs Scribe (`scribe_v2`) transcribes it, and the answer plays in an ElevenLabs voice. That works in every browser with a microphone, Firefox included. The browser's voice stays the default and the fallback.

- **The key never reaches the browser.** The widget only talks to relaydesk: `GET /api/voice` says which voice to use, `POST /api/transcribe` takes the recording, and `GET /api/speech` streams the answer. `/api/speech` only reads a stored answer from that business's conversation, never text the caller sends, and each answer at most twice.
- **A monthly cap per business stops runaway cost.** Speech in and out both count, as minutes per calendar month (UTC), `RELAYDESK_VOICE_MINUTES` (300 by default). Speech in is timed from Scribe's transcript. Speech out is estimated at 15 characters a second, since ElevenLabs bills it by character. Setup shows the minutes used. When they run out, the widget switches back to the browser's voice until the 1st.
- **It stops when the visitor pauses**, like the browser's recognizer, or when they tap stop. Questions are capped at 30 seconds.
- **Anything that fails falls back.** If a transcription fails, the visitor is asked to try again. If ElevenLabs is off or out of minutes, the next question uses the browser's recognizer. If the answer's audio can't play, the browser reads it.
- **Voice and model** are set by `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL`. See [`.env.example`](.env.example).

[`e2e/voice.spec.ts`](e2e/voice.spec.ts) drives both in Chromium: a fake recognizer that "hears" a set question for the browser's voice, and a fake microphone and stubbed `/api/voice`, `/api/transcribe` and `/api/speech` for ElevenLabs. The e2e server has no key, so the real routes are checked to refuse.

## Work the inbox from Claude (MCP)

`/api/mcp` is an MCP server (Streamable HTTP) over the inbox, so staff can say "summarize the open tickets" or "draft replies for the billing ones" in Claude, Cursor, or any MCP client. It follows the co-pilot's rule: an agent can read, triage, and **draft**, but nothing reaches the customer until a person presses **Send** in `/inbox`. There is no tool that posts a message.

| Tool | Does | Writes |
| --- | --- | --- |
| `list_tickets` | Tickets, filtered by `status`, `assignee`, `has_draft` | no |
| `get_ticket` | The conversation, pending draft, and recent co-pilot runs | no |
| `search_help_center` | The widget's retrieval, with slugs to cite | no |
| `get_article` | One article by slug | no |
| `update_ticket` | Status and assignee, with the inbox's own checks | the ticket |
| `draft_reply` | Saves a draft for review, replacing the pending one | a draft |
| `regenerate_draft` | Runs the co-pilot, with its on/off switch and daily limit | a draft |

Each business makes its own token under **Setup → Work the inbox from an AI assistant**, and every tool only sees that business. For the Nimbus demo, set `RELAYDESK_MCP_TOKEN` instead. With neither, `/api/mcp` returns 404.

```bash
claude mcp add --transport http relaydesk http://127.0.0.1:3000/api/mcp \
  --header "Authorization: Bearer $RELAYDESK_MCP_TOKEN"
```

A recorded Claude Code run, after asking the widget "How do I connect Nimbus to Salesforce?":

> **You:** What's open in the relaydesk inbox? Draft a reply for the Salesforce one.
>
> **Claude:** *calls `list_tickets {status: "open"}`, `get_ticket`, then `search_help_center` three times ("Salesforce integration", "integrations", "CRM API webhook Zapier connect").* There's no Salesforce article, so the draft says there's no built-in connector and offers the read-key query API or a CSV export one way, and write-key events the other. *calls `draft_reply` with `citations: ["api-keys", "csv-export"]`.*

The draft replaced the co-pilot's holding reply as the ticket's pending draft. The conversation still held only the customer's question and the bot's refusal. Open the ticket in `/inbox`: the draft is in the **Suggested reply** card, and **Send** posts it to the customer. Every tool call is an `mcp.<tool>` span, so it shows up in Langfuse next to chat and co-pilot runs.

## More than one business

Nimbus is the demo business. Each business has its own articles, widget, inbox, and settings, and one business's staff can't open another's tickets or conversations.

A shop owner sets up without you:

1. **Sign up** at `/signup` with a business name, a link (`/h/<link>`), and their login. Set `RELAYDESK_SIGNUP_CODE` to make sign-up invite-only.
2. **Add articles** in the inbox under **Articles**: one at a time, or paste an FAQ as Markdown (`## Question` then the answer) or JSON.
3. **Try the chat** under **Setup**. It answers like the widget but saves nothing.
4. **Go live.** Until then the help center, widget, and chat API return 404 to the public.
5. **Copy the embed snippet** from **Setup** into their site.
6. **Invite staff** under **Team**. Each invite is a one-time link that expires in 7 days; there's no email sending, so they send it themselves.

To set a business up for someone, there's also a script that takes a JSON file of articles (`title`, `body`, and optional `slug`, `category`, `summary`). Businesses it creates are live:

```bash
npx tsx scripts/add-business.ts --id acme --name "Acme Coffee" \
  --articles acme-articles.json --staff-email owner@acme.ph --staff-name Ana
```

It prints a one-time staff password. The business then has:

- `/h/acme`, its public help center with the widget
- `/inbox`, where its staff sign in and see only Acme tickets
- the widget on its own site, from one script tag:

```html
<script src="https://YOUR-RELAYDESK-HOST/embed.js" data-business="acme" async></script>
```

Run the script again with `--articles` to replace the help center. The next chat answers from the new articles.

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

CPU benchmarks for retrieval, escalation, conversation context, redaction, and article import live in [`bench/`](bench) and run on [CodSpeed](https://app.codspeed.io/JohnCarl-30/relaydesk) for every push and PR:

```bash
npm run bench     # vitest bench, keyless
```

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
