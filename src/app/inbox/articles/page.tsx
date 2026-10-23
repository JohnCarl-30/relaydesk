import { redirect } from "next/navigation";
import { Section } from "@/components/admin";
import { currentStaff } from "@/lib/auth";
import { getBusiness, listArticles } from "@/lib/db";
import { ArticleEditor, ArticleList, ImportArticles } from "./article-forms";

export default async function ArticlesPage() {
  const staff = await currentStaff();
  if (!staff) redirect("/login");
  const business = getBusiness(staff.business_id);
  if (!business) redirect("/login");
  const articles = listArticles(business.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-medium tracking-tight">Help articles</h1>
      <p className="mt-1 text-sm text-muted">
        The chat answers only from these. One question per article works best: a title the way a
        customer would ask it, and the answer underneath.
      </p>
      <div className="mt-8">
        <Section title={`${articles.length} ${articles.length === 1 ? "article" : "articles"}`}>
          <ArticleList articles={articles} />
        </Section>
        <Section title="New article">
          <ArticleEditor />
        </Section>
        <Section
          title="Import"
          description="Paste an FAQ you already have. In Markdown, each “## ” line starts an article and a “# ” line sets the category for the ones below it."
        >
          <ImportArticles />
        </Section>
      </div>
    </main>
  );
}
