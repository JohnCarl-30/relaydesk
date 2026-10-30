import codspeedPlugin from "@codspeed/vitest-plugin";
import { defineConfig } from "vitest/config";

// Only used for the CodSpeed benchmarks in bench/. Unit tests run with `npm test` (node:test via tsx).
export default defineConfig({
  plugins: [codspeedPlugin()],
  test: {
    include: [],
    benchmark: {
      include: ["bench/**/*.bench.ts"],
    },
  },
});
