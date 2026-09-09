import { join } from "node:path";
import { ARTICLES, type Article } from "./articles";
import { CHUNKS } from "./chunks";

type Extractor = (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{
  data: Float32Array | number[];
}>;

let extractorPromise: Promise<Extractor> | null = null;
let articleCache: { article: Article; vec: number[]; text: string }[] | null = null;
let chunkCache: { article: Article; vec: number[]; text: string; chunkId: string }[] | null =
  null;

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

export async function articleEmbeddings(): Promise<
  { article: Article; vec: number[]; text: string }[]
> {
  if (articleCache) return articleCache;
  articleCache = [];
  for (const article of ARTICLES) {
    const text = `${article.title}\n\n${article.body}`;
    const vec = await embedQuery(`${article.title}\n${article.summary}\n${article.body}`);
    articleCache.push({ article, vec, text });
  }
  return articleCache;
}

export async function chunkEmbeddings(): Promise<
  { article: Article; vec: number[]; text: string; chunkId: string }[]
> {
  if (chunkCache) return chunkCache;
  chunkCache = [];
  for (const chunk of CHUNKS) {
    const text = `${chunk.article.title}\n\n${chunk.text}`;
    const vec = await embedQuery(text);
    chunkCache.push({
      article: chunk.article,
      vec,
      text,
      chunkId: chunk.id,
    });
  }
  return chunkCache;
}
