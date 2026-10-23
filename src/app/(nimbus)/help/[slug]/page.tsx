import { notFound } from "next/navigation";
import { HelpArticle } from "@/components/HelpArticle";
import { loadHelpCenter } from "@/lib/business";
import { DEMO_WIDGET } from "@/lib/demo";
import { articleBySlug } from "@/lib/help-center";

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const center = loadHelpCenter(DEMO_WIDGET.business.id);
  const article = center && articleBySlug(center, slug);
  if (!center || !article) notFound();
  return (
    <HelpArticle article={article} articles={center.corpus.articles} base={DEMO_WIDGET.helpBase} />
  );
}
