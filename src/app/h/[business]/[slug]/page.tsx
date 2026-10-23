import { notFound } from "next/navigation";
import { HelpArticle } from "@/components/HelpArticle";
import { helpCenterPath, loadLiveHelpCenter } from "@/lib/business";
import { articleBySlug } from "@/lib/help-center";

export default async function HostedHelpArticle({
  params,
}: {
  params: Promise<{ business: string; slug: string }>;
}) {
  const { business, slug } = await params;
  const center = loadLiveHelpCenter(business);
  const article = center && articleBySlug(center, slug);
  if (!center || !article) notFound();
  return (
    <HelpArticle
      article={article}
      articles={center.corpus.articles}
      base={helpCenterPath(center.businessId)}
    />
  );
}
