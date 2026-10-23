import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseJsonArticles, parseMarkdownArticles, slugify, toArticle } from "./article-import";

describe("parseMarkdownArticles", () => {
  it("makes one article per ## heading, with # headings as categories", () => {
    const articles = parseMarkdownArticles(`# Orders
## Where do you deliver?
We deliver within Metro Manila in 1 to 2 days. Elsewhere takes longer.

Tracking comes by SMS.

## Can I change my order?
Message us within an hour.

# Store
## Store hours
7 am to 9 pm.`);
    assert.deepEqual(
      articles.map((a) => [a.slug, a.category, a.title]),
      [
        ["where-do-you-deliver", "Orders", "Where do you deliver?"],
        ["can-i-change-my-order", "Orders", "Can I change my order?"],
        ["store-hours", "Store", "Store hours"],
      ],
    );
    assert.equal(articles[0].body, "We deliver within Metro Manila in 1 to 2 days. Elsewhere takes longer.\n\nTracking comes by SMS.");
    assert.equal(articles[0].summary, "We deliver within Metro Manila in 1 to 2 days.");
  });

  it("files articles before any # heading under General", () => {
    assert.equal(parseMarkdownArticles("## Hours\nOpen daily.")[0].category, "General");
  });

  it("explains text that isn't under an article heading", () => {
    assert.throws(() => parseMarkdownArticles("Just some text"), /## /);
    assert.throws(() => parseMarkdownArticles("## Empty\n\n## Next\nbody"), /"Empty" has no text/);
    assert.throws(() => parseMarkdownArticles(""), /No articles/);
  });

  it("refuses two articles that would share a link", () => {
    assert.throws(() => parseMarkdownArticles("## Hours\na\n## Hours!\nb"), /share the link "hours"/);
  });
});

describe("parseJsonArticles", () => {
  it("fills in slug, category, and summary", () => {
    const [article] = parseJsonArticles('[{"title":"Gift cards?","body":"Yes. From 500 pesos."}]');
    assert.deepEqual(article, {
      slug: "gift-cards",
      title: "Gift cards?",
      category: "General",
      summary: "Yes.",
      body: "Yes. From 500 pesos.",
    });
  });

  it("names the article that's wrong", () => {
    assert.throws(() => parseJsonArticles("not json"), /valid JSON/);
    assert.throws(() => parseJsonArticles('[{"title":"ok","body":"x"},{"title":"no body"}]'), /Article 2/);
  });
});

describe("slugify", () => {
  it("makes URL-safe links from any title", () => {
    assert.equal(slugify("Paano mag-order? (Tagalog)"), "paano-mag-order-tagalog");
    assert.equal(slugify("Café hours"), "cafe-hours");
    assert.equal(slugify("???"), "article");
  });

  it("keeps an explicit slug", () => {
    assert.equal(toArticle({ slug: "hours", title: "Store hours", body: "7 to 9." }).slug, "hours");
  });
});
