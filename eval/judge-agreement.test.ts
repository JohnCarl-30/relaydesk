import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CALIBRATED_JUDGES,
  MIN_KAPPA,
  agreement,
  loadJson,
  pairsFor,
  type JudgeRuns,
  type LabeledAnswer,
} from "./judge-agreement";

const here = dirname(fileURLToPath(import.meta.url));

function pairs(counts: { both1: number; both0: number; humanOnly: number; judgeOnly: number }) {
  return [
    ...Array<{ human: 0 | 1; judge: 0 | 1 }>(counts.both1).fill({ human: 1, judge: 1 }),
    ...Array<{ human: 0 | 1; judge: 0 | 1 }>(counts.both0).fill({ human: 0, judge: 0 }),
    ...Array<{ human: 0 | 1; judge: 0 | 1 }>(counts.humanOnly).fill({ human: 1, judge: 0 }),
    ...Array<{ human: 0 | 1; judge: 0 | 1 }>(counts.judgeOnly).fill({ human: 0, judge: 1 }),
  ];
}

describe("agreement", () => {
  it("computes Cohen's kappa", () => {
    // observed 35/50 = 0.7; chance 0.5*0.6 + 0.5*0.4 = 0.5; kappa (0.7-0.5)/(1-0.5) = 0.4
    const a = agreement(pairs({ both1: 20, both0: 15, humanOnly: 5, judgeOnly: 10 }));
    assert.equal(a.agree, 35);
    assert.ok(Math.abs((a.kappa ?? NaN) - 0.4) < 1e-9);
    assert.equal(a.judgeMissed, 5);
    assert.equal(a.judgeLet, 10);
  });

  it("is 1 on perfect agreement and 0 for a judge that always says faithful", () => {
    assert.equal(agreement(pairs({ both1: 8, both0: 2, humanOnly: 0, judgeOnly: 0 })).kappa, 1);
    // 90% raw agreement, but the judge learned nothing: kappa catches it.
    assert.equal(agreement(pairs({ both1: 9, both0: 0, humanOnly: 0, judgeOnly: 1 })).kappa, 0);
  });

  it("leaves kappa undefined when both raters use one class", () => {
    assert.equal(agreement(pairs({ both1: 5, both0: 0, humanOnly: 0, judgeOnly: 0 })).kappa, null);
    assert.equal(agreement([]).kappa, null);
  });
});

describe("pairsFor", () => {
  const row = (question: string, label: 0 | 1 | null, path: "graph" | "agent" = "graph"): LabeledAnswer => ({
    question, answer: "", citations: [], model: "m", path, label, note: "",
  });

  it("skips unlabeled rows and rows without a verdict, and passes at 0.5", () => {
    const got = pairsFor([row("a", 1), row("b", 0), row("c", null), row("d", 1)], {
      "graph: a": { score: 0.5, reason: "" },
      "graph: b": { score: 0.49, reason: "" },
      "graph: c": { score: 1, reason: "" },
    });
    assert.deepEqual(got.map((p) => [p.row.question, p.human, p.judge]), [["a", 1, 1], ["b", 0, 0]]);
  });

  it("keeps the same question on each path apart", () => {
    const got = pairsFor([row("q", 1, "graph"), row("q", 0, "agent")], {
      "graph: q": { score: 1, reason: "" },
      "agent: q": { score: 0, reason: "" },
    });
    assert.deepEqual(got.map((p) => [p.row.path, p.human, p.judge]), [["graph", 1, 1], ["agent", 0, 0]]);
  });
});

describe("calibrated judges", () => {
  const labeled = loadJson<LabeledAnswer[]>(join(here, "faithfulness-labels.json"), []).filter((r) => r.label !== null);
  const runs = loadJson<JudgeRuns>(join(here, "judge-runs.json"), {});
  for (const name of CALIBRATED_JUDGES) {
    it(`${name} agrees with the labels at kappa >= ${MIN_KAPPA} on every labeled row`, () => {
      const got = pairsFor(labeled, runs[name] ?? {});
      assert.equal(got.length, labeled.length, `rerun eval/run-judge-agreement.ts with RELAYDESK_JUDGE_MODEL=${name}`);
      const { kappa } = agreement(got);
      assert.ok(kappa !== null && kappa >= MIN_KAPPA, `kappa ${kappa} < ${MIN_KAPPA}`);
    });
  }
});
