import fs from "node:fs/promises";

const OPENAI_MODEL = "gpt-5.6-luna";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";

function decodeEntities(text = "") {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#8217;/gi, "'")
    .replace(/&#8216;/gi, "'")
    .replace(/&#8220;/gi, '"')
    .replace(/&#8221;/gi, '"')
    .replace(/&#8211;/gi, "-")
    .replace(/&#8212;/gi, "-")
    .replace(/&#8230;/gi, "...")
    .replace(/&#(\d+);/g, (_, n) => {
      const value = Number(n);
      return Number.isFinite(value) ? String.fromCharCode(value) : "";
    });
}

function stripHtml(html = "") {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function cleanText(value = "") {
  return decodeEntities(String(value))
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`Source page returned HTTP ${response.status}: ${url}`);
  }

  return response.text();
}

function extractMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }

  return "";
}

function extractArticleTitle(html, fallback = "") {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) return cleanText(stripHtml(h1[1]));

  return (
    extractMeta(html, "og:title") ||
    extractMeta(html, "twitter:title") ||
    cleanText(stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")) ||
    cleanText(fallback)
  );
}

function extractArticleBody(html = "") {
  const candidates = [];

  const containers = [
    ...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi),
    ...html.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi),
    ...html.matchAll(/<(?:div|section)\b[^>]*(?:class|id)=["'][^"']*(?:article|story|content|post|entry|single)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/gi)
  ];

  for (const match of containers) {
    const text = stripHtml(match[1] || "");
    if (text.length >= 400) candidates.push(text);
  }

  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(match => stripHtml(match[1] || ""))
    .filter(text =>
      text.length >= 45 &&
      !/^(advertisement|read more|subscribe|follow us|share|home|menu)$/i.test(text)
    );

  if (paragraphs.length) candidates.push(paragraphs.join(" "));

  const best = candidates.sort((a, b) => b.length - a.length)[0] || "";
  return cleanText(best).slice(0, 9000);
}

function extractImage(html = "") {
  return (
    extractMeta(html, "og:image") ||
    extractMeta(html, "twitter:image") ||
    ""
  );
}

function isIndianCinemaStory(title, body) {
  const text = `${title} ${body}`.toLowerCase();

  const blocked = [
    "hollywood", "k-pop", "kpop", "football", "cricket",
    "stock market", "politics", "election", "crime",
    "weather", "technology", "gaming"
  ];

  if (blocked.some(term => text.includes(term))) return false;

  const cinemaTerms = [
    "telugu", "tollywood", "tamil", "kollywood", "malayalam",
    "mollywood", "kannada", "sandalwood", "bollywood",
    "indian cinema", "indian film", "indian movie",
    "actor", "actress", "director", "filmmaker", "movie",
    "film", "cinema", "trailer", "teaser", "ott", "box office",
    "release", "first look", "poster", "song", "shooting"
  ];

  return cinemaTerms.some(term => text.includes(term));
}

function hasEditorialJunk(text = "") {
  const value = text.toLowerCase();
  const junk = [
    "read more", "subscribe", "advertisement", "click here",
    "follow us", "sign up", "login", "home menu",
    "latest news", "related stories", "you may also like",
    "share this", "privacy policy", "terms and conditions"
  ];

  return junk.filter(item => value.includes(item)).length >= 2;
}

function validateStory(story) {
  if (!story || story.keep !== true) return false;

  const title = cleanText(story.title);
  const summary = cleanText(story.summary);

  if (title.length < 30 || title.length > 140) return false;
  if (summary.length < 180 || summary.length > 650) return false;
  if (hasEditorialJunk(title) || hasEditorialJunk(summary)) return false;

  const sentences = summary.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2 || sentences.length > 4) return false;

  return true;
}

async function rewriteStory(item, index) {
  if (!item?.url) {
    throw new Error(`News item ${index + 1} has no source URL.`);
  }

  const html = await fetchPage(item.url);
  const sourceTitle = extractArticleTitle(html, item.title);
  const body = extractArticleBody(html);

  if (body.length < 250) {
    throw new Error(`Insufficient article text for: ${sourceTitle}`);
  }

  if (!isIndianCinemaStory(sourceTitle, body)) {
    return null;
  }

  const prompt = [
    "You are the editorial writer for Cineinsta, an Indian cinema news website.",
    "",
    "Create ORIGINAL Cineinsta copy from the source article below.",
    "",
    "Rules:",
    "1. Keep only Indian cinema stories. Telugu cinema is the priority.",
    "2. Preserve facts, but rewrite all wording in fresh original language.",
    "3. Do not copy the source headline or sentence structure.",
    "4. Do not invent names, dates, quotes, ratings, box-office numbers, release plans or other facts.",
    "5. Write one natural, engaging headline.",
    "6. Write a concise 2-3 sentence summary.",
    "7. Ignore menus, navigation, advertisements, related links, social prompts and publisher boilerplate.",
    "8. If this is not an Indian cinema story, return keep=false.",
    "9. If there are not enough reliable facts to write a clean story, return keep=false.",
    "10. Return JSON only with keys: keep, title, summary, category.",
    "",
    `Source publisher: ${item.source || "Unknown"}`,
    `Source headline: ${sourceTitle}`,
    "",
    "Article text:",
    body
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a careful cinema editor. Return valid JSON only."
        },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI HTTP ${response.status}: ${error.slice(0, 500)}`);
  }

  const data = await response.json();
  let story;

  try {
    story = JSON.parse(data?.choices?.[0]?.message?.content || "{}");
  } catch {
    throw new Error("OpenAI returned invalid JSON.");
  }

  if (!validateStory(story)) return null;

  return {
    ...item,
    title: cleanText(story.title),
    summary: cleanText(story.summary),
    category: cleanText(story.category || item.category || "Telugu Cinema"),
    source: item.source || "Source",
    url: item.url,
    img: item.img || extractImage(html),
    editorial: "Cineinsta"
  };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing. Feed publication is blocked.");
  }

  const feedPath = "data/feed.json";
  const feed = JSON.parse(await fs.readFile(feedPath, "utf8"));
  const input = Array.isArray(feed.news) ? feed.news : [];

  if (!input.length) {
    throw new Error("No news items were found in data/feed.json.");
  }

  console.log(`News stories received from collector: ${input.length}`);

  const output = [];
  let rejected = 0;

  for (let i = 0; i < input.length; i++) {
    const item = input[i];

    try {
      const rewritten = await rewriteStory(item, i);

      if (!rewritten) {
        rejected++;
        console.log(`REJECTED: ${item.title || item.url}`);
        continue;
      }

      output.push(rewritten);
      console.log(`ACCEPTED: ${rewritten.title}`);
    } catch (error) {
      console.error(`FAILED: ${item.title || item.url}`);
      console.error(error.message);
      throw error;
    }
  }

  if (!output.length) {
    throw new Error("No clean Cineinsta stories were produced. Existing feed was not replaced.");
  }

  feed.news = output.slice(0, 30);
  feed.updatedAt = new Date().toISOString();

  await fs.writeFile(feedPath, JSON.stringify(feed, null, 2), "utf8");

  console.log("");
  console.log("======================================");
  console.log("CINEINSTA EDITORIAL CHECK COMPLETE");
  console.log("======================================");
  console.log(`Accepted: ${output.length}`);
  console.log(`Rejected: ${rejected}`);
  console.log(`Published news: ${feed.news.length}`);
}

main().catch(error => {
  console.error("");
  console.error("Cineinsta editorial rewrite failed:");
  console.error(error);
  process.exit(1);
});
