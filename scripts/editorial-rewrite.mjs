import fs from "node:fs/promises";

const MODEL = "gemini-3.5-flash-lite";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";
const BATCH_SIZE = 4;

function decode(text = "") {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#8217;/gi, "'")
    .replace(/&#8216;/gi, "'")
    .replace(/&#8220;/gi, '"')
    .replace(/&#8221;/gi, '"')
    .replace(/&#8211;/gi, "-")
    .replace(/&#8212;/gi, "-")
    .replace(/&#8230;/gi, "...")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html = "") {
  return decode(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function extractBody(html = "") {
  const candidates = [];

  for (const m of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    candidates.push(stripHtml(m[1] || ""));
  }

  for (const m of html.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)) {
    candidates.push(stripHtml(m[1] || ""));
  }

  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => stripHtml(m[1] || ""))
    .filter(x => x.length >= 45 && !/^(advertisement|read more|subscribe|follow us|share|home|menu)$/i.test(x));

  if (paragraphs.length) candidates.push(paragraphs.join(" "));

  return candidates.sort((a, b) => b.length - a.length)[0]?.slice(0, 8500) || "";
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function jsonFrom(text) {
  const clean = String(text)
    .replace(/^\s*```json\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  try {
    return JSON.parse(clean);
  } catch {}

  const first = clean.indexOf("{");
  const last = clean.lastIndexOf("}");

  if (first >= 0 && last > first) {
    try {
      return JSON.parse(clean.slice(first, last + 1));
    } catch {}
  }

  return null;
}

async function geminiBatch(items) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const payload = items.map((item, index) => ({
    index,
    headline: item.title || "",
    summary: item.summary || "",
    sourceText: item.sourceText || ""
  }));

  const prompt = `You are Cineinsta's original cinema news editor.

Create original Cineinsta articles for ALL supplied stories in one response.

STRICT RULES:
1. Preserve only facts supported by each supplied source text.
2. Do not copy sentences, paragraph order, or distinctive wording from the source.
3. Do not invent facts, quotes, numbers, dates, motives, opinions presented as facts, or details.
4. Do not mention the source publisher, source website, source article, or tell readers to read the original.
5. Each article must contain 5-10 readable paragraphs and approximately 250-900 words.
6. The summary must be a separate concise 2-3 sentence homepage summary.
7. Rewrite the headline in Cineinsta style.
8. If the supplied facts are insufficient for a complete original article, set keep=false for that story rather than inventing material.
9. Return JSON only.

Return exactly this shape:
{
  "articles": [
    {
      "index": 0,
      "keep": true,
      "title": "...",
      "summary": "...",
      "body": ["paragraph 1", "paragraph 2", "paragraph 3", "paragraph 4", "paragraph 5"]
    }
  ]
}

STORIES:
${JSON.stringify(payload)}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: "You are Cineinsta's original cinema news editor. Return JSON only." }]
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
    throw new Error(`Gemini HTTP ${response.status}: ${detail.slice(0, 700)}`);
  }

  const data = await response.json();
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map(part => part?.text || "")
    .join("");

  const parsed = jsonFrom(text);

  if (!parsed || !Array.isArray(parsed.articles)) {
    throw new Error("Gemini returned invalid batch JSON");
  }

  return parsed.articles;
}

function validateArticle(article) {
  if (!article || article.keep === false) {
    return { ok: false, reason: "keep=false" };
  }

  const body = Array.isArray(article.body)
    ? article.body.map(x => String(x).trim()).filter(Boolean)
    : [];

  const wordCount = body.join(" ").split(/\s+/).filter(Boolean).length;

  if (body.length < 5 || body.length > 10) {
    return { ok: false, reason: `body has ${body.length} paragraphs` };
  }

  if (wordCount < 250 || wordCount > 900) {
    return { ok: false, reason: `body has ${wordCount} words` };
  }

  if (!article.title || String(article.title).trim().length < 25) {
    return { ok: false, reason: "headline is incomplete" };
  }

  if (!article.summary || String(article.summary).trim().length < 180) {
    return { ok: false, reason: "summary is incomplete" };
  }

  return {
    ok: true,
    title: String(article.title).trim(),
    summary: String(article.summary).trim(),
    body
  };
}

async function main() {
  const path = "data/feed.json";
  const feed = JSON.parse(await fs.readFile(path, "utf8"));

  if (!Array.isArray(feed.news)) {
    throw new Error("data/feed.json has no news array");
  }

  const news = feed.news;
  let updated = 0;
  let skipped = 0;
  let batchNumber = 0;

  console.log("======================================");
  console.log("CINEINSTA FULL ARTICLE GENERATION");
  console.log("======================================");
  console.log(`Stories found: ${news.length}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Maximum Gemini requests this run: ${Math.ceil(news.length / BATCH_SIZE)}`);
  console.log("No per-story retries are used. This prevents a quota storm.");

  for (let start = 0; start < news.length; start += BATCH_SIZE) {
    const sourceBatch = news.slice(start, start + BATCH_SIZE);
    batchNumber += 1;

    const prepared = [];

    for (let localIndex = 0; localIndex < sourceBatch.length; localIndex += 1) {
      const item = sourceBatch[localIndex];
      const absoluteIndex = start + localIndex;

      if (!item?.url) {
        console.log(`SKIP ${absoluteIndex + 1}: no URL`);
        skipped += 1;
        continue;
      }

      try {
        const html = await fetchText(item.url);
        const sourceText = extractBody(html);

        if (sourceText.length < 250) {
          console.log(`SKIP ${absoluteIndex + 1}: insufficient source text`);
          skipped += 1;
          continue;
        }

        prepared.push({
          absoluteIndex,
          title: item.title,
          summary: item.summary,
          sourceText
        });
      } catch (error) {
        console.log(`SKIP ${absoluteIndex + 1}: source fetch failed - ${error.message}`);
        skipped += 1;
      }
    }

    if (!prepared.length) continue;

    console.log(`BATCH ${batchNumber}: ${prepared.length} stories -> 1 Gemini request`);

    let results;

    try {
      results = await geminiBatch(prepared);
    } catch (error) {
      console.log(`BATCH ${batchNumber} FAILED: ${error.message}`);
      console.log("The existing story data is preserved for this batch.");
      skipped += prepared.length;
      continue;
    }

    const byIndex = new Map(
      results
        .filter(item => Number.isInteger(item?.index))
        .map(item => [item.index, item])
    );

    for (let localIndex = 0; localIndex < prepared.length; localIndex += 1) {
      const preparedItem = prepared[localIndex];
      const result = byIndex.get(localIndex);
      const validation = validateArticle(result);

      if (!validation.ok) {
        console.log(`SKIP ${preparedItem.absoluteIndex + 1}: ${validation.reason}`);
        skipped += 1;
        continue;
      }

      const item = news[preparedItem.absoluteIndex];
      item.title = validation.title;
      item.summary = validation.summary;
      item.body = validation.body;
      item.editorial = "Cineinsta";
      item.keyFacts = [];
      item.cineinstaContext = "";

      updated += 1;

      const words = validation.body.join(" ").split(/\s+/).filter(Boolean).length;
      console.log(`UPDATED ${preparedItem.absoluteIndex + 1}: ${validation.title} (${words} words, ${validation.body.length} paragraphs)`);
    }
  }

  if (updated === 0) {
    throw new Error("No complete articles were generated. Existing feed was not changed.");
  }

  feed.updatedAt = new Date().toISOString();
  await fs.writeFile(path, JSON.stringify(feed, null, 2) + "\n", "utf8");

  console.log("");
  console.log("======================================");
  console.log("CINEINSTA FULL ARTICLE GENERATION COMPLETE");
  console.log("======================================");
  console.log(`Articles updated: ${updated}`);
  console.log(`Stories skipped: ${skipped}`);
  console.log(`Gemini batch requests used: ${batchNumber}`);
  console.log("All updated articles passed the 5-10 paragraph / 250-900 word checks.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
