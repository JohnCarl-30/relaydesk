import { ARTICLES, type Article } from "./articles";

const MIN_CHUNK_CHARS = 40;

export type Chunk = {
  id: string;
  article: Article;
  text: string;
};

export function chunkArticles(articles: Article[] = ARTICLES): Chunk[] {
  const chunks: Chunk[] = [];
  for (const article of articles) {
    const paras = article.body
      .split(/\n\n+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= MIN_CHUNK_CHARS);
    const pieces = paras.length > 0 ? paras : [article.body.trim()].filter(Boolean);
    pieces.forEach((text, index) => {
      chunks.push({ id: `${article.slug}#${index}`, article, text });
    });
  }
  return chunks;
}

export const CHUNKS = chunkArticles();
