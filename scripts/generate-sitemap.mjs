import fs from "fs";

const BASE_URL = "https://www.cineinsta.com";
const FEED_PATH = "data/feed.json";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function articleSlug(item) {
  return slugify(item.title || item.t || "cineinsta-story");
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function dateOnly(value) {
  const iso = isoDate(value);
  return iso ? iso.slice(0, 10) : null;
}

function uniqueUrls(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (!entry || !entry.loc || seen.has(entry.loc)) return false;
    seen.add(entry.loc);
    return true;
  });
}

function urlset(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>${entry.lastmod ? `
    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : ""}
  </url>`).join("\n")}
</urlset>
`;
}

function sitemapIndex(files) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${files.map((file) => `  <sitemap>
    <loc>${escapeXml(`${BASE_URL}/${file}`)}</loc>
  </sitemap>`).join("\n")}
</sitemapindex>
`;
}

if (!fs.existsSync(FEED_PATH)) {
  throw new Error(`Missing ${FEED_PATH}`);
}

const feed = JSON.parse(fs.readFileSync(FEED_PATH, "utf8"));

const news = Array.isArray(feed.news) ? feed.news : [];
const reviews = Array.isArray(feed.reviews) ? feed.reviews : [];
const trailers = Array.isArray(feed.trailers) ? feed.trailers : [];

const newsUrls = uniqueUrls(
  news.map((item) => ({
    loc: `${BASE_URL}/news/${articleSlug(item)}`,
    lastmod: isoDate(item.publishedAt) || isoDate(feed.updatedAt)
  }))
);

const reviewUrls = uniqueUrls(
  reviews.map((item) => ({
    loc: `${BASE_URL}/reviews/${articleSlug(item)}`,
    lastmod: isoDate(item.publishedAt || item.releaseDate) || isoDate(feed.updatedAt)
  }))
);

const trailerUrls = uniqueUrls(
  trailers.map((item) => ({
    loc: `${BASE_URL}/trailers/${articleSlug(item)}`,
    lastmod: isoDate(item.publishedAt || item.releaseDate) || isoDate(feed.updatedAt)
  }))
);

const pageUrls = uniqueUrls([
  { loc: `${BASE_URL}/`, lastmod: isoDate(feed.updatedAt) },
  { loc: `${BASE_URL}/news`, lastmod: isoDate(feed.updatedAt) },
  { loc: `${BASE_URL}/reviews`, lastmod: isoDate(feed.updatedAt) },
  { loc: `${BASE_URL}/trailers`, lastmod: isoDate(feed.updatedAt) },
  { loc: `${BASE_URL}/buzz`, lastmod: isoDate(feed.updatedAt) },
  { loc: `${BASE_URL}/box-office-battle.html` },
  { loc: `${BASE_URL}/about.html` },
  { loc: `${BASE_URL}/contact.html` },
  { loc: `${BASE_URL}/privacy-policy.html` },
  { loc: `${BASE_URL}/terms.html` },
  { loc: `${BASE_URL}/disclaimer.html` }
]);

fs.writeFileSync("sitemap-news.xml", urlset(newsUrls), "utf8");
fs.writeFileSync(
  "sitemap-pages.xml",
  urlset(uniqueUrls([...pageUrls, ...reviewUrls, ...trailerUrls])),
  "utf8"
);
fs.writeFileSync(
  "sitemap.xml",
  sitemapIndex(["sitemap-pages.xml", "sitemap-news.xml"]),
  "utf8"
);

console.log(`News URLs: ${newsUrls.length}`);
console.log(`Page/review/trailer URLs: ${pageUrls.length + reviewUrls.length + trailerUrls.length}`);
console.log("Generated sitemap.xml, sitemap-pages.xml and sitemap-news.xml.");
