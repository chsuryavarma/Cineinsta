import Parser from "rss-parser";
import OpenAI from "openai";
import fs from "fs/promises";

const parser = new Parser({
  timeout: 20000,
  headers: {
    "User-Agent": "Cineinsta News Bot/1.0"
  }
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const FEED_FILE = "data/feed.json";

const queries = [
  ["Telugu", "Telugu cinema movie news"],
  ["Telugu", "Tollywood latest movie news"],
  ["Tamil", "Tamil cinema movie news"],
  ["Tamil", "Kollywood latest movie news"],
  ["Malayalam", "Malayalam cinema movie news"],
  ["Malayalam", "Mollywood latest movie news"],
  ["Kannada", "Kannada cinema movie news"],
  ["Kannada", "Sandalwood latest movie news"],
  ["Hindi", "Hindi cinema Bollywood movie news"],
  ["Hindi", "Bollywood latest movie news"],
  ["Indian", "Indian cinema latest movie news"],
  ["Indian", "Indian movie trailer teaser release news"],
  ["Indian", "Indian OTT movie news"],
  ["Indian", "Indian movie reviews"]
];

function googleNewsUrl(query) {
  return (
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query) +
    "&hl=en-IN&gl=IN&ceid=IN:en"
  );
}

function cleanText(text = "") {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(url = "") {
  try {
    return new URL(url).toString();
  } catch {
    return "";
  }
}

function stripTracking(url = "") {
  try {
    const u = new URL(url);

    [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ocid"
    ].forEach(p => u.searchParams.delete(p));

    return u.toString();
  } catch {
    return url;
  }
}

async function getImage(url) {

  if (!url) return "";

  try {

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 CineinstaBot/1.0"
      }
    });

    if (!response.ok) return "";

    const html = await response.text();

    const patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
    ];

    for (const pattern of patterns) {

      const match = html.match(pattern);

      if (match && match[1]) {
        return match[1]
          .replace(/&amp;/g, "&")
          .trim();
      }
    }

  } catch (error) {
    console.log("Image lookup failed:", url);
  }

  return "";
}

function detectLanguage(title, description, requestedLanguage) {

  const text =
    `${title} ${description}`.toLowerCase();

  if (
    requestedLanguage !== "Indian"
  ) {
    return requestedLanguage;
  }

  if (
    text.includes("telugu") ||
    text.includes("tollywood")
  ) {
    return "Telugu";
  }

  if (
    text.includes("tamil") ||
    text.includes("kollywood")
  ) {
    return "Tamil";
  }

  if (
    text.includes("malayalam") ||
    text.includes("mollywood")
  ) {
    return "Malayalam";
  }

  if (
    text.includes("kannada") ||
    text.includes("sandalwood")
  ) {
    return "Kannada";
  }

  if (
    text.includes("bollywood") ||
    text.includes("hindi")
  ) {
    return "Hindi";
  }

  return "Indian";
}

function makeId(title) {

  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function rewriteStory(item) {

  try {

    const response =
      await openai.responses.create({

        model: "gpt-5.6-luna",

        input: [
          {
            role: "system",
            content:
              `You are the editorial assistant for Cineinsta,
an Indian cinema news platform.

Rewrite the supplied cinema news item into original,
concise Cineinsta copy.

Do not copy article sentences.
Do not invent facts.
Do not exaggerate.
Do not give opinions unless the source explicitly reports
an opinion and it is clearly attributed.

Return JSON only with:
{
  "title": "...",
  "summary": "...",
  "category": "News|Review|Trailer|OTT|Release|Celebrity",
  "language": "Telugu|Tamil|Malayalam|Kannada|Hindi|Indian"
}

Title should be short and engaging.
Summary should be 1-2 sentences.`
          },
          {
            role: "user",
            content:
              JSON.stringify({
                title: item.title,
                description: item.description,
                source: item.source,
                language: item.language
              })
          }
        ]
      });

    const text =
      response.output_text || "";

    const parsed =
      JSON.parse(text);

    return parsed;

  } catch (error) {

    console.log(
      "AI rewrite failed:",
      error.message
    );

    return {
      title: item.title,
      summary:
        item.description ||
        "Latest Indian cinema update.",
      category: "News",
      language: item.language
    };
  }
}

async function collectStories() {

  const stories = [];

  for (const [language, query] of queries) {

    console.log(`Fetching: ${language} / ${query}`);

    try {

      const feed =
        await parser.parseURL(
          googleNewsUrl(query)
        );

      for (
        const item of (feed.items || []).slice(0, 8)
      ) {

        const title =
          cleanText(item.title || "");

        if (!title) continue;

        const source =
          item.creator ||
          item.source?.name ||
          feed.title ||
          "News";

        const description =
          cleanText(
            item.contentSnippet ||
            item.content ||
            item.summary ||
            ""
          );

        const url =
          stripTracking(
            normalizeUrl(
              item.link || ""
            )
          );

        if (!url) continue;

        stories.push({

          title,

          description,

          source,

          url,

          language:
            detectLanguage(
              title,
              description,
              language
            ),

          publishedAt:
            item.isoDate ||
            item.pubDate ||
            new Date().toISOString()

        });
      }

    } catch (error) {

      console.log(
        `RSS failed: ${query}`,
        error.message
      );

    }
  }

  return stories;
}

function deduplicate(stories) {

  const seen = new Set();

  return stories.filter(item => {

    const key =
      item.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

async function buildNewsFeed(stories) {

  const limited =
    stories.slice(0, 80);

  const results = [];

  for (const item of limited) {

    console.log(
      "Processing:",
      item.title
    );

    const rewritten =
      await rewriteStory(item);

    const image =
      await getImage(item.url);

    results.push({

      id:
        makeId(
          rewritten.title ||
          item.title
        ),

      t:
        rewritten.title ||
        item.title,

      d:
        rewritten.summary ||
        item.description,

      l:
        rewritten.language ||
        item.language,

      category:
        rewritten.category ||
        "News",

      img:
        image,

      imageSource:
        image
          ? item.url
          : "",

      source:
        item.source,

      u:
        item.url,

      publishedAt:
        item.publishedAt

    });
  }

  return results;
}

function buildReviews(news) {

  return news
    .filter(item =>
      item.category === "Review"
    )
    .slice(0, 20)
    .map(item => ({

      id: item.id,

      t: item.t,

      l: item.l,

      rating: "Review",

      img: item.img,

      imageSource:
        item.imageSource,

      source:
        item.source,

      u: item.u,

      summary:
        item.d,

      publishedAt:
        item.publishedAt

    }));
}

async function main() {

  console.log(
    "================================="
  );

  console.log(
    "CINEINSTA FEED UPDATE"
  );

  console.log(
    "================================="
  );

  const raw =
    await collectStories();

  console.log(
    `Collected ${raw.length} stories`
  );

  const unique =
    deduplicate(raw);

  console.log(
    `After deduplication: ${unique.length}`
  );

  unique.sort(
    (a,b) =>
      new Date(b.publishedAt) -
      new Date(a.publishedAt)
  );

  const news =
    await buildNewsFeed(unique);

  const reviews =
    buildReviews(news);

  const feed = {

    updatedAt:
      new Date().toISOString(),

    news:

      news.slice(0, 60),

    reviews,

    stats: {

      totalNews:
        news.length,

      totalReviews:
        reviews.length,

      languages: [
        "Telugu",
        "Tamil",
        "Malayalam",
        "Kannada",
        "Hindi"
      ]

    }

  };

  await fs.mkdir(
    "data",
    {
      recursive: true
    }
  );

  await fs.writeFile(
    FEED_FILE,
    JSON.stringify(
      feed,
      null,
      2
    ) + "\n"
  );

  console.log(
    `Wrote ${FEED_FILE}`
  );

  console.log(
    `News: ${news.length}`
  );

  console.log(
    `Reviews: ${reviews.length}`
  );

}

main().catch(error => {

  console.error(error);

  process.exit(1);

});
