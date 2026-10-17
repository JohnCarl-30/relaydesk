/**
 * Keyless, reproducible runs for evals and tests: no model key, no stub model,
 * no spans appended to eval/traces/live.jsonl, and none sent to Langfuse.
 * Returns the model key it removed
 * so a script can restore it for a live pass.
 */
export function forceExtractiveAnswers(): string | undefined {
  const liveKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.RELAYDESK_STUB_LLM;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  process.env.RELAYDESK_TRACE_FILE = "0";
  return liveKey;
}
