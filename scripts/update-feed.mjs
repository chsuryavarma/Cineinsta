import fs from "node:fs/promises";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";

const DATA_FILE = "data/feed.json";
const FALLBACK_IMAGE = "/assets/cineinsta-news-fallback.svg";

const NEWS_QUERIES = [
  "site:123telugu.com Telugu movie news",
  "site:gulte.com Telugu cinema news",
  "site:greatandhra.com Telugu cinema news",
  "site:telugu360.com Telugu cinema news",
  "site:telugucinema.com Telugu cinema news",
  "site:idlebrain.com Telugu cinema news"
];

const ALLOWED_HOSTS = new Set([
  "123telugu.com",
  "www.123telugu.com",
  "gulte.com",
  "www.gulte.com",
  "greatandhra.com",
  "www.greatandhra.com",
  "telugu360.com",
  "www.telugu360.com",
  "telugucinema.com",
  "www.telugucinema.com",
  "idlebrain.com",
  "www.idlebrain.com"
]);

const BLOCKED_TERMS = [
  "tamil cinema", "malayalam cinema", "kannada cinema", "hindi cinema",
  "bollywood", "kollywood", "mollywood", "sandalwood",
  "rajini", "rajinikanth", "vijay thalapathy", "ajith", "mammootty",
  "mohanlal", "dhanush", "suriya", "thalapathy", "tamil", "malayalam"
];

const TELUGU_TERMS = [
  "telugu", "tollywood", "hyderabad", "andhra", "telangana",
  "allu arjun", "mahesh babu", "prabhas", "ntr", "jr ntr",
  "ram charan", "chiranjeevi", "pawan kalyan", "nani", "vijay deverakonda",
  "rashmika", "samantha", "venkatesh", "balakrishna", "nbk",
  "naga chaitanya", "akhil akkineni", "varun tej", "sai dharam tej",
  "nithiin", "sharwanand", "adivi sesh", "teja sajja", "anushka shetty",
  "sreeleela", "pooja hegde", "keerthy suresh", "trivikram",
  "ss rajamouli", "sukumar", "koratala", "sekhar kammula"
];

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
    if (match?.[1]) return decodeEntities(match[1]);
  }
  return "";
}

function isPlaceholderImage(url = "") {
  const value = String(url).toLowerCase();
  if (!/^https?:\/\//i.test(value)) return false;
  return (
    value.includes("googleusercontent.com") ||
    value.includes("gstatic.com") ||
    value.includes("google.com") ||
    value.includes("news.google.com") ||
    value.includes("logo") ||
    value.includes("placeholder") ||
    value.includes("default-image") ||
    value.includes("default_image") ||
    value.includes("no-image") ||
    value.includes("no_image")
  );
}

function usableImage(url = "") {
  return /^https?:\/\//i.test(String(url).trim()) && !isPlaceholderImage(url);
}

async function fetchPage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      redirect: "follow"
    });
    if (!response.ok) return { text: "", finalUrl: url };
    return { text: await response.text(), finalUrl: response.url || url };
  } catch (error) {
    console.log(`FAILED ${url}: ${error.message}`);
    return { text: "", finalUrl: url };
  }
}

async function fetchText(url) {
  const page = await fetchPage(url);
  return page.text;
}

function ogImageFromHtml(html = "") {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1] && usableImage(match[1])) return match[1];
  }
  return "";
}

async function resolveArticle(url) {
  const page = await fetchPage(url);
  return {
    html: page.text,
    finalUrl: page.finalUrl || url
  };
}

function hostOf(url = "") {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isAllowedPublisher(url, source) {
  const host = hostOf(url);
  if (ALLOWED_HOSTS.has(host)) return true;
  const sourceText = String(source || "").toLowerCase();
  return [...ALLOWED_HOSTS].some(hostName => sourceText.includes(hostName.replace(/^www\./, "")));
}

function isTeluguCinema(title, description, source, finalUrl) {
  const value = `${title} ${description} ${source} ${finalUrl}`.toLowerCase();

  if (BLOCKED_TERMS.some(term => value.includes(term))) return false;

  const hasTeluguSignal = TELUGU_TERMS.some(term => value.includes(term));
  const cinemaSignal = [
    "movie", "film", "cinema", "actor", "actress", "director",
    "trailer", "teaser", "ott", "release", "shoot", "shooting",
    "tollywood", "telugu"
  ].some(term => value.includes(term));

  return hasTeluguSignal && cinemaSignal;
}

async function collectNews() {
  const all = [];

  for (const query of NEWS_QUERIES) {
    console.log(`Loading Google News RSS: ${query}`);

    const rss = await fetchText(
      `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`
    );

    if (!rss) continue;

    for (const itemXml of extractItems(rss).slice(0, 15)) {
      const title = cleanTitle(xmlTag(itemXml, "title"));
      const url = xmlTag(itemXml, "link");
      const descriptionRaw = xmlTag(itemXml, "description");
      const description = stripHtml(descriptionRaw);
      const source = xmlTag(itemXml, "source") || "Cineinsta";
      const publishedAt = xmlTag(itemXml, "pubDate");

      if (!title || !url) continue;

      const rssImage = imageFromDescription(descriptionRaw);
      const resolved = await resolveArticle(url);
      const finalUrl = resolved.finalUrl || url;
      const finalHost = hostOf(finalUrl);

      if (!isAllowedPublisher(finalUrl, source)) continue;
      if (!isTeluguCinema(title, description, source, finalUrl)) continue;

      let img = usableImage(rssImage) ? rssImage : "";
      if (!img) img = ogImageFromHtml(resolved.html);
      if (!img && resolved.html) {
        img = ogImageFromHtml(resolved.html);
      }
      if (!img) img = FALLBACK_IMAGE;

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

      console.log(`ACCEPTED: ${title} [${finalHost}]${img === FALLBACK_IMAGE ? " [fallback image]" : ""}`);
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
  console.log("CINEINSTA TELUGU FEED UPDATE");
  console.log("======================================");

  const existing = await loadExisting();
  const news = await collectNews();

  const finalNews =
    news.length >= 20
      ? news
      : Array.isArray(existing.news) && existing.news.length >= 20
        ? existing.news
        : news;

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

  console.log(`News collected: ${news.length}`);
  console.log(`News published: ${finalNews.length}`);
  console.log(`Trailers preserved: ${trailers.length}`);
  console.log(`Interviews preserved: ${interviews.length}`);
  console.log(`Reviews preserved: ${reviews.length}`);
  console.log("feed.json updated successfully.");
}

main().catch(error => {
  console.error("Cineinsta Telugu feed updater failed:");
  console.error(error);
  process.exit(1);
});
