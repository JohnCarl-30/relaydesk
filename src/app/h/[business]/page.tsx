import { notFound } from "next/navigation";
import { HelpIndex } from "@/components/HelpIndex";
import { helpCenterPath, loadLiveHelpCenter } from "@/lib/business";

export default async function HostedHelpIndex({
  params,
}: {
  params: Promise<{ business: string }>;
}) {
  const center = loadLiveHelpCenter((await params).business);
  if (!center) notFound();
  return (
    <HelpIndex
      articles={center.corpus.articles}
      base={helpCenterPath(center.businessId)}
      intro={`Articles from ${center.name}. The chat answers from these too.`}
    />
  );
}
