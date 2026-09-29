import fs from "node:fs/promises";

const CANDIDATE = "data/feed-candidates.json";
const LIVE = "data/feed.json";

async function main() {
  const candidate = JSON.parse(
    await fs.readFile(CANDIDATE, "utf8")
  );

  const live = JSON.parse(
    await fs.readFile(LIVE, "utf8")
  );

  const approvedNews = Array.isArray(candidate.news)
    ? candidate.news.filter(
        item => item && item.reviewStatus === "approved"
      )
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

  await fs.writeFile(
    LIVE,
    JSON.stringify(published, null, 2) + "\n",
    "utf8"
  );

  console.log(
    `Published ${published.news.length} approved Cineinsta news stories.`
  );
}

main().catch(error => {
  console.error("");
  console.error("Cineinsta publish failed:");
  console.error(error);
  process.exit(1);
});
