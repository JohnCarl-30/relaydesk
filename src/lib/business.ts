import { getBusiness, listArticles } from "./db";
import {
  DEMO_BUSINESS_ID,
  DEMO_HELP_CENTER,
  GENERIC_SEARCH_HINT,
  type HelpCenter,
} from "./help-center";
import { buildCorpus } from "./rag";

export type { HelpCenter };

// One search index per business, rebuilt when its articles_version moves.
const cache = new Map<string, { version: number; center: HelpCenter }>();

/** The business's help center from the database, or undefined for an unknown id. */
export async function loadHelpCenter(businessId: string): Promise<HelpCenter | undefined> {
  const business = await getBusiness(businessId);
  if (!business) return undefined;
  const cached = cache.get(business.id);
  if (cached && cached.version === business.articles_version && cached.center.name === business.name) {
    return cached.center;
  }
  const center: HelpCenter = {
    businessId: business.id,
    name: business.name,
    corpus: buildCorpus(await listArticles(business.id)),
    searchHint:
      business.id === DEMO_BUSINESS_ID ? DEMO_HELP_CENTER.searchHint : GENERIC_SEARCH_HINT,
  };
  cache.set(business.id, { version: business.articles_version, center });
  return center;
}

/** The help center the public may see: undefined until the business goes live. */
export async function loadLiveHelpCenter(businessId: string): Promise<HelpCenter | undefined> {
  return (await getBusiness(businessId))?.live ? loadHelpCenter(businessId) : undefined;
}

/** Where a business's public help center lives. */
export function helpCenterPath(businessId: string, slug?: string): string {
  const base = `/h/${businessId}`;
  return slug ? `${base}/${slug}` : base;
}
