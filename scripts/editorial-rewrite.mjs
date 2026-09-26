import fs from "node:fs/promises";

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const BATCH_SIZE = 4;

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
  return extractMeta(html, "og:image") || extractMeta(html, "twitter:image") || "";
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

function extractJsonObject(text = "") {
  const cleaned = String(text)
    .replace(/^\s*```json\s*/i, "")
    .replace(/^\s*```\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");

  if (first >= 0 && last > first) {
    try {
      return JSON.parse(cleaned.slice(first, last + 1));
    } catch {}
  }

  return null;
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is missing. Feed publication is blocked.");
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: "You are a careful cinema editor. Return JSON only. Never use Markdown fences."
              }
            ]
          },
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (response.ok) {
      const data = await response.json();
      const text = (data?.candidates?.[0]?.content?.parts || [])
        .map(part => part?.text || "")
        .join("");

      if (!text) {
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, attempt * 2000));
          continue;
        }
        throw new Error("Gemini returned an empty response.");
      }

      const parsed = extractJsonObject(text);
      if (parsed) return parsed;

      if (attempt < 3) {
        console.log(`Gemini returned non-JSON output. Retrying (attempt ${attempt + 1}/3)...`);
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        continue;
      }

      throw new Error("Gemini returned invalid JSON after retries.");
    }

    const errorText = await response.text();

    if (response.status === 429 && attempt < 3) {
      console.log(`Gemini rate limit reached. Retrying in ${attempt * 5} seconds...`);
      await new Promise(resolve => setTimeout(resolve, attempt * 5000));
      continue;
    }

    throw new Error(`Gemini HTTP ${response.status}: ${errorText.slice(0, 800)}`);
  }

  throw new Error("Gemini request failed after retries.");
}

function buildBatchPrompt(batch) {
  const stories = batch.map((story, index) => [
    `STORY ${index + 1}`,
    `Source publisher: ${story.item.source || "Unknown"}`,
    `Source headline: ${story.sourceTitle}`,
    "Article text:",
    story.body
  ].join("\n")).join("\n\n==============================\n\n");

  return [
    "You are the editorial writer for Cineinsta, an Indian cinema news website.",
    "",
    `Rewrite ALL ${batch.length} stories below in one response.`,
    "",
    "Rules:",
    "1. Keep only Indian cinema stories. Telugu cinema is the priority.",
    "2. Preserve facts, but rewrite all wording in fresh original language.",
    "3. Do not copy the source headline or sentence structure.",
    "4. Do not invent names, dates, quotes, ratings, box-office numbers, release plans or other facts.",
    "5. Write one natural, engaging headline for each story.",
    "6. Write a concise 2-3 sentence summary for each story.",
    "7. Ignore menus, navigation, advertisements, related links, social prompts and publisher boilerplate.",
    "8. If a story is not an Indian cinema story, return keep=false.",
    "9. If there are not enough reliable facts, return keep=false.",
    "10. Return JSON only. No Markdown.",
    "11. Return exactly one result for every input story, in the same order.",
    "12. Each result must contain keep, title, summary, category.",
    "",
    'Required JSON shape: {"stories":[{"keep":true,"title":"...","summary":"...","category":"Telugu Cinema"}]}',
    "",
    stories
  ].join("\n");
}

async function rewriteBatch(batch) {
  try {
    const response = await callGemini(buildBatchPrompt(batch));

    if (!response || !Array.isArray(response.stories)) {
      throw new Error("Gemini returned an invalid batch response.");
    }

    if (response.stories.length !== batch.length) {
      throw new Error(
        `Gemini returned ${response.stories.length} stories for a batch of ${batch.length}.`
      );
    }

    return response.stories;
  } catch (error) {
    if (batch.length === 1) throw error;

    console.log(`Batch rewrite failed. Retrying ${batch.length} stories individually...`);

    const individual = [];

    for (const story of batch) {
      try {
        const single = await callGemini(buildBatchPrompt([story]));

        if (
          single &&
          Array.isArray(single.stories) &&
          single.stories.length === 1
        ) {
          individual.push(single.stories[0]);
        } else {
          individual.push({ keep: false });
        }
      } catch (singleError) {
        console.log(`Individual rewrite failed: ${story.sourceTitle}`);
        console.log(singleError.message);
        individual.push({ keep: false });
      }
    }

    return individual;
  }
}

async function prepareStory(item, index) {
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

  return {
    item,
    sourceTitle,
    body,
    image: item.img || extractImage(html)
  };
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing. Feed publication is blocked.");
  }

  const feedPath = "data/feed.json";
  const feed = JSON.parse(await fs.readFile(feedPath, "utf8"));
  const input = Array.isArray(feed.news) ? feed.news : [];

  if (!input.length) {
    throw new Error("No news items were found in data/feed.json.");
  }

  console.log(`News stories received from collector: ${input.length}`);

  const prepared = [];

  for (let i = 0; i < input.length; i++) {
    try {
      const story = await prepareStory(input[i], i);

      if (!story) {
        console.log(`PRE-FILTERED: ${input[i].title || input[i].url}`);
        continue;
      }

      prepared.push(story);
    } catch (error) {
      console.error(`FAILED TO PREPARE: ${input[i].title || input[i].url}`);
      console.error(error.message);
      throw error;
    }
  }

  if (!prepared.length) {
    throw new Error("No usable Indian cinema stories were prepared.");
  }

  console.log(`Stories ready for Gemini: ${prepared.length}`);
  console.log(`Gemini batch size: ${BATCH_SIZE}`);
  console.log(`Expected Gemini requests: ${Math.ceil(prepared.length / BATCH_SIZE)}`);

  const output = [];
  let rejected = 0;

  for (let start = 0; start < prepared.length; start += BATCH_SIZE) {
    const batch = prepared.slice(start, start + BATCH_SIZE);
    const batchNumber = Math.floor(start / BATCH_SIZE) + 1;

    console.log("");
    console.log(`Processing Gemini batch ${batchNumber}: ${batch.length} stories`);

    const results = await rewriteBatch(batch);

    for (let i = 0; i < batch.length; i++) {
      const source = batch[i];
      const story = results[i];

      if (!validateStory(story)) {
        rejected++;
        console.log(`REJECTED: ${source.sourceTitle}`);
        continue;
      }

      const rewritten = {
        ...source.item,
        title: cleanText(story.title),
        summary: cleanText(story.summary),
        category: cleanText(
          story.category || source.item.category || "Telugu Cinema"
        ),
        source: source.item.source || "Source",
        url: source.item.url,
        img: source.item.img || source.image,
        editorial: "Cineinsta"
      };

      output.push(rewritten);
      console.log(`ACCEPTED: ${rewritten.title}`);
    }
  }

  if (!output.length) {
    throw new Error(
      "No clean Cineinsta stories were produced. Existing feed was not replaced."
    );
  }

  // Keep the homepage at the requested 24 news stories.
  feed.news = output.slice(0, 24);
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
