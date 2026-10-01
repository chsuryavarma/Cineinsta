import fs from "node:fs/promises";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";

const DATA_FILE = "data/feed.json";

const NEWS_QUERIES = [
  "Telugu cinema news",
  "Telugu movie news",
  "Tollywood latest news",
  "Telugu actors actresses movie update",
  "Telugu OTT movie news"
];

const RSS_URL = query =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=en-IN&gl=IN&ceid=IN:en`;

function decodeEntities(value = "") {
  return value
    .replace(/<!\[CDATA\[/gi, "")
    .replace(/\]\]>/gi, "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#8217;/gi, "'")
    .replace(/&#8211;/gi, "-")
    .replace(/&#8212;/gi, "-")
    .replace(/&#8230;/gi, "...");
}

function stripHtml(value = "") {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function xmlTag(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i")
  );
  return match ? decodeEntities(stripHtml(match[1])) : "";
}

function xmlAttr(xml, tag, attr) {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedAttr = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(
    new RegExp(
      `<${escapedTag}\\b[^>]*\\b${escapedAttr}=["']([^"']+)["']`,
      "i"
    )
  );
  return match?.[1] ? decodeEntities(match[1]) : "";
}

function extractItems(xml) {
  return xml.match(/<item>[\s\S]*?<\/item>/gi) || [];
}

function cleanTitle(title = "") {
  return stripHtml(title)
    .replace(/\s+\|\s+[^|]+$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSummary(value = "", title = "") {
  let text = stripHtml(value);
  if (title && text.toLowerCase().startsWith(title.toLowerCase())) {
    text = text.slice(title.length).trim();
  }
  if (text.length > 240) text = `${text.slice(0, 237).replace(/\s+\S*$/, "")}...`;
  return text || `Latest Telugu cinema update: ${title}.`;
}

function normalizeTitle(value = "") {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u0C00-\u0C7F]+/g, " ")
    .replace(
      /\b(latest|breaking|exclusive|update|updates|news|report|reports|official)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  const aa = new Set(normalizeTitle(a).split(" ").filter(x => x.length > 2));
  const bb = new Set(normalizeTitle(b).split(" ").filter(x => x.length > 2));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const word of aa) if (bb.has(word)) common++;
  return common / Math.max(aa.size, bb.size);
}

function imageFromDescription(description = "") {
  const patterns = [
    /<img[^>]+src=["']([^"']+)["']/i,
    /<media:content[^>]+url=["']([^"']+)["']/i,
    /<media:thumbnail[^>]+url=["']([^"']+)["']/i
  ];
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

async function fetchText(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/xml, text/xml, text/html;q=0.9,*/*;q=0.8"
      },
      redirect: "follow"
    });
    if (!response.ok) {
      console.log(`FAILED ${response.status}: ${url}`);
      return "";
    }
    return await response.text();
  } catch (error) {
    console.log(`FAILED ${url}: ${error.message}`);
    return "";
  }
}

function isLikelyCinema(title, description) {
  const value = `${title} ${description}`.toLowerCase();
  const terms = [
    "movie", "film", "cinema", "tollywood", "telugu", "actor", "actress",
    "director", "trailer", "teaser", "ott", "release", "nani", "prabhas",
    "allu", "mahesh", "ntr", "ram charan", "vijay", "rashmika", "samantha",
    "chiranjeevi", "pawan kalyan", "deverakonda"
  ];
  return terms.some(term => value.includes(term));
}

async function getOgImage(url) {
  if (!url) return "";
  const html = await fetchText(url);
  if (!html) return "";
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1] && /^https?:\/\//i.test(match[1])) return match[1];
  }
  return "";
}

async function collectNews() {
  const all = [];

  for (const query of NEWS_QUERIES) {
    console.log(`Loading Google News RSS: ${query}`);
    const xml = await fetchText(RSS_URL(query));
    if (!xml) continue;

    for (const itemXml of extractItems(xml).slice(0, 12)) {
      const title = cleanTitle(xmlTag(itemXml, "title"));
      const url = xmlTag(itemXml, "link");
      const descriptionRaw = xmlTag(itemXml, "description");
      const description = stripHtml(descriptionRaw);
      const source = xmlTag(itemXml, "source") || "Google News";
      const publishedAt = xmlTag(itemXml, "pubDate");
      let img = imageFromDescription(descriptionRaw);

      if (!title || !url || !isLikelyCinema(title, description)) continue;

      if (!img) img = await getOgImage(url);
      if (!img) continue;

      all.push({
        id: url,
        title,
        summary: cleanSummary(description, title),
        source,
        url,
        img,
        publishedAt:
          publishedAt && !Number.isNaN(new Date(publishedAt).getTime())
            ? new Date(publishedAt).toISOString()
            : null,
        language: "Telugu",
        category: "Telugu Cinema"
      });
    }
  }

  const output = [];
  const seenUrls = new Set();

  for (const item of all.sort(
    (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)
  )) {
    const urlKey = item.url.split("?")[0].replace(/\/$/, "").toLowerCase();
    if (seenUrls.has(urlKey)) continue;
    if (output.some(existing => similarity(existing.title, item.title) >= 0.68)) continue;
    seenUrls.add(urlKey);
    output.push(item);
    if (output.length >= 40) break;
  }

  return output;
}

async function loadExisting() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

async function main() {
  console.log("======================================");
  console.log("CINEINSTA FEED UPDATE");
  console.log("======================================");

  const existing = await loadExisting();
  const news = await collectNews();

  const finalNews = news.length ? news : Array.isArray(existing.news) ? existing.news : [];
  const trailers = Array.isArray(existing.trailers) ? existing.trailers : [];
  const interviews = Array.isArray(existing.interviews) ? existing.interviews : [];
  const reviews = Array.isArray(existing.reviews) ? existing.reviews : [];

  const feed = {
    updatedAt: new Date().toISOString(),
    language: "Telugu",
    news: finalNews,
    trailers,
    interviews,
    reviews
  };

  await fs.mkdir("data", { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(feed, null, 2), "utf8");

  console.log(`News: ${finalNews.length}`);
  console.log(`Trailers preserved: ${trailers.length}`);
  console.log(`Interviews preserved: ${interviews.length}`);
  console.log(`Reviews preserved: ${reviews.length}`);
  console.log("feed.json updated successfully.");
}

main().catch(error => {
  console.error("Cineinsta feed updater failed:");
  console.error(error);
  process.exit(1);
});
