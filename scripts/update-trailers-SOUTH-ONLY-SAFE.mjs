import fs from "node:fs/promises";

/*
CINEINSTA SOUTH INDIAN TRAILER FEED UPDATER - V2

Only:
- Telugu
- Tamil
- Malayalam
- Kannada

This script updates ONLY data/feed.json.
It does NOT modify index.html or the YouTube player.

Safety:
- Official/full trailers only; teasers, songs, interviews, promos and reviews are rejected.
- YouTube IDs are validated with YouTube oEmbed before publishing.
- Existing trailer records are filtered for South-language safety.
- If discovery fails, the existing usable South trailer records are retained.
- Existing titles are preserved when the same YouTube ID is rediscovered.
*/

const FEED_FILE = new URL("../data/feed.json", import.meta.url);

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36";

const SOUTH_LANGUAGES = ["Telugu", "Tamil", "Malayalam", "Kannada"];

const SOURCES = [
  {
    name: "123telugu",
    language: "Telugu",
    url: "https://www.123telugu.com/videos/trailers",
    domains: ["123telugu.com"]
  },
  {
    name: "Dinamalar Cinema",
    language: "Tamil",
    url: "https://cinema.dinamalar.com/trailers",
    domains: ["cinema.dinamalar.com", "dinamalar.com"]
  },
  {
    name: "Asianet News",
    language: "Malayalam",
    url: "https://www.asianetnews.com/trailer",
    domains: ["asianetnews.com"]
  },
  {
    name: "Nettv4u",
    language: "South",
    url: "https://nettv4u.com/trailers",
    domains: ["nettv4u.com"]
  },
  {
    name: "CinemaIP Kannada",
    language: "Kannada",
    url: "https://cinemaip.ai/trailers/kannada",
    domains: ["cinemaip.ai"]
  }
];

const TRAILER_WORDS = [
  "official trailer",
  "trailer",
  "official theatrical trailer",
  "official kannada trailer",
  "official tamil trailer",
  "official telugu trailer",
  "official malayalam trailer",
  "டிரைலர்",
  "ട്രെയിലർ",
  "ಟ್ರೈಲರ್",
  "ట్రైలర్"
];

const BLOCKED_VIDEO_WORDS = [
  "song",
  "lyrical",
  "lyric video",
  "video song",
  "music video",
  "making",
  "behind the scenes",
  "interview",
  "review",
  "promo",
  "reaction",
  "short",
  "shorts",
  "reel",
  "first look",
  "motion poster",
  "title announcement",
  "title reveal",
  "glimpse",
  "teaser",
  "introduction",
  "intro",
  "entry video",
  "birthday special",
  "release date",
  "story reveal"
];

const NON_SOUTH_LANGUAGE_WORDS = [
  "hindi",
  "bollywood",
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
    console.log(`FAILED ${url}: ${error.message}`);
    return "";
  }
}

async function validateYouTubeId(youtubeId) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) return false;

  const watchUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
  const oembedUrl =
    `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;

  try {
    const response = await fetch(oembedUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      console.log(`SKIP unavailable YouTube ID: ${youtubeId}`);
      return false;
    }

    const data = await response.json();
    if (!data?.title) return false;

    const title = String(data.title).toLowerCase();

    if (BLOCKED_VIDEO_WORDS.some(word => title.includes(word))) {
      console.log(`SKIP blocked YouTube video: ${youtubeId} | ${data.title}`);
      return false;
    }

    if (NON_SOUTH_LANGUAGE_WORDS.some(word => title.includes(word))) {
      console.log(`SKIP non-South YouTube video: ${youtubeId} | ${data.title}`);
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
    const key = item.url.split("#")[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractYouTubeIds(text = "") {
  const ids = [];
  const patterns = [
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/gi,
    /youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})/gi,
    /youtube\.com\/watch\?[^"'&\s]*v=([A-Za-z0-9_-]{11})/gi,
    /youtu\.be\/([A-Za-z0-9_-]{11})/gi,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/gi,
    /"videoId":"([A-Za-z0-9_-]{11})"/gi,
    /"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/gi
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text))) {
      if (!ids.includes(match[1])) ids.push(match[1]);
      if (ids.length >= 40) return ids;
    }
  }

  return ids;
}

function hasTrailerWords(text = "") {
  const value = text.toLowerCase();
  return TRAILER_WORDS.some(word => value.includes(word.toLowerCase()));
}

function hasBlockedWords(text = "") {
  const value = text.toLowerCase();
  return BLOCKED_VIDEO_WORDS.some(word => value.includes(word.toLowerCase()));
}

function hasNonSouthLanguage(text = "") {
  const value = text.toLowerCase();
  return NON_SOUTH_LANGUAGE_WORDS.some(word => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(value);
  });
}

function normalizeTitle(value = "") {
  return decodeEntities(value)
    .replace(/\s+/g, " ")
    .replace(/\s*[|–—-]\s*(FilmiBeat|Filmibeat|ETimes|IndiaGlitz|Nettv4u|123telugu).*$/i, "")
    .trim();
}

function cleanTrailerTitle(title = "") {
  return normalizeTitle(title)
    .replace(/\s*[-|:]\s*(official\s+)?(full\s+)?trailer\s*$/i, "")
    .replace(/\s+(official\s+)?(full\s+)?trailer\s*$/i, "")
    .trim();
}

function normalizedKey(value = "") {
  return normalizeTitle(value)
    .toLowerCase()
    .replace(/official|trailer|telugu|tamil|malayalam|kannada/g, " ")
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

function scoreYouTubeCandidate(html, id, pageTitle, candidateText) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escapedId, "gi");
  const positions = [];
  let match;

  while ((match = regex.exec(html))) {
    positions.push(match.index);
    if (positions.length >= 15) break;
  }

  let bestScore = -999;

  for (const position of positions) {
    const context = html.slice(
      Math.max(0, position - 4500),
      Math.min(html.length, position + 4500)
    );

    let score = 0;
    const lower = context.toLowerCase();
    const titleLower = String(pageTitle).toLowerCase();
    const candidateLower = String(candidateText).toLowerCase();

    if (lower.includes("official trailer")) score += 10;
    else if (lower.includes("trailer")) score += 7;

    if (titleLower.includes("trailer")) score += 5;
    if (candidateLower.includes("trailer")) score += 5;

    if (hasBlockedWords(context)) score -= 18;
    if (hasNonSouthLanguage(context)) score -= 15;

    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

function isGoodCandidateLink(source, link) {
  const text = link.text.trim();
  const url = link.url.toLowerCase();

  if (text.length < 4 || text.length > 300) return false;
  if (hasBlockedWords(text)) return false;
  if (hasNonSouthLanguage(text)) return false;

  // Listing pages often have many unrelated links. Require trailer wording,
  // or a dedicated trailer/video URL pattern.
  const trailerByText = hasTrailerWords(text);

  const trailerByUrl =
    /\/trailer[s]?([/?#]|$)/i.test(url) ||
    /\/videos?\/[^/]+/i.test(url) ||
    /videoshow\//i.test(url);

  if (!trailerByText && !trailerByUrl) return false;

  if (source.language !== "South") return true;

  // Nettv4u can contain multiple South languages. We will determine the
  // language from the nearby page text when reading the candidate.
  return true;
}

function inferSouthLanguage(source, html, title, candidateText) {
  if (source.language !== "South") return source.language;

  const text = `${title} ${candidateText} ${stripHTML(html)}`.toLowerCase();

  if (/\btelugu\b|తెలుగు/i.test(text)) return "Telugu";
  if (/\btamil\b|தமிழ்|டிரைலர்/i.test(text)) return "Tamil";
  if (/\bmalayalam\b|മലയാളം|ട്രെയിലർ/i.test(text)) return "Malayalam";
  if (/\bkannada\b|ಕನ್ನಡ|ಟ್ರೈಲರ್/i.test(text)) return "Kannada";

  // Nettv4u page entries may expose language in a dedicated nearby label.
  return "";
}

async function readTrailer(source, candidate) {
  const html = await fetchHTML(candidate.url);
  if (!html) return null;

  const pageTitle = extractHeadline(html, candidate.text);
  const combined = `${pageTitle} ${candidate.text}`;

  if (!hasTrailerWords(combined) && !/\/trailer[s]?([/?#]|$)/i.test(candidate.url)) {
    return null;
  }

  if (hasBlockedWords(combined)) return null;
  if (hasNonSouthLanguage(combined)) return null;

  const ids = extractYouTubeIds(html);
  if (!ids.length) {
    console.log(`No YouTube IDs: ${pageTitle}`);
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

  if (!bestId || bestScore < 5) {
    console.log(`No strong trailer video: ${pageTitle}`);
    return null;
  }

  const language = inferSouthLanguage(source, html, pageTitle, candidate.text);

  if (!SOUTH_LANGUAGES.includes(language)) {
    console.log(`SKIP unknown/non-South language: ${pageTitle}`);
    return null;
  }

  const valid = await validateYouTubeId(bestId);
  if (!valid) return null;

  const title = cleanTrailerTitle(pageTitle || candidate.text);
  if (!title || title.length < 2) return null;

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

  for (const item of items) {
    if (!item?.youtubeId) continue;
    if (!SOUTH_LANGUAGES.includes(item.language)) continue;
    if (seenIds.has(item.youtubeId)) continue;

    const titleText = `${item.title || ""} ${item.originalUrl || ""}`;

    if (hasBlockedWords(titleText)) continue;
    if (hasNonSouthLanguage(titleText)) continue;

    const duplicate = output.some(existing =>
      similarity(existing.title, item.title) >= 0.82
    );

    if (duplicate) continue;

    seenIds.add(item.youtubeId);
    output.push(item);
  }

  return output;
}

async function collectSource(source) {
  console.log(`\nLoading ${source.name}: ${source.url}`);

  const html = await fetchHTML(source.url);
  if (!html) return [];

  const candidates = extractLinks(html, source.url)
    .filter(link => isGoodCandidateLink(source, link))
    .slice(0, 40);

  console.log(`${source.name}: ${candidates.length} trailer candidates`);

  const results = [];

  for (const candidate of candidates) {
    const trailer = await readTrailer(source, candidate);

    if (trailer) {
      console.log(
        `${trailer.language} | ${trailer.title} | ${trailer.youtubeId}`
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
      title: old.title || item.title,
      source: item.source || old.source,
      url: `https://www.youtube.com/watch?v=${item.youtubeId}`,
      originalUrl: item.originalUrl || old.originalUrl,
      img: `https://i.ytimg.com/vi/${item.youtubeId}/hqdefault.jpg`,
      youtubeId: item.youtubeId,
      publishedAt: item.publishedAt || old.publishedAt,
      language: item.language,
      id: old.id || item.id
    };
  });
}

async function writeAtomic(fileUrl, data) {
  const filePath = fileUrl.pathname;
  const tempPath = `${filePath}.tmp`;

  await fs.writeFile(tempPath, data, "utf8");
  await fs.rename(tempPath, filePath);
}

async function main() {
  const feed = JSON.parse(await fs.readFile(FEED_FILE, "utf8"));

  // First remove any existing records that are clearly not South Indian.
  const previous = dedupeTrailers(
    Array.isArray(feed.trailers) ? feed.trailers : []
  );

  const collected = [];

  for (const source of SOURCES) {
    try {
      collected.push(...await collectSource(source));
    } catch (error) {
      console.log(`${source.name} failed: ${error.message}`);
    }
  }

  const fresh = dedupeTrailers(collected);

  console.log(`\nFresh validated South Indian trailers: ${fresh.length}`);

  let finalTrailers;

  if (fresh.length >= 4) {
    // Fresh validated records are preferred. Keep older usable records only
    // to fill the feed up to 24 cards.
    finalTrailers = dedupeTrailers([
      ...fresh,
      ...previous
    ]);
  } else {
    // Discovery can temporarily fail. Do not wipe the working section.
    finalTrailers = previous;
    console.log(
      "Fresh discovery returned fewer than 4 validated trailers; retaining existing usable South Indian records."
    );
  }

  finalTrailers = mergeWithPrevious(
    sortNewestFirst(finalTrailers),
    previous
  ).slice(0, 24);

  // Final hard safety gate.
  finalTrailers = finalTrailers.filter(item =>
    SOUTH_LANGUAGES.includes(item.language) &&
    !hasBlockedWords(`${item.title || ""} ${item.originalUrl || ""}`) &&
    !hasNonSouthLanguage(`${item.title || ""} ${item.originalUrl || ""}`)
  );

  if (!finalTrailers.length && previous.length) {
    finalTrailers = previous;
  }

  feed.trailers = finalTrailers;
  feed.updatedAt = new Date().toISOString();

  await writeAtomic(
    FEED_FILE,
    JSON.stringify(feed, null, 2) + "\n"
  );

  const counts = {};
  for (const item of finalTrailers) {
    counts[item.language] = (counts[item.language] || 0) + 1;
  }

  console.log(`\nPublished ${finalTrailers.length} South Indian trailers.`);
  console.log(JSON.stringify(counts));
  console.log("index.html/player was NOT modified.");
}

main().catch(error => {
  console.error("Trailer updater failed:", error);
  process.exit(1);
});
