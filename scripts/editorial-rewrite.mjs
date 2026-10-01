import fs from "node:fs/promises";

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const BATCH_SIZE = 4;
const MIN_STORIES = 20;
const MAX_STORIES = 30;
const MIN_SUMMARY = 180;
const MAX_SUMMARY = 650;
const MIN_BODY_WORDS = 100;
const MAX_BODY_WORDS = 500;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";

function cleanText(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#8217;/gi, "'")
    .replace(/&#8211;/gi, "-")
    .replace(/&#8212;/gi, "-")
    .replace(/&#8230;/gi, "...")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html = "") {
  return cleanText(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
  );
}

function extractArticleText(html = "") {
  const raw = String(html || "").trim();

  // Jina Reader returns clean text instead of HTML. Keep that text directly.
  if (raw && !/<[a-z][\s\S]*>/i.test(raw)) {
    return cleanText(raw).slice(0, 10000);
  }

  const candidates = [];

  for (const match of html.matchAll(
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi
  )) {
    candidates.push(stripHtml(match[1] || ""));
  }

  for (const match of html.matchAll(
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi
  )) {
    candidates.push(stripHtml(match[1] || ""));
  }

  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(match => stripHtml(match[1] || ""))
    .filter(
      text =>
        text.length >= 45 &&
        !/^(advertisement|read more|subscribe|follow us|share|home|menu)$/i.test(
          text
        )
    );

  if (paragraphs.length) {
    candidates.push(paragraphs.join(" "));
  }

  return candidates
    .sort((a, b) => b.length - a.length)[0]
    ?.slice(0, 10000) || "";
}

async function fetchSource(url) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  };

  // Try the publisher first. Some publishers allow GitHub Actions to fetch
  // the page directly, while others return a shell page or block the runner.
  try {
    const response = await fetch(url, { headers });
    if (response.ok) {
      const html = await response.text();
      if (extractArticleText(html).length >= 250) {
        return html;
      }
    }
  } catch (error) {
    console.log(`Direct source fetch failed: ${error.message}`);
  }

  // Fallback: Jina Reader converts public article pages into clean readable
  // text and avoids the JavaScript/anti-bot shell returned by some sites.
  const jinaUrl = `https://r.jina.ai/${url}`;
  const jinaResponse = await fetch(jinaUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/plain,text/markdown,*/*;q=0.8"
    }
  });

  if (!jinaResponse.ok) {
    throw new Error(
      `Source unavailable directly and Jina returned HTTP ${jinaResponse.status}`
    );
  }

  const text = await jinaResponse.text();
  if (extractArticleText(text).length < 250) {
    throw new Error("insufficient source article text after direct and Jina fetch");
  }

  return text;
}

function parseJson(text) {
  const value = String(text || "")
    .replace(/^\s*```json\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(value);
  } catch {}

  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");

  if (first >= 0 && last > first) {
    try {
      return JSON.parse(value.slice(first, last + 1));
    } catch {}
  }

  return null;
}

function normalizeSummary(summary, body) {
  let value = cleanText(summary);

  if (value.length >= MIN_SUMMARY && value.length <= MAX_SUMMARY) {
    return value;
  }

  if (value.length < MIN_SUMMARY) {
    const bodyText = Array.isArray(body)
      ? body.map(cleanText).filter(Boolean).join(" ")
      : "";

    const sentences = bodyText.match(/[^.!?]+[.!?]+/g) || [];
    let rebuilt = "";

    for (const sentence of sentences) {
      const next = rebuilt
        ? `${rebuilt} ${sentence.trim()}`
        : sentence.trim();

      if (next.length > MAX_SUMMARY) break;

      rebuilt = next;

      if (rebuilt.length >= MIN_SUMMARY) break;
    }

    if (rebuilt.length >= MIN_SUMMARY) {
      value = rebuilt;
    }
  }

  if (value.length > MAX_SUMMARY) {
    const cut = value.slice(0, MAX_SUMMARY);
    const lastSpace = cut.lastIndexOf(" ");
    value = (lastSpace > MIN_SUMMARY ? cut.slice(0, lastSpace) : cut).trim();
  }

  return value;
}

function validateArticle(article) {
  if (!article || article.keep !== true) {
    return { ok: false, reason: "Gemini marked story as not suitable" };
  }

  const title = cleanText(article.title);
  const body = Array.isArray(article.body)
    ? article.body.map(cleanText).filter(Boolean)
    : [];
  const summary = normalizeSummary(article.summary, body);

  const words = body.join(" ").split(/\s+/).filter(Boolean).length;

  if (title.length < 25 || title.length > 160) {
    return { ok: false, reason: "headline length invalid" };
  }

  if (body.length < 3 || body.length > 7) {
    return { ok: false, reason: `body has ${body.length} paragraphs` };
  }

  if (words < MIN_BODY_WORDS || words > MAX_BODY_WORDS) {
    return { ok: false, reason: `body has ${words} words` };
  }

  if (summary.length < MIN_SUMMARY || summary.length > MAX_SUMMARY) {
    return {
      ok: false,
      reason: `summary has ${summary.length} characters`
    };
  }

  return {
    ok: true,
    title,
    summary,
    body,
  };
}

async function rewriteBatch(batch) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const payload = batch.map((item, index) => ({
    index,
    headline: item.item.title || "",
    existingSummary: item.item.summary || "",
    sourceText: item.sourceText
  }));

  const prompt = `You are the senior editorial writer for Cineinsta, an Indian cinema news website.

Create ORIGINAL Cineinsta editorial articles for ALL supplied stories.

IMPORTANT:
- Use the supplied source text only for facts.
- Do not copy sentences, paragraph order, or distinctive wording.
- Do not invent facts, quotes, dates, numbers, motives, ratings, box-office figures or release details.
- Do not mention the source publisher or source website.
- Do not tell readers to visit or read the original article.
- If a story is not Indian cinema or does not contain enough reliable facts, set keep=false.

For every kept story return:
1. A fresh Cineinsta headline.
2. A 2-3 sentence homepage summary, 180-650 characters.
3. A complete original article of 3-7 concise paragraphs and 100-500 words. Aim for 4 or more paragraphs when the facts support it; do not pad or invent details.

The article should answer the basic reader questions: what happened, who is involved, what is confirmed, when relevant, and why the development matters in cinema terms. Keep the writing factual and readable.

Return JSON only in this exact shape:
{
  "articles": [
    {
      "index": 0,
      "keep": true,
      "title": "...",
      "summary": "...",
      "body": ["paragraph 1", "paragraph 2", "paragraph 3", "paragraph 4"],
      "keyFacts": ["fact 1", "fact 2", "fact 3"],
      "cineinstaContext": "..."
    }
  ]
}

STORIES:
${JSON.stringify(payload)}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
      process.env.GEMINI_API_KEY
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text:
                "You are Cineinsta's original cinema editor. Return JSON only."
            }
          ]
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Gemini HTTP ${response.status}: ${detail.slice(0, 700)}`
    );
  }

  const data = await response.json();
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map(part => part?.text || "")
    .join("");

  const parsed = parseJson(text);

  if (!parsed || !Array.isArray(parsed.articles)) {
    throw new Error("Gemini returned invalid batch JSON");
  }

  return parsed.articles;
}

async function main() {
  const feedPath = "data/feed.json";
  const feed = JSON.parse(await fs.readFile(feedPath, "utf8"));

  if (!Array.isArray(feed.news) || !feed.news.length) {
    throw new Error("data/feed.json has no news array");
  }

  const news = feed.news.slice(0, MAX_STORIES);
  const approved = [];
  let skipped = 0;
  let batchNumber = 0;

  console.log("======================================");
  console.log("CINEINSTA RICH NEWS EDITORIAL");
  console.log("======================================");
  console.log(`Stories received: ${news.length}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(
    `Maximum Gemini requests: ${Math.ceil(news.length / BATCH_SIZE)}`
  );
  console.log("No per-story retry loop is used.");

  for (let start = 0; start < news.length; start += BATCH_SIZE) {
    const sourceBatch = news.slice(start, start + BATCH_SIZE);
    batchNumber += 1;
    const prepared = [];

    for (let local = 0; local < sourceBatch.length; local += 1) {
      const item = sourceBatch[local];
      const absoluteIndex = start + local;

      if (!item?.url) {
        console.log(`SKIP ${absoluteIndex + 1}: no source URL`);
        skipped += 1;
        continue;
      }

      try {
        const html = await fetchSource(item.url);
        const sourceText = extractArticleText(html);

        if (sourceText.length < 250) {
          console.log(
            `SKIP ${absoluteIndex + 1}: insufficient source article text`
          );
          skipped += 1;
          continue;
        }

        prepared.push({
          absoluteIndex,
          item,
          sourceText
        });
      } catch (error) {
        console.log(
          `SKIP ${absoluteIndex + 1}: source fetch failed - ${error.message}`
        );
        skipped += 1;
      }
    }

    if (!prepared.length) continue;

    console.log(
      `BATCH ${batchNumber}: ${prepared.length} stories -> 1 Gemini request`
    );

    let results;

    try {
      results = await rewriteBatch(prepared);
    } catch (error) {
      console.log(`BATCH ${batchNumber} FAILED: ${error.message}`);
      console.log("Those stories are skipped safely.");
      skipped += prepared.length;
      continue;
    }

    const byIndex = new Map(
      results
        .filter(result => Number.isInteger(result?.index))
        .map(result => [result.index, result])
    );

    for (let local = 0; local < prepared.length; local += 1) {
      const preparedItem = prepared[local];
      const result = byIndex.get(local);
      const validation = validateArticle(result);

      if (!validation.ok) {
        console.log(
          `SKIP ${preparedItem.absoluteIndex + 1}: ${validation.reason}`
        );
        skipped += 1;
        continue;
      }

      approved.push({
        ...preparedItem.item,
        title: validation.title,
        summary: validation.summary,
        body: validation.body,
        editorial: "Cineinsta"
      });

      const words = validation.body
        .join(" ")
        .split(/\s+/)
        .filter(Boolean).length;

      console.log(
        `APPROVED ${preparedItem.absoluteIndex + 1}: ${validation.title} (${words} words)`
      );
    }
  }

  if (approved.length < MIN_STORIES) {
    throw new Error(
      `Only ${approved.length} complete editorial stories passed validation; at least ${MIN_STORIES} are required. Existing feed was not changed.`
    );
  }

  feed.news = approved.slice(0, MAX_STORIES);
  feed.updatedAt = new Date().toISOString();

  await fs.writeFile(
    feedPath,
    JSON.stringify(feed, null, 2) + "\n",
    "utf8"
  );

  console.log("");
  console.log("======================================");
  console.log("CINEINSTA RICH NEWS EDITORIAL COMPLETE");
  console.log("======================================");
  console.log(`Published editorial stories: ${feed.news.length}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Gemini batch requests used: ${batchNumber}`);
  console.log("Every published story contains:");
  console.log("- rewritten headline");
  console.log("- 180-650 character summary");
  console.log("- 3-7 paragraph original article");
  }

main().catch(error => {
  console.error("");
  console.error("Cineinsta rich editorial rewrite failed:");
  console.error(error);
  process.exit(1);
});
