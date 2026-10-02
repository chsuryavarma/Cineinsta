import fs from "node:fs/promises";

/*
=========================================================
CINEINSTA SOUTH INDIAN TRAILER FEED UPDATER
=========================================================

PURPOSE
- Telugu, Tamil, Malayalam and Kannada trailers only.
- No Hindi / Bollywood / English-only trailers.
- Reject songs, lyrical videos, interviews, reviews, promos,
  reactions, making/behind-the-scenes videos and shorts.
- Validate discovered YouTube IDs before publishing them.
- Preserve existing working trailer records where possible.
- Preserve existing trailer titles for matching YouTube IDs so
  article slugs/routes do not change unnecessarily.
- Update ONLY data/feed.json.

IMPORTANT PLAYBACK SAFETY
- This script does NOT modify index.html.
- This script does NOT modify the existing YouTube iframe/player.
- This script only supplies trailer data, including youtubeId.
- If validation fails, the candidate is skipped.
- If the source run fails or produces too few usable trailers,
  existing trailer data is retained rather than publishing an
  empty/broken trailer section.
=========================================================
*/

const FEED_FILE = new URL("../data/feed.json", import.meta.url);

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36";

const SOUTH_LANGUAGES = ["Telugu", "Tamil", "Malayalam", "Kannada"];

const SOURCES = [
  {
    name: "FilmiBeat Telugu",
    language: "Telugu",
    url: "https://www.filmibeat.com/telugu/movies.html",
    domain: "filmibeat.com"
  },
  {
    name: "FilmiBeat Tamil",
    language: "Tamil",
    url: "https://www.filmibeat.com/tamil/movies.html",
    domain: "filmibeat.com"
  },
  {
    name: "FilmiBeat Malayalam",
    language: "Malayalam",
    url: "https://www.filmibeat.com/malayalam/movies.html",
    domain: "filmibeat.com"
  },
  {
    name: "FilmiBeat Kannada",
    language: "Kannada",
    url: "https://www.filmibeat.com/kannada/movies.html",
    domain: "filmibeat.com"
  },
  {
    name: "ETimes Telugu",
    language: "Telugu",
    url: "https://timesofindia.indiatimes.com/entertainment/telugu/movies",
    domain: "timesofindia.indiatimes.com"
  },
  {
    name: "IndiaGlitz Telugu",
    language: "Telugu",
    url: "https://indiaglitz.com/telugu/movie-news",
    domain: "indiaglitz.com"
  },
  {
    name: "Nettv4u South Trailers",
    language: "South",
    url: "https://nettv4u.com/trailers",
    domain: "nettv4u.com"
  }
];

const TRAILER_WORDS = [
  "official trailer",
  "trailer",
  "official teaser",
  "teaser",
  "glimpse"
];

const BLOCKED_VIDEO_WORDS = [
  "song",
  "lyrical",
  "lyric video",
  "video song",
  "making",
  "behind the scenes",
  "interview",
  "review",
  "promo",
  "short",
  "reel",
  "reaction",
  "first look",
  "motion poster"
];

const NON_SOUTH_LANGUAGE_WORDS = [
  "hindi",
  "bollywood",
  "english",
  "marathi",
  "bengali",
  "punjabi",
  "gujarati",
  "bhojpuri",
  "odia",
  "oriya",
  "assamese"
];

function decodeEntities(value = "") {
  return value
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
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : "";
    });
}

function stripHTML(html = "") {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function absoluteUrl(value, base) {
  try {
    return new URL(value, base).href;
  } catch {
    return "";
  }
}

async function fetchHTML(url) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9"
      }
    });

    if (!response.ok) {
      console.log(`FAILED ${response.status}: ${url}`);
      return "";
    }

    return await response.text();
  } catch (error) {
    console.log(`FAILED: ${url}`);
    console.log(error.message);
    return "";
  }
}

async function validateYouTubeId(youtubeId) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) return false;

  const watchUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;

  try {
    const response = await fetch(oembedUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      console.log(`SKIP invalid/unavailable YouTube ID: ${youtubeId}`);
      return false;
    }

    const data = await response.json();
    if (!data?.title) {
      console.log(`SKIP YouTube ID without metadata: ${youtubeId}`);
      return false;
    }

    const title = String(data.title).toLowerCase();
    if (BLOCKED_VIDEO_WORDS.some(word => title.includes(word))) {
      console.log(`SKIP blocked YouTube video: ${youtubeId} | ${data.title}`);
      return false;
    }

    return true;
  } catch (error) {
    console.log(`SKIP YouTube validation error: ${youtubeId} | ${error.message}`);
    return false;
  }
}

function extractMeta(html, name) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)['"]`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)['"][^>]+property=["']${name}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)['"]`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)['"][^>]+name=["']${name}["']`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]).trim();
  }

  return "";
}

function extractHeadline(html, fallback = "") {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1?.[1]) return stripHTML(h1[1]);

  const ogTitle = extractMeta(html, "og:title");
  if (ogTitle) return ogTitle;

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title?.[1]) return stripHTML(title[1]);

  return fallback;
}

function extractImage(html) {
  return extractMeta(html, "og:image") || extractMeta(html, "twitter:image") || "";
}

function extractPublishedDate(html) {
  const values = [
    extractMeta(html, "article:published_time"),
    extractMeta(html, "datePublished"),
    extractMeta(html, "date"),
    extractMeta(html, "publish_date")
  ];

  for (const value of values) {
    const date = new Date(value);
    if (value && !Number.isNaN(date.getTime())) return date.toISOString();
  }

  const visible = stripHTML(html);
  const match = visible.match(
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i
  );

  if (match) {
    const date = new Date(match[0]);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return null;
}

function extractLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    const url = absoluteUrl(match[1], baseUrl);
    const text = stripHTML(match[2]);
    if (url && text) links.push({ url, text });
  }

  const seen = new Set();
  return links.filter(item => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function normalizeTitle(value = "") {
  return decodeEntities(value)
    .replace(/\s+/g, " ")
    .replace(/\s*[|–—-]\s*(FilmiBeat|Filmibeat|ETimes|IndiaGlitz|Nettv4u).*$/i, "")
    .trim();
}

function normalizedKey(value = "") {
  return normalizeTitle(value)
    .toLowerCase()
    .replace(/official|trailer|teaser|glimpse|telugu|tamil|malayalam|kannada|hindi/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  const aa = new Set(normalizedKey(a).split(" ").filter(x => x.length > 2));
  const bb = new Set(normalizedKey(b).split(" ").filter(x => x.length > 2));
  if (!aa.size || !bb.size) return 0;

  let common = 0;
  for (const token of aa) if (bb.has(token)) common++;
  return common / Math.max(aa.size, bb.size);
}

function extractYouTubeIds(text = "") {
  const ids = [];
  const patterns = [
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/gi,
    /youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})/gi,
    /youtube\.com\/watch\?[^"'&\s]*v=([A-Za-z0-9_-]{11})/gi,
    /youtu\.be\/([A-Za-z0-9_-]{11})/gi,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/gi,
    /"videoId":"([A-Za-z0-9_-]{11})"/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      if (!ids.includes(match[1])) ids.push(match[1]);
      if (ids.length >= 30) return ids;
    }
  }

  return ids;
}

function hasTrailerWords(text = "") {
  const value = text.toLowerCase();
  return TRAILER_WORDS.some(word => value.includes(word));
}

function hasBlockedWords(text = "") {
  const value = text.toLowerCase();
  return BLOCKED_VIDEO_WORDS.some(word => value.includes(word));
}

function hasNonSouthLanguage(text = "") {
  const value = text.toLowerCase();
  return NON_SOUTH_LANGUAGE_WORDS.some(word => {
    const pattern = new RegExp(`\\b${word.replace(/ /g, "\\s+")}\\b`, "i");
    return pattern.test(value);
  });
}

function isUsefulTrailerLink(source, link) {
  const text = link.text.trim();
  const url = link.url.toLowerCase();

  if (text.length < 8 || text.length > 220) return false;
  if (hasBlockedWords(text)) return false;
  if (hasNonSouthLanguage(text)) return false;

  const filmibeatVideoPage =
    source.domain === "filmibeat.com" &&
    /\/movies\/[^/]+\/videos\.html/i.test(url);

  const nettvTrailer =
    source.domain === "nettv4u.com" &&
    /\/trailers/i.test(url);

  return filmibeatVideoPage || nettvTrailer || hasTrailerWords(text);
}

function cleanTrailerTitle(title = "") {
  return normalizeTitle(title)
    .replace(/\s+Trailer\s*$/i, "")
    .replace(/\s+Teaser\s*$/i, "")
    .replace(/\s+Glimpse\s*$/i, "")
    .trim();
}

function inferLanguage(source, html, title, candidateText) {
  if (source.language !== "South") return source.language;

  const text = `${candidateText} ${title} ${stripHTML(html)}`.toLowerCase();

  // Prefer explicit South-language labels.
  for (const language of SOUTH_LANGUAGES) {
    if (text.includes(language.toLowerCase())) return language;
  }

  // Nettv4u may expose a language as a nearby label but not in the link text.
  const languageMatch = text.match(/\b(telugu|tamil|malayalam|kannada)\b/i);
  return languageMatch ? languageMatch[1][0].toUpperCase() + languageMatch[1].slice(1).toLowerCase() : "";
}

function scoreYouTubeCandidate(html, id, pageTitle, candidateText) {
  const lowerHTML = html.toLowerCase();
  const occurrences = [];
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escapedId, "gi");
  let match;

  while ((match = regex.exec(lowerHTML))) {
    occurrences.push(match.index);
    if (occurrences.length >= 10) break;
  }

  let bestScore = -999;

  for (const position of occurrences) {
    const context = html.slice(
      Math.max(0, position - 3500),
      Math.min(html.length, position + 3500)
    );
    const lower = context.toLowerCase();

    let score = 0;

    if (lower.includes("official trailer")) score += 8;
    else if (lower.includes("trailer")) score += 6;

    if (lower.includes("official teaser")) score += 4;
    else if (lower.includes("teaser")) score += 3;

    if (lower.includes("glimpse")) score += 2;
    if (String(pageTitle).toLowerCase().includes("trailer")) score += 2;
    if (String(candidateText).toLowerCase().includes("trailer")) score += 2;

    if (hasBlockedWords(context)) score -= 12;
    if (hasNonSouthLanguage(context)) score -= 10;

    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

async function readTrailer(source, candidate) {
  const html = await fetchHTML(candidate.url);
  if (!html) return null;

  const pageTitle = extractHeadline(html, candidate.text);
  if (!pageTitle) return null;

  const combinedTitle = `${pageTitle} ${candidate.text}`;
  const dedicatedFilmibeat =
    source.domain === "filmibeat.com" &&
    /\/movies\/[^/]+\/videos\.html/i.test(candidate.url);
  const nettvTrailer = source.domain === "nettv4u.com" && /\/trailers/i.test(candidate.url);

  if (!dedicatedFilmibeat && !nettvTrailer && !hasTrailerWords(combinedTitle)) {
    return null;
  }

  if (hasBlockedWords(combinedTitle)) return null;
  if (hasNonSouthLanguage(combinedTitle)) return null;

  const ids = extractYouTubeIds(html);
  if (!ids.length) {
    console.log(`No YouTube IDs found: ${pageTitle}`);
    return null;
  }

  let bestId = "";
  let bestScore = -999;

  for (const id of ids) {
    const score = scoreYouTubeCandidate(html, id, pageTitle, candidate.text);
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }

  if (!bestId || bestScore < 4) {
    console.log(`No strong trailer YouTube match: ${pageTitle}`);
    return null;
  }

  const language = inferLanguage(source, html, pageTitle, candidate.text);

  if (!SOUTH_LANGUAGES.includes(language)) {
    console.log(`SKIP non-South/unknown language: ${pageTitle}`);
    return null;
  }

  // Explicitly reject a video/page that identifies itself as Hindi or another non-South language.
  const languageText = `${pageTitle} ${candidate.text}`;
  if (hasNonSouthLanguage(languageText)) {
    console.log(`SKIP non-South language label: ${pageTitle}`);
    return null;
  }

  const validYouTube = await validateYouTubeId(bestId);
  if (!validYouTube) return null;

  const title = cleanTrailerTitle(pageTitle);
  if (!title || title.length < 3) return null;

  return {
    id: `youtube:${bestId}`,
    title,
    source: source.name,
    url: `https://www.youtube.com/watch?v=${bestId}`,
    originalUrl: candidate.url,
    img: `https://i.ytimg.com/vi/${bestId}/hqdefault.jpg`,
    youtubeId: bestId,
    publishedAt: extractPublishedDate(html),
    language
  };
}

function dedupeTrailers(items) {
  const output = [];
  const seenIds = new Set();
  const seenUrls = new Set();

  for (const item of items) {
    if (!item?.youtubeId || !SOUTH_LANGUAGES.includes(item.language)) continue;
    if (seenIds.has(item.youtubeId)) continue;

    const originalUrl = String(item.originalUrl || "").toLowerCase();
    if (originalUrl && seenUrls.has(originalUrl)) continue;

    const duplicate = output.some(existing => similarity(existing.title, item.title) >= 0.78);
    if (duplicate) continue;

    seenIds.add(item.youtubeId);
    if (originalUrl) seenUrls.add(originalUrl);
    output.push(item);
  }

  return output;
}

async function collectSource(source) {
  console.log(`\nLoading ${source.name}: ${source.url}`);

  const html = await fetchHTML(source.url);
  if (!html) {
    console.log(`${source.name}: source unavailable`);
    return [];
  }

  const candidates = extractLinks(html, source.url)
    .filter(link => isUsefulTrailerLink(source, link))
    .slice(0, 30);

  console.log(`${source.name}: ${candidates.length} candidates`);

  const results = [];

  for (const candidate of candidates) {
    const trailer = await readTrailer(source, candidate);

    if (trailer) {
      console.log(
        `${source.name} | ${trailer.title} | ${trailer.language} | ${trailer.youtubeId}`
      );
      results.push(trailer);
    }
  }

  return results;
}

function sortNewestFirst(items) {
  return [...items].sort((a, b) => {
    const ad = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bd = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return bd - ad;
  });
}

function mergeWithPrevious(fresh, previous) {
  const previousById = new Map(
    previous
      .filter(item => item?.youtubeId)
      .map(item => [item.youtubeId, item])
  );

  return fresh.map(item => {
    const old = previousById.get(item.youtubeId);
    if (!old) return item;

    return {
      ...old,
      // Keep the existing title to avoid unnecessary article-slug changes.
      title: old.title || item.title,
      source: item.source || old.source,
      url: `https://www.youtube.com/watch?v=${item.youtubeId}`,
      originalUrl: item.originalUrl || old.originalUrl,
      img: `https://i.ytimg.com/vi/${item.youtubeId}/hqdefault.jpg`,
      youtubeId: item.youtubeId,
      publishedAt: item.publishedAt || old.publishedAt,
      language: item.language || old.language,
      id: old.id || item.id
    };
  });
}

async function writeAtomic(fileUrl, data) {
  const filePath = fileUrl.pathname;
  const tempUrl = new URL(fileUrl.href + ".tmp");
  const tempPath = tempUrl.pathname;

  await fs.writeFile(tempPath, data, "utf8");
  await fs.rename(tempPath, filePath);
}

async function main() {
  const feed = JSON.parse(await fs.readFile(FEED_FILE, "utf8"));

  const previous = Array.isArray(feed.trailers)
    ? dedupeTrailers(feed.trailers)
    : [];

  const collected = [];

  for (const source of SOURCES) {
    const items = await collectSource(source);
    collected.push(...items);
  }

  let fresh = dedupeTrailers(collected);

  // Prefer freshly discovered, validated South Indian trailers.
  // If discovery is temporarily weak, retain previous validated trailers
  // so the live trailer section does not suddenly become empty.
  if (fresh.length < 8) {
    console.log(
      `Only ${fresh.length} fresh validated South Indian trailers found. Adding previous South Indian trailers as fallback.`
    );
    fresh = dedupeTrailers([...fresh, ...previous]);
  }

  fresh = mergeWithPrevious(sortNewestFirst(fresh), previous).slice(0, 24);

  // Never publish an empty trailer feed when working data already exists.
  if (!fresh.length && previous.length) {
    fresh = previous;
  }

  // Final safety gate: no non-South language record can be written.
  fresh = fresh.filter(item => SOUTH_LANGUAGES.includes(item.language));

  feed.trailers = fresh;
  feed.updatedAt = new Date().toISOString();

  await writeAtomic(
    FEED_FILE,
    JSON.stringify(feed, null, 2) + "\n"
  );

  console.log(`\nCineinsta South Indian trailer feed updated: ${fresh.length} trailers.`);

  const languageCounts = {};
  for (const item of fresh) {
    languageCounts[item.language] = (languageCounts[item.language] || 0) + 1;
  }

  console.log("Languages:", JSON.stringify(languageCounts));
  console.log("Player/index.html was not modified by this script.");
}

main().catch(error => {
  console.error("Trailer updater failed:", error);
  process.exit(1);
});
