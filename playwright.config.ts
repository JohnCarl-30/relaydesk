import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { ADMIN_PASSWORD } from "./e2e/env";

// Uncommon default so other local apps on 3000/3100 do not block the run.
const PORT = Number(process.env.E2E_PORT ?? 3217);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Workers re-read this file; the env var keeps one fresh database per run.
process.env.RELAYDESK_E2E_DB ??= path.join(os.tmpdir(), `relaydesk-e2e-${Date.now()}.db`);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Production build on its own port, so a `next dev` on :3000 and its data are never touched.
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      // No key means extractive answers: deterministic and free.
      OPENAI_API_KEY: "",
      RELAYDESK_STUB_LLM: "",
      RELAYDESK_TRACE_FILE: "0",
      RELAYDESK_DB_PATH: process.env.RELAYDESK_E2E_DB,
      RELAYDESK_ADMIN_PASSWORD: ADMIN_PASSWORD,
    },
  },
});
