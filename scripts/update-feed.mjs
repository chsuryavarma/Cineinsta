import fs from "node:fs/promises";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";

const DATA_FILE = "data/feed.json";
const GENERIC_DIR = "assets/news-generic";

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

const GENERIC_IMAGES = {
  theatre: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#1e293b"/></linearGradient></defs>
<rect width="1200" height="675" fill="url(#g)"/>
<rect x="350" y="100" width="500" height="230" rx="16" fill="#080d18" stroke="#64748b" stroke-width="8"/>
<polygon points="600,135 790,295 410,295" fill="#2563eb" opacity=".75"/>
<g fill="#0f172a" stroke="#475569" stroke-width="5">
<circle cx="240" cy="455" r="45"/><rect x="200" y="500" width="80" height="75" rx="25"/>
<circle cx="360" cy="455" r="45"/><rect x="320" y="500" width="80" height="75" rx="25"/>
<circle cx="480" cy="455" r="45"/><rect x="440" y="500" width="80" height="75" rx="25"/>
<circle cx="600" cy="455" r="45"/><rect x="560" y="500" width="80" height="75" rx="25"/>
<circle cx="720" cy="455" r="45"/><rect x="680" y="500" width="80" height="75" rx="25"/>
<circle cx="840" cy="455" r="45"/><rect x="800" y="500" width="80" height="75" rx="25"/>
<circle cx="960" cy="455" r="45"/><rect x="920" y="500" width="80" height="75" rx="25"/>
</g>
<text x="600" y="635" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="700" fill="#f8fafc">CINEINSTA • CINEMA AUDIENCE</text>
</svg>`,

  social: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#312e81"/></linearGradient></defs>
<rect width="1200" height="675" fill="url(#g)"/>
<rect x="330" y="90" width="540" height="455" rx="45" fill="#080d18" stroke="#64748b" stroke-width="8"/>
<rect x="390" y="150" width="420" height="55" rx="20" fill="#334155"/>
<circle cx="430" cy="178" r="14" fill="#e31b23"/>
<rect x="390" y="245" width="275" height="125" rx="18" fill="#2563eb" opacity=".8"/>
<rect x="690" y="275" width="120" height="95" rx="18" fill="#e31b23"/>
<rect x="390" y="420" width="420" height="28" rx="14" fill="#64748b"/>
<text x="600" y="635" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="700" fill="#f8fafc">CINEINSTA • CINEMA &amp; SOCIAL MEDIA</text>
</svg>`,

  tickets: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#172554"/></linearGradient></defs>
<rect width="1200" height="675" fill="url(#g)"/>
<rect x="260" y="190" width="680" height="280" rx="28" fill="#f8fafc"/>
<path d="M390 190v280M810 190v280" stroke="#94a3b8" stroke-width="5" stroke-dasharray="14 14"/>
<text x="330" y="290" font-family="Arial,Helvetica,sans-serif" font-size="48" font-weight="700" fill="#111827">CINEMA</text>
<text x="330" y="385" font-family="Arial,Helvetica,sans-serif" font-size="72" font-weight="800" fill="#e31b23">₹ 299</text>
<circle cx="850" cy="330" r="58" fill="#2563eb"/>
<text x="600" y="635" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="700" fill="#f8fafc">CINEINSTA • TICKETS &amp; BOX OFFICE</text>
</svg>`,

  ott: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#3f1d56"/></linearGradient></defs>
<rect width="1200" height="675" fill="url(#g)"/>
<rect x="210" y="125" width="780" height="400" rx="30" fill="#080d18" stroke="#64748b" stroke-width="8"/>
<rect x="275" y="185" width="650" height="270" rx="18" fill="#1e293b"/>
<polygon points="565,245 565,395 715,320" fill="#e31b23"/>
<rect x="360" y="490" width="480" height="18" rx="9" fill="#64748b"/>
<text x="600" y="635" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="700" fill="#f8fafc">CINEINSTA • STREAMING &amp; OTT</text>
</svg>`,

  production: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs>
<rect width="1200" height="675" fill="url(#g)"/>
<circle cx="600" cy="300" r="150" fill="#080d18" stroke="#64748b" stroke-width="10"/>
<circle cx="600" cy="300" r="60" fill="#e31b23"/>
<path d="M475 175L725 425M725 175L475 425" stroke="#f8fafc" stroke-width="28" opacity=".9"/>
<rect x="405" y="485" width="390" height="35" rx="18" fill="#334155"/>
<text x="600" y="635" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="700" fill="#f8fafc">CINEINSTA • FILM PRODUCTION</text>
</svg>`,

  review: `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#172554"/></linearGradient></defs>
<rect width="1200" height="675" fill="url(#g)"/>
<rect x="280" y="125" width="640" height="360" rx="25" fill="#080d18" stroke="#64748b" stroke-width="8"/>
<polygon points="550,210 550,400 755,305" fill="#e31b23"/>
<circle cx="405" cy="305" r="18" fill="#f8fafc"/>
<circle cx="795" cy="305" r="18" fill="#f8fafc"/>
<path d="M385 540h430" stroke="#64748b" stroke-width="18" stroke-linecap="round"/>
<text x="600" y="635" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="700" fill="#f8fafc">CINEINSTA • FILM REVIEW</text>
</svg>`
};

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

function chooseGenericImage(title = "", summary = "") {
  const text = `${title} ${summary}`.toLowerCase();

  if (/\b(ott|streaming|netflix|prime video|hotstar|aha|zee5|sony liv)\b/.test(text)) {
    return "ott";
  }

  if (/\b(ticket|tickets|ticket price|box office|collection|collections|occupancy|advance booking)\b/.test(text)) {
    return "tickets";
  }

  if (/\b(review|reviews|rating|ratings|critics|critic)\b/.test(text)) {
    return "review";
  }

  if (/\b(social media|instagram|twitter|x.com|viral|online|troll|trolling|negativity|controversy)\b/.test(text)) {
    return "social";
  }

  if (/\b(shoot|shooting|production|filming|director|maker|makers|schedule|sets)\b/.test(text)) {
    return "production";
  }

  return "theatre";
}

async function ensureGenericImages() {
  await fs.mkdir(GENERIC_DIR, { recursive: true });

  for (const [name, svg] of Object.entries(GENERIC_IMAGES)) {
    await fs.writeFile(`${GENERIC_DIR}/${name}.svg`, svg, "utf8");
  }

  console.log(`Original Cineinsta generic image set ready: ${Object.keys(GENERIC_IMAGES).length} images`);
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
      const description = stripHtml(xmlTag(itemXml, "description"));
      const source = xmlTag(itemXml, "source") || "Google News";
      const publishedAt = xmlTag(itemXml, "pubDate");

      if (!title || !url || !isLikelyCinema(title, description)) continue;

      const imageType = chooseGenericImage(title, description);

      all.push({
        id: url,
        title,
        summary: cleanSummary(description, title),
        source,
        url,
        img: `/assets/news-generic/${imageType}.svg`,
        imageType,
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

  await ensureGenericImages();

  const existing = await loadExisting();
  const news = await collectNews();

  const finalNews =
    news.length ? news : Array.isArray(existing.news) ? existing.news : [];

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
  console.log("News images: Cineinsta-original generic SVGs only.");
  console.log("feed.json updated successfully.");
}

main().catch(error => {
  console.error("Cineinsta feed updater failed:");
  console.error(error);
  process.exit(1);
});
