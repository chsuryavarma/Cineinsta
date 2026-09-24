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
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHeadline(title = "") {
  let value = cleanText(title);

  const parts = value.split(" - ");

  if (parts.length > 1) {
    const last = parts[parts.length - 1].trim();

    if (
      last.length > 1 &&
      last.length < 80 &&
      !/[.!?]$/.test(last)
    ) {
      value = parts.slice(0, -1).join(" - ").trim();
    }
  }

  return value;
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

function getPublisher(item, cleanedTitle) {
  const source = item.source || {};

  if (typeof source === "string" && source.trim()) {
    return cleanText(source);
  }

  const sourceName =
    source.name ||
    source.title ||
    "";

  if (
    sourceName &&
    !/google news/i.test(sourceName)
  ) {
    return cleanText(sourceName);
  }

  const parts =
    cleanText(item.title || "").split(" - ");

  if (parts.length > 1) {
    const candidate =
      parts[parts.length - 1].trim();

    if (
      candidate &&
      candidate !== cleanedTitle
    ) {
      return candidate;
    }
  }

  return "Source";
}

function detectLanguage(
  title,
  description,
  requestedLanguage
) {
  const text =
    (title + " " + description).toLowerCase();

  if (requestedLanguage !== "Indian") {
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

async function fetchArticle(url) {
  if (!url) {
    return {
      html: "",
      finalUrl: ""
    };
  }

  try {
    const response =
      await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 CineinstaBot/1.0"
        }
      });

    if (!response.ok) {
      return {
        html: "",
        finalUrl: response.url || url
      };
    }

    return {
      html: await response.text(),
      finalUrl:
        response.url || url
    };
  } catch {
    return {
      html: "",
      finalUrl: url
    };
  }
}

function extractImage(html = "") {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i
  ];

  for (const pattern of patterns) {
    const match =
      html.match(pattern);

    if (match && match[1]) {
      return match[1]
        .replace(/&amp;/g, "&")
        .trim();
    }
  }

  return "";
}

function hostname(url = "") {
  try {
    return new URL(url)
      .hostname
      .replace(/^www\./, "");
  } catch {
    return "";
  }
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
              `You are the senior entertainment editor for Cineinsta, an Indian cinema news platform.

Create original, concise Cineinsta editorial copy from the supplied news metadata.

Rules:
- Do not copy sentences from the source.
- Do not invent facts.
- Do not invent names, dates, ratings, quotes or events.
- Do not exaggerate.
- Keep the tone factual, polished and entertainment-focused.
- Create a clean headline.
- NEVER include the publisher name in the headline.
- Summary must be 1-2 useful sentences.
- Reject irrelevant stories.

Relevant stories include:
Indian films,
Indian film actors,
Indian directors,
trailers,
teasers,
movie releases,
movie reviews,
OTT film releases,
Indian cinema business.

Reject:
Hollywood,
non-Indian movies,
TV-only stories,
sports,
politics,
music unrelated to films,
unrelated international entertainment.

Return JSON only:

{
  "relevant": true,
  "title": "...",
  "summary": "...",
  "category": "News|Review|Trailer|OTT|Release|Celebrity",
  "language": "Telugu|Tamil|Malayalam|Kannada|Hindi|Indian"
}`
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

    const parsed =
      JSON.parse(
        response.output_text || "{}"
      );

    if (
      !parsed ||
      parsed.relevant !== true
    ) {
      return null;
    }

    if (
      !parsed.title ||
      !parsed.summary
    ) {
      return null;
    }

    return {
      title:
        cleanHeadline(
          parsed.title
        ).slice(0, 140),

      summary:
        cleanText(
          parsed.summary
        ).slice(0, 420),

      category:
        [
          "News",
          "Review",
          "Trailer",
          "OTT",
          "Release",
          "Celebrity"
        ].includes(parsed.category)
          ? parsed.category
          : "News",

      language:
        [
          "Telugu",
          "Tamil",
          "Malayalam",
          "Kannada",
          "Hindi",
          "Indian"
        ].includes(parsed.language)
          ? parsed.language
          : item.language
    };

  } catch (error) {

    console.log(
      "AI rewrite failed:",
      error.message
    );

    return {
      title:
        cleanHeadline(
          item.title
        ),

      summary:
        cleanText(
          item.description
        ) ||
        "Latest Indian cinema update.",

      category:
        "News",

      language:
        item.language
    };
  }
}

async function collectStories() {

  const stories = [];

  for (
    const [language, query]
    of queries
  ) {

    console.log(
      "Fetching:",
      language,
      query
    );

    try {

      const feed =
        await parser.parseURL(
          googleNewsUrl(query)
        );

      for (
        const item of
        (feed.items || []).slice(0, 8)
      ) {

        const title =
          cleanHeadline(
            item.title || ""
          );

        if (!title) continue;

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

          source:
            getPublisher(
              item,
              title
            ),

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
        "RSS failed:",
        query,
        error.message
      );
    }
  }

  return stories;
}

function deduplicate(stories) {

  const seen =
    new Set();

  return stories.filter(
    item => {

      const key =
        item.title
          .toLowerCase()
          .replace(
            /[^a-z0-9]+/g,
            " "
          )
          .trim();

      if (
        !key ||
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
}

async function buildNewsFeed(
  stories
) {

  const limited =
    stories.slice(0, 80);

  const results = [];

  for (
    const item of limited
  ) {

    console.log(
      "Processing:",
      item.title
    );

    const rewritten =
      await rewriteStory(
        item
      );

    if (!rewritten) {

      console.log(
        "Rejected:",
        item.title
      );

      continue;
    }

    const article =
      await fetchArticle(
        item.url
      );

    const finalUrl =
      article.finalUrl &&
      !/news\.google\.com/i.test(
        article.finalUrl
      )
        ? stripTracking(
            article.finalUrl
          )
        : item.url;

    const image =
      extractImage(
        article.html
      );

    let source =
      item.source;

    if (
      !source ||
      /google news/i.test(
        source
      ) ||
      source === "Source"
    ) {

      source =
        hostname(
          finalUrl
        ) ||
        "Source";
    }

    results.push({

      id:
        makeId(
          rewritten.title
        ),

      t:
        rewritten.title,

      d:
        rewritten.summary,

      l:
        rewritten.language,

      category:
        rewritten.category,

      img:
        image,

      imageSource:
        image
          ? finalUrl
          : "",

      source,

      u:
        finalUrl,

      publishedAt:
        item.publishedAt
    });
  }

  return results;
}

function buildReviews(
  news
) {

  return news
    .filter(
      item =>
        item.category ===
        "Review"
    )
    .slice(0, 20)
    .map(
      item => ({

        id:
          item.id,

        t:
          item.t,

        l:
          item.l,

        rating:
          "Review",

        img:
          item.img,

        imageSource:
          item.imageSource,

        source:
          item.source,

        u:
          item.u,

        summary:
          item.d,

        publishedAt:
          item.publishedAt
      })
    );
}

async function readExistingFeed() {

  try {

    const raw =
      await fs.readFile(
        FEED_FILE,
        "utf8"
      );

    return JSON.parse(
      raw
    );

  } catch {

    return null;
  }
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
    "Collected:",
    raw.length
  );

  const unique =
    deduplicate(
      raw
    );

  console.log(
    "After deduplication:",
    unique.length
  );

  unique.sort(
    (a, b) =>
      new Date(
        b.publishedAt
      ) -
      new Date(
        a.publishedAt
      )
  );

  const news =
    await buildNewsFeed(
      unique
    );

  /*
   * Safety check:
   * Never replace a healthy feed
   * with an almost-empty feed.
   */

  if (
    news.length < 12
  ) {

    throw new Error(
      "Only " +
      news.length +
      " valid stories were produced. " +
      "Existing feed was protected."
    );
  }

  const reviews =
    buildReviews(
      news
    );

  const previous =
    await readExistingFeed();

  const feed = {

    updatedAt:
      new Date().toISOString(),

    news:
      news.slice(
        0,
        60
      ),

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

  /*
   * Keep older stories when
   * fewer than 60 fresh stories
   * are available.
   */

  if (
    previous &&
    Array.isArray(
      previous.news
    )
  ) {

    const existingIds =
      new Set(
        feed.news.map(
          item =>
            item.id
        )
      );

    for (
      const oldItem
      of previous.news
    ) {

      if (
        feed.news.length >= 60
      ) {
        break;
      }

      if (
        existingIds.has(
          oldItem.id
        )
      ) {
        continue;
      }

      feed.news.push(
        oldItem
      );

      existingIds.add(
        oldItem.id
      );
    }
  }

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
    "Wrote:",
    FEED_FILE
  );

  console.log(
    "Fresh stories:",
    news.length
  );

  console.log(
    "Reviews:",
    reviews.length
  );
}

main().catch(
  error => {

    console.error(
      error
    );

    process.exit(
      1
    );
  }
);
