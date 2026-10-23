import { notFound } from "next/navigation";
import { connection } from "next/server";
import { HelpIndex } from "@/components/HelpIndex";
import { loadHelpCenter } from "@/lib/business";
import { DEMO_CATEGORY_BLURBS, DEMO_HELP_INTRO, DEMO_WIDGET } from "@/lib/demo";

export default async function HelpIndexPage() {
  await connection();
  const center = loadHelpCenter(DEMO_WIDGET.business.id);
  if (!center) notFound();
  return (
    <HelpIndex
      articles={center.corpus.articles}
      base={DEMO_WIDGET.helpBase}
      intro={DEMO_HELP_INTRO}
      categoryBlurbs={DEMO_CATEGORY_BLURBS}
    />
  );
}
