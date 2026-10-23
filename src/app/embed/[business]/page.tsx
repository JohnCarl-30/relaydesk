import { notFound } from "next/navigation";
import { Widget } from "@/components/Widget";
import { helpCenterPath, loadHelpCenter } from "@/lib/business";

/**
 * The widget alone, for the iframe public/embed.js puts on a business's own
 * site. The page is transparent so only the launcher and panel show.
 */
export default async function EmbedPage({
  params,
}: {
  params: Promise<{ business: string }>;
}) {
  const center = loadHelpCenter((await params).business);
  if (!center) notFound();
  return (
    <>
      <style>{"html, body { background: transparent !important; }"}</style>
      <Widget
        business={{ id: center.businessId, name: center.name }}
        helpBase={helpCenterPath(center.businessId)}
        embedded
      />
    </>
  );
}
