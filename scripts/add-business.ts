/**
 * Puts a business on relaydesk by hand until self-serve setup (#16) exists.
 *
 *   npx tsx scripts/add-business.ts --id acme --name "Acme Coffee" \
 *     --articles acme-articles.json --staff-email owner@acme.ph --staff-name Ana
 *
 * Run it again with --articles to replace the help center, or with --staff-email
 * to add another login. New logins get a random password, printed once, unless
 * RELAYDESK_NEW_STAFF_PASSWORD is set. Uses RELAYDESK_DB_PATH like the app.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { helpCenterPath } from "../src/lib/business";
import { createBusiness, createStaff, getBusiness, replaceArticles } from "../src/lib/db";

const ArticleInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/).optional(),
  title: z.string().min(1),
  category: z.string().min(1).default("General"),
  summary: z.string().default(""),
  body: z.string().min(1),
});

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Reads a JSON array of articles; a missing slug comes from the title. */
export function readArticles(file: string) {
  const parsed = z.array(ArticleInput).min(1).parse(JSON.parse(readFileSync(file, "utf8")));
  const articles = parsed.map((a) => ({ ...a, slug: a.slug ?? slugify(a.title) }));
  const seen = new Set<string>();
  for (const { slug } of articles) {
    if (seen.has(slug)) throw new Error(`two articles share the slug "${slug}"`);
    seen.add(slug);
  }
  return articles;
}

function main() {
  const { values } = parseArgs({
    options: {
      id: { type: "string" },
      name: { type: "string" },
      articles: { type: "string" },
      "staff-email": { type: "string" },
      "staff-name": { type: "string" },
    },
  });
  if (!values.id) throw new Error("--id is required");

  let business = getBusiness(values.id);
  if (!business) {
    if (!values.name) throw new Error(`no business "${values.id}" yet; pass --name to create it`);
    business = createBusiness({ id: values.id, name: values.name });
    console.log(`Created ${business.name} (${business.id}).`);
  }
  if (values.articles) {
    const articles = readArticles(values.articles);
    replaceArticles(business.id, articles);
    console.log(`Help center now has ${articles.length} articles.`);
  }
  if (values["staff-email"]) {
    const password =
      process.env.RELAYDESK_NEW_STAFF_PASSWORD ?? randomBytes(12).toString("base64url");
    const staff = createStaff({
      businessId: business.id,
      email: values["staff-email"],
      name: values["staff-name"] ?? values["staff-email"].split("@")[0],
      password,
    });
    console.log(`Staff login: ${staff.email}`);
    if (!process.env.RELAYDESK_NEW_STAFF_PASSWORD) console.log(`Password (shown once): ${password}`);
  }
  console.log(`Help center: ${helpCenterPath(business.id)}`);
  console.log(
    `Embed: <script src="https://YOUR-RELAYDESK-HOST/embed.js" data-business="${business.id}" async></script>`,
  );
}

if (process.argv[1]?.endsWith("add-business.ts")) main();
