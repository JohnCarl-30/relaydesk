import { NextResponse } from "next/server";
import { generateFromHits } from "@/lib/graph";
import { extractiveAnswer, retrieve, retrieveHybrid, type RetrieveOptions } from "@/lib/rag";
import { retrieveMaybeRewrite } from "@/lib/rewrite";

export const runtime = "nodejs";

/**
 * Harness contract: POST {"question"} → {"answer","retrieved_contexts"}.
 * Extractive on purpose so eval runs are keyless and reproducible.
 * This route never writes tickets.
 *
 * Variants:
 * - baseline (default): bag-of-words, top-3, title weight 4. Locked CI gate.
 * - norewrite: same as baseline. Named so the rewrite A/B has an off switch.
 * - rewrite: second retrieve when the first pass is weak. Keyless query is the
 *   same tokens retrieve already uses. A/B only. Do not use as CI default.
 * - weak: bag-of-words, top-1, no title boost. Known recall drop.
 * - bm25: Okapi BM25 on title+body, top-3, title weight 4. A/B only.
 * - hybrid: bag-of-words + MiniLM cosine, RRF fuse, top-3 articles. A/B only.
 * - chunked: bag-of-words over paragraphs, title as a field, top-3 chunks. A/B only.
 * - hybrid-chunked: hybrid over paragraphs. A/B only.
 * - always-answer: same retriever as baseline, never escalate, quotes even on OOS.
 *   A/B for the escalation metric only. Do not use as CI default.
 * - generate: same retrieve as baseline, then the generate-node prompt when
 *   OPENAI_API_KEY is set. Empty hits, no key, or shouldEscalate fall back to
 *   extractiveAnswer. Rewrite stays off. A/B only. Do not use as CI default.
 */
function retrieveOptions(variant: string | null): {
  variant:
    | "baseline"
    | "norewrite"
    | "rewrite"
    | "weak"
    | "bm25"
    | "hybrid"
    | "chunked"
    | "hybrid-chunked"
    | "always-answer"
    | "generate";
  options: RetrieveOptions;
  alwaysAnswer: boolean;
  extraRetrieve: boolean;
  generator: "extractive" | "llm";
} {
  if (variant === "always-answer") {
    return {
      variant: "always-answer",
      options: { mode: "count", k: 3, titleWeight: 4 },
      alwaysAnswer: true,
      extraRetrieve: false,
      generator: "extractive",
    };
  }
  if (variant === "rewrite") {
    return {
      variant: "rewrite",
      options: { mode: "count", k: 3, titleWeight: 4 },
      alwaysAnswer: false,
      extraRetrieve: true,
      generator: "extractive",
    };
  }
  if (variant === "norewrite") {
    return {
      variant: "norewrite",
      options: { mode: "count", k: 3, titleWeight: 4 },
      alwaysAnswer: false,
      extraRetrieve: false,
      generator: "extractive",
    };
  }
  if (variant === "weak") {
    return {
      variant: "weak",
      options: { mode: "count", k: 1, titleWeight: 0 },
      alwaysAnswer: false,
      extraRetrieve: false,
      generator: "extractive",
    };
  }
  if (variant === "bm25") {
    return {
      variant: "bm25",
      options: { mode: "bm25", k: 3, titleWeight: 4 },
      alwaysAnswer: false,
      extraRetrieve: false,
      generator: "extractive",
    };
  }
  if (variant === "hybrid") {
    return {
      variant: "hybrid",
      options: { mode: "hybrid", k: 3, titleWeight: 4 },
      alwaysAnswer: false,
      extraRetrieve: false,
      generator: "extractive",
    };
  }
  if (variant === "chunked") {
    return {
      variant: "chunked",
      options: { mode: "count", unit: "chunk", k: 3, titleWeight: 4 },
      alwaysAnswer: false,
      extraRetrieve: false,
      generator: "extractive",
    };
  }
  if (variant === "hybrid-chunked") {
    return {
      variant: "hybrid-chunked",
      options: { mode: "hybrid", unit: "chunk", k: 3, titleWeight: 4 },
      alwaysAnswer: false,
      extraRetrieve: false,
      generator: "extractive",
    };
  }
  if (variant === "generate") {
    return {
      variant: "generate",
      options: { mode: "count", k: 3, titleWeight: 4 },
      alwaysAnswer: false,
      extraRetrieve: false,
      generator: "llm",
    };
  }
  return {
    variant: "baseline",
    options: { mode: "count", k: 3, titleWeight: 4 },
    alwaysAnswer: false,
    extraRetrieve: false,
    generator: "extractive",
  };
}

export async function POST(request: Request) {
  const { variant, options, alwaysAnswer, extraRetrieve, generator } = retrieveOptions(
    new URL(request.url).searchParams.get("variant"),
  );
  let body: { question?: unknown };
  try {
    body = (await request.json()) as { question?: unknown };
  } catch {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }
  const question = String(body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }

  const retrieved = extraRetrieve
    ? retrieveMaybeRewrite(question)
    : {
        hits:
          options.mode === "hybrid"
            ? await retrieveHybrid(question, options)
            : retrieve(question, options),
        rewrote: false,
      };
  const rag =
    generator === "llm"
      ? await generateFromHits(question, retrieved.hits)
      : extractiveAnswer(question, retrieved.hits, { alwaysAnswer });
  return NextResponse.json({
    answer: rag.answer,
    retrieved_contexts: retrieved.hits.map((h) => h.text),
    variant,
    escalated: rag.escalated,
    rewrote: retrieved.rewrote,
  });
}
