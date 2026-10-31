import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatLike } from "../src/lib/graph";
import {
  answerTask,
  escalationMatch,
  escalationPrecisionRecall,
  faithfulnessJudge,
  hitAtK,
  intentDealPrecision,
  intentMatch,
  meanOf,
  parseJudgeReply,
  regressions,
  runLocal,
  type AnswerOutput,
} from "./experiments";
import { experimentSuite } from "./suite";

function output(partial: Partial<AnswerOutput>): AnswerOutput {
  return { answer: "", citations: [], escalated: false, usedLlm: false, retrieved: [], ...partial };
}

function judgeModel(reply: string, seen: string[] = []): ChatLike {
  return {
    invoke: async (messages) => {
      seen.push(messages.map((m) => m.content).join("\n"));
      return { content: reply };
    },
  };
}

describe("experiment evaluators", () => {
  it("scores hit@1 and hit@3 against the expected slug", async () => {
    const scores = await hitAtK({
      input: { question: "q" },
      output: output({ retrieved: ["billing-seats-events", "sso", "csv-export"] }),
      expectedOutput: { slug: "sso", answer: "" },
    });
    assert.deepEqual(
      (scores as { name: string; value: number }[]).map((s) => [s.name, s.value]),
      [
        ["hit_at_1", 0],
        ["hit_at_3", 1],
      ],
    );
  });

  it("gives out-of-corpus rows no hit@k score", async () => {
    const scores = await hitAtK({ input: {}, output: output({}), expectedOutput: { slug: null, answer: "" } });
    assert.deepEqual(scores, []);
  });

  it("scores escalation per item and as precision and recall per run", async () => {
    const rows = [
      [true, true],
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ];
    const data = rows.map(([shouldEscalate, escalated]) => ({
      input: { question: `${shouldEscalate}-${escalated}` },
      expectedOutput: { shouldEscalate },
      metadata: { escalated },
    }));
    const result = await runLocal({
      data,
      task: async (item) => output({ escalated: (item.metadata as { escalated: boolean }).escalated }),
      evaluators: [escalationMatch],
      runEvaluators: [escalationPrecisionRecall, meanOf("escalation_correct")],
    });
    const run = Object.fromEntries(result.runEvaluations.map((e) => [e.name, e.value]));
    assert.equal(run.escalation_precision, 2 / 3);
    assert.equal(run.escalation_recall, 2 / 3);
    assert.equal(run.escalation_correct, 3 / 5);
  });

  it("scores intent per item, and deal precision only over lead and upgrade calls", async () => {
    const rows: [string, string][] = [
      ["lead", "lead"],
      ["upgrade", "upgrade"],
      ["churn_risk", "none"],
      ["none", "lead"],
      ["none", "none"],
    ];
    const result = await runLocal({
      data: rows.map(([expected, got]) => ({ input: { question: `${expected}-${got}` }, expectedOutput: { intent: expected }, metadata: { got } })),
      task: async (item) => ({ intent: (item.metadata as { got: string }).got, reason: "test" }),
      evaluators: [intentMatch],
      runEvaluators: [intentDealPrecision, meanOf("intent_correct")],
    });
    const run = Object.fromEntries(result.runEvaluations.map((e) => [e.name, e.value]));
    assert.equal(run.intent_correct, 3 / 5);
    assert.equal(run.intent_deal_precision, 2 / 3);
  });

  it("leaves a run score out when no item had one", async () => {
    const result = await runLocal({
      data: [{ input: { question: "q" }, expectedOutput: { slug: null, answer: "" } }],
      task: async () => output({}),
      evaluators: [hitAtK],
      runEvaluators: [meanOf("hit_at_1", "faithfulness")],
    });
    assert.deepEqual(result.runEvaluations, []);
  });
});

describe("faithfulness judge", () => {
  it("sends the cited articles and returns the judge's score", async () => {
    const seen: string[] = [];
    const judge = faithfulnessJudge(judgeModel('```json\n{"score": 0.5, "reason": "price not in article"}\n```', seen));
    const score = await judge({
      input: { question: "Is JIT provisioning on by default?" },
      output: output({ answer: "No, turn it on in settings.", citations: ["sso"] }),
    });
    assert.deepEqual(score, { name: "faithfulness", value: 0.5, comment: "price not in article" });
    assert.match(seen[0], /JIT provisioning on by default/);
    assert.match(seen[0], /\[1\] .*SSO/i);
  });

  it("skips escalations and answers without citations", async () => {
    const seen: string[] = [];
    const judge = faithfulnessJudge(judgeModel('{"score": 1}', seen));
    assert.deepEqual(await judge({ input: { question: "q" }, output: output({ escalated: true, citations: ["sso"] }) }), []);
    assert.deepEqual(await judge({ input: { question: "q" }, output: output({ citations: [] }) }), []);
    assert.equal(seen.length, 0);
  });

  it("rejects replies without a score in range", () => {
    assert.deepEqual(parseJudgeReply('ok {"score": 1, "reason": "fine"}'), { score: 1, reason: "fine" });
    assert.throws(() => parseJudgeReply("looks good"), /no JSON/);
    assert.throws(() => parseJudgeReply('{"score": 7}'), /out of range/);
  });
});

describe("answer task", () => {
  it("returns the widget's answer with cited and retrieved slugs", async () => {
    const task = answerTask(async () => ({
      answer: "Exports cap at 500,000 rows.",
      citations: [{ slug: "csv-export" }],
      escalated: false,
      usedLlm: false,
    }));
    const out = (await task({ input: { question: "What is the CSV export row cap?" } })) as AnswerOutput;
    assert.deepEqual(out.citations, ["csv-export"]);
    assert.equal(out.retrieved[0], "csv-export");
  });
});

describe("gate thresholds", () => {
  const thresholds = [
    { name: "hit_at_1", min: 0.83 },
    { name: "faithfulness", min: 0.8, optional: true },
  ];

  it("passes at or above every threshold", () => {
    assert.deepEqual(regressions([{ name: "hit_at_1", value: 50 / 60 }, { name: "faithfulness", value: 0.8 }], thresholds), []);
  });

  it("names each score below its threshold", () => {
    assert.deepEqual(regressions([{ name: "hit_at_1", value: 49 / 60 }, { name: "faithfulness", value: 0.5 }], thresholds), [
      "hit_at_1 0.8167 < 0.83",
      "faithfulness 0.5000 < 0.8",
    ]);
  });

  it("fails a missing required score and skips a missing optional one", () => {
    assert.deepEqual(regressions([], thresholds), ["hit_at_1 missing (needs >= 0.83)"]);
  });
});

describe("experiment suite", () => {
  it("passes its own thresholds on the CSVs", async () => {
    const { experiments, task } = experimentSuite();
    for (const experiment of experiments) {
      const data = experiment.localItems().map(({ input, expectedOutput }) => ({ input, expectedOutput }));
      const { runEvaluations } = await runLocal({ data, ...experiment, task: experiment.task ?? task });
      assert.deepEqual(regressions(runEvaluations, experiment.thresholds), [], experiment.dataset);
    }
  });
});
