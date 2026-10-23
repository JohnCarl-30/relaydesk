import { join } from "node:path";
import type { Article } from "./articles";
import type { Corpus } from "./rag";

type Extractor = (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{
  data: Float32Array | number[];
}>;

let extractorPromise: Promise<Extractor> | null = null;
type ArticleVec = { article: Article; vec: number[]; text: string };
type ChunkVec = ArticleVec & { chunkId: string };

// Keyed by corpus, so a business's edited articles get fresh vectors.
const articleCache = new WeakMap<Corpus, ArticleVec[]>();
const chunkCache = new WeakMap<Corpus, ChunkVec[]>();

async function getExtractor(): Promise<Extractor> {
  extractorPromise ??= (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir = join(process.cwd(), ".cache/transformers");
    const pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    return pipe as unknown as Extractor;
  })();
  return extractorPromise;
}

export async function embedQuery(text: string): Promise<number[]> {
  const pipe = await getExtractor();
  const out = await pipe(text, { pooling: "mean", normalize: true });
  return Array.from(out.data);
}

export async function articleEmbeddings(corpus: Corpus): Promise<ArticleVec[]> {
  const cached = articleCache.get(corpus);
  if (cached) return cached;
  const rows: ArticleVec[] = [];
  for (const article of corpus.articles) {
    const text = `${article.title}\n\n${article.body}`;
    const vec = await embedQuery(`${article.title}\n${article.summary}\n${article.body}`);
    rows.push({ article, vec, text });
  }
  articleCache.set(corpus, rows);
  return rows;
}

export async function chunkEmbeddings(corpus: Corpus): Promise<ChunkVec[]> {
  const cached = chunkCache.get(corpus);
  if (cached) return cached;
  const rows: ChunkVec[] = [];
  for (const chunk of corpus.chunks) {
    const text = `${chunk.article.title}\n\n${chunk.text}`;
    const vec = await embedQuery(text);
    rows.push({
      article: chunk.article,
      vec,
      text,
      chunkId: chunk.id,
    });
  }
  chunkCache.set(corpus, rows);
  return rows;
}
