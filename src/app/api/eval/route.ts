import { NextResponse } from "next/server";
import { extractiveAnswer, retrieve } from "@/lib/rag";

/**
 * Harness contract: POST {"question"} → {"answer","retrieved_contexts"}.
 * Extractive on purpose so eval runs are keyless and reproducible.
 */
export async function POST(request: Request) {
  const variant =
    new URL(request.url).searchParams.get("variant") === "weak"
      ? "weak"
      : "baseline";
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

  const hits = retrieve(
    question,
    variant === "weak" ? { k: 1, titleWeight: 0 } : { k: 3, titleWeight: 4 },
  );
  const rag = extractiveAnswer(question, hits);
  return NextResponse.json({
    answer: rag.answer,
    retrieved_contexts: hits.map(
      (h) => `${h.article.title}\n\n${h.article.body}`,
    ),
    variant,
  });
}
