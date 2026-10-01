import fs from “node:fs/promises”;

const USER_AGENT = “Mozilla/5.0 (Windows NT 10.0; Win64; x64)
AppleWebKit/537.36 Chrome/153 Safari/537.36”;

const DATA_FILE = “data/feed.json”;

const NEWS_SOURCES = [ { name: “123telugu”, url:
“https://www.123telugu.com/category/mnews/”, domain: “123telugu.com” },
{ name: “TeluguCinema”, url: “https://telugucinema.com/news”, domain:
“telugucinema.com” }, { name: “Telugu360”, url:
“https://www.telugu360.com/category/movies/”, domain: “telugu360.com” },
{ name: “Gulte”, url: “https://www.gulte.com/movienews”, domain:
“gulte.com” }, { name: “GreatAndhra”, url:
“https://www.greatandhra.com/movies/news”, domain: “greatandhra.com” },
{ name: “Idlebrain”, url: “https://www.idlebrain.com/news/”, domain:
“idlebrain.com” }];

const BLOCKED_TERMS = [ “tamil cinema”, “malayalam cinema”, “kannada
cinema”, “hindi cinema”, “bollywood”, “kollywood”, “mollywood”,
“sandalwood”, “rajinikanth”, “vijay thalapathy”, “ajith”, “mammootty”,
“mohanlal”, “dhanush”, “suriya”, “thalapathy”, “tamil”, “malayalam”];

const TELUGU_TERMS = [ “telugu”, “tollywood”, “hyderabad”, “andhra”,
“telangana”, “allu arjun”, “mahesh babu”, “prabhas”, “ntr”, “jr ntr”,
“ram charan”, “chiranjeevi”, “pawan kalyan”, “nani”, “vijay
deverakonda”, “rashmika”, “samantha”, “venkatesh”, “balakrishna”, “naga
chaitanya”, “akhil akkineni”, “varun tej”, “sai dharam tej”, “nithiin”,
“sharwanand”, “adivi sesh”, “teja sajja”, “anushka shetty”, “sreeleela”,
“pooja hegde”, “keerthy suresh”, “trivikram”, “ss rajamouli”, “sukumar”,
“koratala”, “sekhar kammula”];

const CINEMA_TERMS = [ “movie”, “film”, “cinema”, “actor”, “actress”,
“director”, “trailer”, “teaser”, “ott”, “release”, “shoot”, “shooting”,
“tollywood”, “telugu”, “star”, “producer”, “hero”, “heroine”];

function decodeEntities(value = ““) { return String(value)
.replace(/ /gi,” “) .replace(/&/gi,”&“) .replace(/”/gi, ‘“‘)
.replace(/’|'/gi,”’“) .replace(/'/gi,”‘“) .replace(/’/gi,”’“)
.replace(/–/gi,”-“) .replace(/—/gi,”-“) .replace(/…/gi,”…“)
.replace(/</gi,”<“) .replace(/>/gi,”>“); }

function stripHTML(html = ““) { return decodeEntities( String(html)
.replace(/<script[]?</script>/gi, ” ”) .replace(/<style[]?</style>/gi,”
“) .replace(/<noscript[]?</noscript>/gi, ” ”)
.replace(/<svg[]?</svg>/gi,” “) .replace(/<[^>]+>/g,” “) .replace(/+/g,”
“) .trim() ); }

function absoluteUrl(url, base) { try { return new URL(url, base).href;
} catch { return ““; } }

function extractMeta(html, property) { const patterns = [ new
RegExp(<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["'],
“i”), new
RegExp(<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["'],
“i”), new
RegExp(<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["'],
“i”), new
RegExp(<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["'],
“i”) ];

for (const pattern of patterns) { const match = html.match(pattern); if
(match?.[1]) return decodeEntities(match[1]).trim(); }

return ““; }

function extractHeadline(html, fallback = ““) { const h1 =
html.match(/<h1[^>]>([]?)</h1>/i); if (h1?.[1]) return stripHTML(h1[1]);

const ogTitle = extractMeta(html, “og:title”); if (ogTitle) return
ogTitle;

const title = html.match(/<title[^>]>([]?)</title>/i); if (title?.[1])
return stripHTML(title[1]);

return fallback; }

function extractDate(html) { const candidates = [ extractMeta(html,
“article:published_time”), extractMeta(html, “datePublished”),
extractMeta(html, “publish_date”), extractMeta(html, “date”) ];

for (const value of candidates) { if (value && !Number.isNaN(new
Date(value).getTime())) { return new Date(value).toISOString(); } }

return null; }

/ THIS IS THE IMAGE LOGIC FROM THE EARLIER WORKING CINEINSTA VERSION: 1.
Read the publisher article itself. 2. Take og:image / twitter:image. 3.
Fall back to JSON-LD image. 4. Fall back to the article’s own tags. 5.
Validate the image before publishing it. / function
extractArticleImages(html, baseUrl) { const results = [];

const meta = [ extractMeta(html, “og:image”), extractMeta(html,
“og:image:url”), extractMeta(html, “og:image:secure_url”),
extractMeta(html, “twitter:image”), extractMeta(html,
“twitter:image:src”) ];

for (const value of meta) { const url = absoluteUrl(value, baseUrl); if
(url) results.push(url); }

const jsonBlocks = html.match(
/<script^>]type=[“’]application/ld+json[“’][^>]>[]*?</script>/gi ) ||
[];

function walk(value) { if (!value) return;

    if (typeof value === "string") {
      const url = absoluteUrl(value, baseUrl);
      if (url) results.push(url);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (typeof value === "object") {
      ["image", "thumbnailUrl", "contentUrl", "url"].forEach(key => {
        if (value[key]) walk(value[key]);
      });
    }

}

for (const block of jsonBlocks) { const raw = block
.replace(/^(<script)>]*>/i, ““) .replace(/</script>$/i,”“) .trim();

    try {
      walk(JSON.parse(raw));
    } catch {}

}

const imgTags = html.match(/<img^>]*>/gi) || [];

for (const tag of imgTags) { for (const attr of [ “src”, “data-src”,
“data-lazy-src”, “data-original”, “data-lazy”, “data-image” ]) { const
raw = tag.match( new RegExp(${attr}=["']([^"']+)["'], “i”) )?.[1];

      const url = absoluteUrl(raw, baseUrl);
      if (url) {
        results.push(url);
        break;
      }
    }

}

return […new Set(results)]; }

const imageValidationCache = new Map();

async function isUsableImage(url) { if (!url ||
!/^https?:///i.test(url)) return false; if
(imageValidationCache.has(url)) return imageValidationCache.get(url);

const promise = (async () => { const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        },
        signal: controller.signal
      });

      const contentType =
        (response.headers.get("content-type") || "").toLowerCase();

      return response.ok && contentType.startsWith("image/");
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }

})();

imageValidationCache.set(url, promise); return promise; }

async function fetchHTML(url) { try { const response = await fetch(url,
{ headers: { “User-Agent”: USER_AGENT, Accept:
“text/html,application/xhtml+xml,application/xml;q=0.9,/;q=0.8”,
“Accept-Language”: “en-IN,en;q=0.9” }, redirect: “follow” });

    if (!response.ok) {
      console.log(`FAILED ${response.status}: ${url}`);
      return { html: "", finalUrl: url };
    }

    return {
      html: await response.text(),
      finalUrl: response.url || url
    };

} catch (error) { console.log(FAILED ${url}: ${error.message}); return {
html: ““, finalUrl: url }; } }

function extractLinks(html, baseUrl) { const links = []; const re =
/<a^>]href=“’[“’][^>]>([]*?)</a>/gi;

let match;

while ((match = re.exec(html))) { const url = absoluteUrl(match[1],
baseUrl); const text = stripHTML(match[2]);

    if (url && text) links.push({ url, text });

}

const seen = new Set();

return links.filter(link => { if (seen.has(link.url)) return false;
seen.add(link.url); return true; }); }

function isBadTitle(title = ““) { const value =
title.trim().toLowerCase();

return ( value.length < 10 || [ “home”, “menu”, “read more”, “view all”,
“more”, “latest news”, “movie news”, “news”, “photos”, “gallery”,
“videos”, “video”, “advertisement”, “subscribe” ].includes(value) ); }

function isNewsLink(source, link) { const url = link.url.toLowerCase();
const text = link.text.trim();

if (!url.includes(source.domain)) return false; if (isBadTitle(text))
return false; if (text.length < 15 || text.length > 220) return false;

if ( [“/category/”, “/tag/”, “/author/”, “/page/”, “/search”,
“/contact”, “/about”, “/privacy”, “/terms”] .some(part =>
url.includes(part)) ) { return false; }

const combined = ${text} ${url}.toLowerCase();

return CINEMA_TERMS.some(term => combined.includes(term)); }

function isTeluguCinema(title, description, url) { const value =
${title} ${description} ${url}.toLowerCase();

if (BLOCKED_TERMS.some(term => value.includes(term))) return false;

return ( TELUGU_TERMS.some(term => value.includes(term)) &&
CINEMA_TERMS.some(term => value.includes(term)) ); }

function makeSummary(text, title) { let clean =
stripHTML(text).replace(/+/g, ” “).trim();

if (clean.toLowerCase().startsWith(title.toLowerCase())) { clean =
clean.slice(title.length).trim(); }

if (clean.length < 80) { return Latest Telugu cinema update: ${title}.;
}

if (clean.length > 240) { clean = clean.slice(0, 237).replace(/+$/, ““)
+”…“; }

return clean; }

function normalizeTitle(title = ““) { return title .toLowerCase()
.replace(/[^a-z0-9\u0C00-\u0C7F]+/g,” “) .replace(
/latest|breaking|exclusive|update|updates|news|report|reports|official)g,”
” ) .replace(/+/g, ” “) .trim(); }

function similarity(a, b) { const aa = new Set(normalizeTitle(a).split(”
“).filter(x => x.length > 2)); const bb = new
Set(normalizeTitle(b).split(” “).filter(x => x.length > 2));

if (!aa.size || !bb.size) return 0;

let common = 0; for (const word of aa) { if (bb.has(word)) common++; }

return common / Math.max(aa.size, bb.size); }

async function readNewsArticle(source, candidate) { const page = await
fetchHTML(candidate.url);

if (!page.html) return null;

const title = extractHeadline(page.html, candidate.text);

if (!title || isBadTitle(title)) return null;

const description = stripHTML(page.html);

if (!isTeluguCinema(title, description, page.finalUrl)) { return null; }

const images = extractArticleImages(page.html, page.finalUrl);

let image = ““;

for (const candidateImage of images) { if (await
isUsableImage(candidateImage)) { image = candidateImage; break; } }

// Important: do not publish a story with a fake/fallback image. if
(!image) return null;

return { id: candidate.url, title, summary: makeSummary(description,
title), source: source.name, url: candidate.url, img: image,
publishedAt: extractDate(page.html), language: “Telugu”, category:
“Telugu Cinema” }; }

async function collectNews() { const all = [];

console.log(“======================================”);
console.log(“CINEINSTA NEWS — DIRECT PUBLISHER IMAGE MODE”);
console.log(“======================================”);

for (const source of NEWS_SOURCES) {
console.log(Loading ${source.name}: ${source.url});

    const page = await fetchHTML(source.url);

    if (!page.html) continue;

    const candidates = extractLinks(page.html, source.url)
      .filter(link => isNewsLink(source, link))
      .slice(0, 18);

    console.log(`${source.name}: ${candidates.length} candidates`);

    for (const candidate of candidates) {
      const article = await readNewsArticle(source, candidate);

      if (article) {
        console.log(
          `${source.name} | ${article.title} | IMAGE OK`
        );
        all.push(article);
      }
    }

}

const output = []; const seenUrls = new Set();

for ( const item of all.sort( (a, b) => new Date(b.publishedAt || 0) -
new Date(a.publishedAt || 0) ) ) { const urlKey = item.url
.split(“?”)[0] .replace(//$/, ““) .toLowerCase();

    if (seenUrls.has(urlKey)) continue;

    if (
      output.some(
        existing => similarity(existing.title, item.title) >= 0.68
      )
    ) {
      continue;
    }

    seenUrls.add(urlKey);
    output.push(item);

    if (output.length >= 40) break;

}

return output; }

async function loadExisting() { try { const raw = await
fs.readFile(DATA_FILE, “utf8”); const data = JSON.parse(raw); return
data && typeof data === “object” ? data : {}; } catch { return {}; } }

async function main() {
console.log(“======================================”);
console.log(“CINEINSTA FEED UPDATE”);
console.log(“======================================”);

const existing = await loadExisting(); const news = await collectNews();

/ Keep the existing feed if the live collection temporarily returns
fewer than 20 stories. Never replace good live data with an
incomplete/broken collection. / const finalNews = news.length >= 20 ?
news : Array.isArray(existing.news) && existing.news.length >= 20 ?
existing.news : news;

const feed = { updatedAt: new Date().toISOString(), language: “Telugu”,
news: finalNews, trailers: Array.isArray(existing.trailers) ?
existing.trailers : [], interviews: Array.isArray(existing.interviews) ?
existing.interviews : [], reviews: Array.isArray(existing.reviews) ?
existing.reviews : [] };

await fs.mkdir(“data”, { recursive: true });

await fs.writeFile( DATA_FILE, JSON.stringify(feed, null, 2), “utf8” );

console.log(News collected: ${news.length});
console.log(News published: ${finalNews.length}); console.log(“feed.json
updated successfully.”); }

main().catch(error => { console.error(“Cineinsta feed updater failed:”);
console.error(error); process.exit(1); });
