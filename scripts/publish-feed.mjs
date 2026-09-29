import fs from "node:fs/promises";

const CANDIDATE = "data/feed-candidates.json";
const LIVE = "data/feed.json";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNews(item) {
  const out = { ...item };

  // These are the fields the Cineinsta article page uses for original editorial content.
  out.title = clean(item.title || item.t);
  out.dek = clean(item.dek || item.summary || item.d);
  out.body = Array.isArray(item.body) ? item.body.map(clean).filter(Boolean) : [];
  out.keyFacts = Array.isArray(item.keyFacts) ? item.keyFacts.map(clean).filter(Boolean) : [];
  out.cineinstaContext = clean(item.cineinstaContext);
  out.sources = Array.isArray(item.sources)
    ? item.sources.map(clean).filter(Boolean)
    : (item.source ? [clean(item.source)] : []);
  out.originalUrl = clean(item.originalUrl || item.url || item.u);

  // Keep legacy fields so existing homepage/feed code continues to work.
  out.summary = out.dek;
  out.editorial = "Cineinsta";

  return out;
}

async function main() {
  const candidate = JSON.parse(await fs.readFile(CANDIDATE, "utf8"));
  const live = JSON.parse(await fs.readFile(LIVE, "utf8"));

  const approvedNews = Array.isArray(candidate.news)
    ? candidate.news
        .filter(item => item && item.reviewStatus === "approved")
        .map(normalizeNews)
    : [];

  if (approvedNews.length < 20) {
    throw new Error(
      `Only ${approvedNews.length} approved news stories found. At least 20 are required. Live feed was not changed.`
    );
  }

  const published = {
    updatedAt: new Date().toISOString(),
    language: candidate.language || "Telugu",
    news: approvedNews.slice(0, 30),
    trailers: Array.isArray(candidate.trailers)
      ? candidate.trailers
      : (live.trailers || []),
    interviews: Array.isArray(candidate.interviews)
      ? candidate.interviews
      : (live.interviews || []),
    reviews: Array.isArray(candidate.reviews)
      ? candidate.reviews
      : (live.reviews || [])
  };

  await fs.writeFile(LIVE, JSON.stringify(published, null, 2) + "\n", "utf8");
  console.log(`Published ${published.news.length} approved Cineinsta news stories.`);
  console.log(`Editorial fields are preserved: body/keyFacts/cineinstaContext/sources.`);
}

main().catch(error => {
  console.error("\nCineinsta publish failed:");
  console.error(error);
  process.exit(1);
});
