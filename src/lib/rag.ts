import { ARTICLES, type Article } from "./articles";

const STOP = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "our",
  "how",
  "what",
  "when",
  "does",
  "with",
  "from",
  "this",
  "that",
  "have",
  "has",
  "was",
  "into",
  "your",
  "about",
]);

export type Citation = { slug: string; title: string };

export type RagResult = {
  answer: string;
  citations: Citation[];
  confident: boolean;
  usedLlm: boolean;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export function retrieve(question: string, k = 3): { article: Article; score: number }[] {
  const q = tokenize(question);
  if (q.length === 0) return [];
  const scored = ARTICLES.map((article) => {
    const titleToks = tokenize(article.title);
    const bodyToks = tokenize(article.body);
    let score = 0;
    for (const term of q) {
      if (titleToks.includes(term)) score += 4;
      score += bodyToks.filter((t) => t === term).length;
    }
    return { article, score };
  });
  return scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function extractiveAnswer(question: string, hits: { article: Article; score: number }[]): RagResult {
  if (hits.length === 0) {
    return {
      answer:
        "I don't have that in the Nimbus help center. Leave your email and a teammate will pick this up.",
      citations: [],
      confident: false,
      usedLlm: false,
    };
  }
  const top = hits[0];
  const sentences = top.article.body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const q = new Set(tokenize(question));
  const ranked = [...sentences].sort((a, b) => {
    const sa = tokenize(a).filter((t) => q.has(t)).length;
    const sb = tokenize(b).filter((t) => q.has(t)).length;
    return sb - sa;
  });
  const picked = ranked.slice(0, 2).join(" ");
  return {
    answer: `${picked}\n\nThat's from “${top.article.title}”. If this isn't the case you're in, talk to a person.`,
    citations: hits.map((h) => ({ slug: h.article.slug, title: h.article.title })),
    confident: top.score >= 6,
    usedLlm: false,
  };
}

async function llmAnswer(question: string, hits: { article: Article; score: number }[]): Promise<RagResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return extractiveAnswer(question, hits);
  if (hits.length === 0) return extractiveAnswer(question, hits);

  const context = hits
    .map(
      (h, i) =>
        `[${i + 1}] ${h.article.title}\n${h.article.body}`,
    )
    .join("\n\n");

  const base = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are the Nimbus support assistant on a customer site. Answer only from the provided help articles. Be short. If the articles do not contain the answer, say you are unsure and suggest talking to a human. Mention article titles naturally. Do not invent policies, prices, or product behavior.",
        },
        {
          role: "user",
          content: `Question: ${question}\n\nHelp articles:\n${context}`,
        },
      ],
    }),
  });

  if (!response.ok) return extractiveAnswer(question, hits);
  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) return extractiveAnswer(question, hits);

  return {
    answer: text,
    citations: hits.map((h) => ({ slug: h.article.slug, title: h.article.title })),
    confident: true,
    usedLlm: true,
  };
}

export async function answerQuestion(question: string): Promise<RagResult> {
  const hits = retrieve(question);
  try {
    return await llmAnswer(question, hits);
  } catch {
    return extractiveAnswer(question, hits);
  }
}
