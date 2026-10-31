/** PR gate for relaydesk-intent, run by langfuse/experiment-action (.github/workflows/experiments.yml). */
import type { RunnerContext } from "@langfuse/client";
import { runGated } from "../suite";

// The action requires the parameter to be named `context`.
export async function experiment(context: RunnerContext) {
  return runGated(context, "intent");
}
