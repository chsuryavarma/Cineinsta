import fs from "node:fs/promises";

/*
=========================================================
CINEINSTA FEED UPDATER
=========================================================

Collects:
- Telugu cinema news
- Telugu trailers / teasers
- Movie interviews from YouTube RSS
- Reviews from 5 review sources

IMPORTANT:
- News keeps the original publisher URL in "url".
- Cineinsta's website creates its own reading page for news.
- Trailer records try to obtain a real YouTube video ID.
- If the source page does not expose a YouTube ID, the script
  searches YouTube for the matching trailer title and uses the
  first strong title match.
=========================================================
*/

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";

const NEWS_SOURCES = [
  {
    name: "123telugu",
    url: "https://www.123telugu.com/category/mnews/",
    domain: "123telugu.com"
  },
  {
    name: "TeluguCinema",
    url: "https://telugucinema.com/news",
    domain: "telugucinema.com"
  },
  {
    name: "Telugu360",
    url: "https://www.telugu360.com/category/movies/",
    domain: "telugu360.com"
  },
  {
    name: "Gulte",
    url: "https://www.gulte.com/movienews",
    domain: "gulte.com"
  },
  {
    name: "GreatAndhra",
    url: "https://www.greatandhra.com/movies/news",
    domain: "greatandhra.com"
  },
  {
    name: "CineJosh",
    url: "https://www.cinejosh.com/news",
    domain: "cinejosh.com"
  },
  {
    name: "IndiaGlitz Telugu",
    url: "https://indiaglitz.com/telugu/movie-news",
    domain: "indiaglitz.com"
  }
];

const TRAILER_SOURCES = [
  {
    name: "ETimes Telugu",
    url: "https://timesofindia.indiatimes.com/entertainment/telugu/movies",
    domain: "timesofindia.indiatimes.com"
  },
  {
    name: "IndiaGlitz Telugu",
    url: "https://indiaglitz.com/telugu",
    domain: "indiaglitz.com"
  }
];

const REVIEW_SOURCES = [
  {
    name: "GreatAndhra",
    archive: "https://www.greatandhra.com/movies/reviews/",
    domain: "greatandhra.com"
  },
  {
    name: "Gulte",
    archive: "https://www.gulte.com/moviereviews",
    domain: "gulte.com"
  },
  {
    name: "M9.news",
    archive: "https://www.m9.news/reviews/",
    domain: "m9.news"
  },
  {
    name: "Telugu360",
    archive: "https://www.telugu360.com/category/movies/telugu-movies-reviews/",
    domain: "telugu360.com"
  },
  {
    name: "123telugu",
    archive: "https://www.123telugu.com/category/reviews/",
    domain: "123telugu.com"
  }
];

const REVIEW_SOURCE_NAMES = [
  "GreatAndhra",
  "Gulte",
  "M9.news",
  "Telugu360",
  "123telugu"
];

/*
  These are the interview feeds already used by Cineinsta.
  If a channel is unavailable, the script simply skips it.
*/
const INTERVIEW_SOURCES = [
  {
    name: "iDream Media",
    channelId: "UC60U1OtwT9Y6Buecc6P0L5g"
  },
  {
    name: "GreatAndhra",
    channelId: "UCoarMz-cpxAnBy8tszp35wA"
  },
  {
    name: "Telugu Filmnagar",
    channelId: "UCintIUOJEktQBfhEI9XXpuw"
  },
  {
    name: "iDream Filmnagar",
    channelId: "UCt5rjohPa7ue6n9x8qDnREA"
  }
];

const INTERVIEW_TERMS = [
  "interview",
  "exclusive interview",
  "special interview",
  "unfiltered interview",
  "exclusive conversation",
  "special conversation",
  "conversation with",
  "in conversation",
  "conversation",
  "exclusive chat",
  "special chat",
  "chat with",
  "q&a",
  "media q&a",
  "media interaction",
  "special interaction",
  "exclusive interaction",
  "interaction with media",
  "interacts with media",
  "media meet",
  "press meet",
  "press interaction",
  "talking movies",
  "movie talk",
  "talks about",
  "talks on",
  "talks",
  "opens up",
  "speaks about",
  "speaks on",
  "discusses",
  "shares about",
  "reveals about",
  "reveals"
];

const INTERVIEW_CINEMA_TERMS = [
  "movie",
  "movies",
  "film",
  "films",
  "cinema",
  "tollywood",
  "telugu cinema",
  "telugu movie",
  "telugu film",
  "actor",
  "actress",
  "hero",
  "heroine",
  "director",
  "producer",
  "star",
  "filmmaker",
  "technician",
  "music director",
  "composer",
  "lyricist",
  "movie team",
  "film team",
  "pre-release",
  "release",
  "ott",
  "trailer",
  "teaser",
  "song",
  "songs",
  "film industry",
  "cinema industry"
];

const INTERVIEW_BLOCKED_TERMS = [
  "politics",
  "political",
  "election",
  "mla",
  "mp",
  "crime",
  "police",
  "ias",
  "ips",
  "stock market",
  "health",
  "doctor",
  "spiritual",
  "astrology",
  "sports",
  "cricket"
];

function decodeEntities(text = "") {
  return text
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
      try {
        return String.fromCharCode(Number(n));
      } catch {
        return "";
      }
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

function absoluteUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return "";
  }
}

async function fetchHTML(url) {
  try {
    const requestUrl = url.includes("m9.news")
      ? `https://r.jina.ai/${url}`
      : url;

    const response = await fetch(requestUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
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

function extractMeta(html, property) {
  const patterns = [
    new RegExp(
      `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`,
      "i"
    )
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeEntities(match[1]).trim();
    }
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
  return (
    extractMeta(html, "og:image") ||
    extractMeta(html, "twitter:image") ||
    ""
  );
}

function extractDate(html) {
  const candidates = [
    extractMeta(html, "article:published_time"),
    extractMeta(html, "datePublished"),
    extractMeta(html, "publish_date"),
    extractMeta(html, "date")
  ];

  for (const value of candidates) {
    if (value && !Number.isNaN(new Date(value).getTime())) {
      return new Date(value).toISOString();
    }
  }

  const text = stripHTML(html);
  const match = text.match(
    /\b(?:Sep|September|Aug|August|Jul|July|Oct|October|Nov|November|Dec|December|Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June)\s+\d{1,2},\s+\d{4}\b/i
  );

  if (match) {
    const date = new Date(match[0]);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return null;
}

function extractLinks(html, baseUrl) {
  const links = [];
  const htmlRegex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = htmlRegex.exec(html))) {
    const url = absoluteUrl(match[1], baseUrl);
    const text = stripHTML(match[2]);

    if (url && text) {
      links.push({ url, text });
    }
  }

  return uniqueLinks(links);
}

function uniqueLinks(links) {
  const map = new Map();

  for (const link of links) {
    if (!map.has(link.url)) map.set(link.url, link);
  }

  return [...map.values()];
}

function isBadTitle(title = "") {
  const value = title.trim().toLowerCase();

  const bad = [
    "home",
    "menu",
    "read more",
    "view all",
    "more",
    "latest news",
    "movie news",
    "news",
    "movie reviews",
    "reviews",
    "photos",
    "gallery",
    "videos",
    "video",
    "advertisement",
    "subscribe"
  ];

  return bad.includes(value) || value.length < 10;
}

function isNewsLink(source, link) {
  const url = link.url.toLowerCase();
  const text = link.text.trim();

  if (!url.includes(source.domain)) return false;
  if (isBadTitle(text)) return false;
  if (text.length < 15 || text.length > 220) return false;

  const blocked = [
    "/category/",
    "/tag/",
    "/author/",
    "/page/",
    "/search",
    "/contact",
    "/about",
    "/privacy",
    "/terms"
  ];

  if (blocked.some(part => url.includes(part))) return false;

  const newsWords = [
    "movie",
    "film",
    "hero",
    "actress",
    "actor",
    "director",
    "trailer",
    "teaser",
    "song",
    "release",
    "ott",
    "box office",
    "shooting",
    "first look",
    "poster",
    "glimpse",
    "update",
    "nani",
    "prabhas",
    "allu",
    "mahesh",
    "ntr",
    "ram charan",
    "vijay",
    "rashmika",
    "samantha",
    "chiranjeevi",
    "pawan kalyan",
    "deverakonda"
  ];

  const combined = `${text} ${url}`.toLowerCase();
  return newsWords.some(word => combined.includes(word));
}

function makeSummary(text, title) {
  let clean = text.replace(/\s+/g, " ").trim();

  if (clean.toLowerCase().startsWith(title.toLowerCase())) {
    clean = clean.slice(title.length).trim();
  }

  if (clean.length < 60) {
    return `Latest Telugu cinema update: ${title}.`;
  }

  const sentence = clean.match(/^(.{60,260}?[.!?])\s/);
  let summary = sentence ? sentence[1] : clean.slice(0, 220);

  if (summary.length >= 220) {
    summary = summary.replace(/\s+\S*$/, "...");
  }

  return summary;
}

async function readNewsArticle(source, candidate) {
  const html = await fetchHTML(candidate.url);
  if (!html) return null;

  const title = extractHeadline(html, candidate.text);

  if (!title || isBadTitle(title)) return null;

  return {
    id: candidate.url,
    title,
    summary: makeSummary(stripHTML(html), title),
    source: source.name,
    url: candidate.url,
    img: extractImage(html),
    publishedAt: extractDate(html),
    language: "Telugu",
    category: "Telugu Cinema"
  };
}

function normalizeTitle(title = "") {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u0C00-\u0C7F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarity(a, b) {
  const aa = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const bb = new Set(normalizeTitle(b).split(" ").filter(Boolean));

  if (!aa.size || !bb.size) return 0;

  let common = 0;

  for (const word of aa) {
    if (bb.has(word)) common++;
  }

  return common / Math.max(aa.size, bb.size);
}

function dedupeNews(items) {
  const output = [];

  for (const item of items) {
    const duplicate = output.some(existing => {
      if (existing.url === item.url) return true;
      return similarity(existing.title, item.title) >= 0.72;
    });

    if (!duplicate) output.push(item);
  }

  return output;
}

async function collectNews() {
  const all = [];

  console.log("");
  console.log("======================================");
  console.log("TELUGU NEWS");
  console.log("======================================");

  for (const source of NEWS_SOURCES) {
    console.log(`Loading ${source.name}: ${source.url}`);

    const html = await fetchHTML(source.url);
    if (!html) continue;

    const candidates = extractLinks(html, source.url)
      .filter(link => isNewsLink(source, link))
      .slice(0, 10);

    console.log(`${source.name}: ${candidates.length} candidates`);

    for (const candidate of candidates) {
      const article = await readNewsArticle(source, candidate);

      if (article) {
        console.log(`${source.name} | ${article.title}`);
        all.push(article);
      }
    }
  }

  return dedupeNews(all)
    .sort((a, b) => {
      const ad = a.publishedAt
        ? new Date(a.publishedAt).getTime()
        : 0;

      const bd = b.publishedAt
        ? new Date(b.publishedAt).getTime()
        : 0;

      return bd - ad;
    })
    .slice(0, 30);
}

/* =========================================================
   TRAILERS
========================================================= */

function isTrailerLink(link) {
  const text = link.text.toLowerCase();
  const url = link.url.toLowerCase();

  if (text.length < 8) return false;

  const keywords = [
    "official trailer",
    "trailer",
    "official teaser",
    "teaser",
    "glimpse"
  ];

  return keywords.some(
    keyword =>
      text.includes(keyword) ||
      url.includes(keyword.replace(/\s+/g, "-"))
  );
}

function extractYouTubeId(text = "") {
  const patterns = [
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/i,
    /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/i,
    /youtube\.com\/watch\?[^"'&\s]*v=([A-Za-z0-9_-]{11})/i,
    /youtu\.be\/([A-Za-z0-9_-]{11})/i,
    /youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  return "";
}

function youtubeTitleSimilarity(a, b) {
  const stop = new Set([
    "official",
    "trailer",
    "teaser",
    "telugu",
    "movie",
    "film",
    "the",
    "a",
    "an",
    "of",
    "and",
    "song",
    "video"
  ]);

  const tokens = value =>
    new Set(
      normalizeTitle(value)
        .split(" ")
        .filter(Boolean)
        .filter(word => !stop.has(word))
    );

  const aa = tokens(a);
  const bb = tokens(b);

  if (!aa.size || !bb.size) return 0;

  let common = 0;
  for (const word of aa) {
    if (bb.has(word)) common++;
  }

  return common / Math.max(aa.size, bb.size);
}

/*
  YouTube does not provide a public RSS search feed.
  We use the public search page only to discover the video ID.
  The actual player later uses the normal YouTube embed URL.
*/
async function searchYouTubeVideo(title) {
  try {
    const query = `${title} Telugu official trailer`;
    const url =
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    const html = await fetchHTML(url);

    if (!html) return null;

    const ids = [];
    const idRegex = /"videoId":"([A-Za-z0-9_-]{11})"/g;

    let match;
    while ((match = idRegex.exec(html))) {
      if (!ids.includes(match[1])) ids.push(match[1]);
      if (ids.length >= 12) break;
    }

    if (!ids.length) return null;

    let best = null;
    let bestScore = 0;

    for (const id of ids) {
      const pos = html.indexOf(`"videoId":"${id}"`);
      const context = html.slice(
        Math.max(0, pos - 1000),
        Math.min(html.length, pos + 3000)
      );

      const titleMatches = [
        ...context.matchAll(/"title":\{"runs":\[\{"text":"([^"]+)"/g)
      ];

      const candidateTitle =
        titleMatches[0]?.[1] || title;

      const score = youtubeTitleSimilarity(title, candidateTitle);

      if (score > bestScore) {
        bestScore = score;
        best = {
          youtubeId: id,
          title: candidateTitle
        };
      }
    }

    if (best && bestScore >= 0.35) {
      return best.youtubeId;
    }

    /*
      If YouTube returned results but title parsing was incomplete,
      use the first video result as a fallback.
    */
    return ids[0] || null;
  } catch (error) {
    console.log(`YouTube search failed for: ${title}`);
    console.log(error.message);
    return null;
  }
}

async function readTrailer(source, candidate) {
  const html = await fetchHTML(candidate.url);
  if (!html) return null;

  const title = extractHeadline(html, candidate.text);

  if (
    !title ||
    !isTrailerLink({
      text: title,
      url: candidate.url
    })
  ) {
    return null;
  }

  const combined = `${title} ${stripHTML(html)}`.toLowerCase();

  const trailerWords = [
    "telugu",
    "tollywood",
    "telugu movie",
    "telugu film"
  ];

  const appearsTelugu = trailerWords.some(word =>
    combined.includes(word)
  );

  if (source.name !== "IndiaGlitz Telugu" && !appearsTelugu) {
    return null;
  }

  let youtubeId = extractYouTubeId(html);

  /*
    The old collector frequently produced youtubeId="" because
    the ETimes page contains a poster but not a normal YouTube
    embed. Try YouTube search when that happens.
  */
  if (!youtubeId) {
    console.log(`Finding YouTube video for: ${title}`);
    youtubeId = await searchYouTubeVideo(title);
  }

  const image = extractImage(html);

  return {
    id: candidate.url,
    title,
    source: source.name,
    url: youtubeId
      ? `https://www.youtube.com/watch?v=${youtubeId}`
      : candidate.url,
    originalUrl: candidate.url,
    img: youtubeId
      ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
      : image,
    youtubeId: youtubeId || "",
    publishedAt: extractDate(html),
    language: "Telugu"
  };
}

function dedupeTrailers(items) {
  const output = [];

  for (const item of items) {
    const duplicate = output.some(existing => {
      if (
        existing.youtubeId &&
        item.youtubeId &&
        existing.youtubeId === item.youtubeId
      ) {
        return true;
      }

      if (existing.originalUrl === item.originalUrl) {
        return true;
      }

      return similarity(existing.title, item.title) >= 0.75;
    });

    if (!duplicate) output.push(item);
  }

  return output;
}

async function collectTrailers() {
  const all = [];

  console.log("");
  console.log("======================================");
  console.log("TELUGU TRAILERS");
  console.log("======================================");

  for (const source of TRAILER_SOURCES) {
    console.log(`Loading ${source.name}: ${source.url}`);

    const html = await fetchHTML(source.url);
    if (!html) continue;

    const candidates = extractLinks(html, source.url)
      .filter(isTrailerLink)
      .slice(0, 15);

    console.log(
      `${source.name}: ${candidates.length} trailer candidates`
    );

    for (const candidate of candidates) {
      const trailer = await readTrailer(source, candidate);

      if (trailer) {
        console.log(
          `${source.name} | ${trailer.title} | YouTube: ${trailer.youtubeId || "not found"}`
        );

        all.push(trailer);
      }
    }
  }

  return dedupeTrailers(all)
    .sort((a, b) => {
      const ad = a.publishedAt
        ? new Date(a.publishedAt).getTime()
        : 0;

      const bd = b.publishedAt
        ? new Date(b.publishedAt).getTime()
        : 0;

      return bd - ad;
    })
    .slice(0, 12);
}

/* =========================================================
   INTERVIEWS
========================================================= */

function xmlTag(xml = "", tag = "") {
  if (!xml || !tag) return "";

  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  if (tag === "link") {
    const linkMatch = xml.match(
      /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i
    );

    if (linkMatch?.[1]) {
      return decodeEntities(linkMatch[1]);
    }
  }

  const match = xml.match(
    new RegExp(
      `<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`,
      "i"
    )
  );

  if (!match?.[1]) return "";

  return decodeEntities(
    stripHTML(
      match[1]
        .replace(/^<!\[CDATA\[/i, "")
        .replace(/\]\]>$/i, "")
        .trim()
    )
  ).trim();
}

function isMovieInterview(title, description = "", sourceName = "") {
  const combined = `${title} ${description}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ");

  const source = sourceName.toLowerCase();

  if (
    INTERVIEW_BLOCKED_TERMS.some(term =>
      combined.includes(term)
    )
  ) {
    return false;
  }

  const hasInterviewTerm = INTERVIEW_TERMS.some(term =>
    combined.includes(term)
  );

  if (!hasInterviewTerm) return false;

  const hasCinemaTerm = INTERVIEW_CINEMA_TERMS.some(term =>
    combined.includes(term)
  );

  if (
    hasCinemaTerm ||
    source.includes("idream") ||
    source.includes("greatandhra") ||
    source.includes("filmnagar")
  ) {
    return true;
  }

  return false;
}

async function searchYouTubeInterviews(query, sourceLabel) {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const html = await fetchHTML(url);
    if (!html) return [];

    const results = [];
    const rendererRegex = /"videoRenderer":\{([\s\S]*?)\}\s*,\s*"/g;
    let match;

    while ((match = rendererRegex.exec(html))) {
      const block = match[1];
      const idMatch = block.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
      if (!idMatch) continue;

      const titleMatch = block.match(/"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"/);
      const title = titleMatch?.[1]
        ? decodeEntities(titleMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'))
        : "";

      const descriptionMatch = block.match(/"detailedMetadataSnippets":\[\{"snippetText":\{"runs":\[([\s\S]*?)\]\}/);
      const description = descriptionMatch?.[1]
        ? decodeEntities(descriptionMatch[1].replace(/.*?"text":"/g, "").replace(/".*$/g, "").replace(/\\"/g, '"'))
        : "";

      if (!title || !isMovieInterview(title, description, sourceLabel)) continue;

      const publishedMatch = block.match(/"publishedTimeText":\{"simpleText":"([^"]+)"/);

      results.push({
        id: idMatch[1],
        youtubeId: idMatch[1],
        title,
        source: sourceLabel,
        url: `https://www.youtube.com/watch?v=${idMatch[1]}`,
        img: `https://i.ytimg.com/vi/${idMatch[1]}/hqdefault.jpg`,
        publishedAt: publishedMatch?.[1] || null,
        language: "Telugu",
        category: "Movie Interviews"
      });

      if (results.length >= 8) break;
    }

    return results;
  } catch (error) {
    console.log(`YouTube interview search failed: ${query}`);
    console.log(error.message);
    return [];
  }
}

async function collectInterviews() {
  const all = [];

  console.log("");
  console.log("======================================");
  console.log("TELUGU MOVIE INTERVIEWS");
  console.log("======================================");

  for (const source of INTERVIEW_SOURCES) {
    const rssUrl =
      `https://www.youtube.com/feeds/videos.xml?channel_id=${source.channelId}`;

    console.log(`Loading interview source: ${source.name}`);

    const xml = await fetchHTML(rssUrl);

    if (!xml) {
      console.log(`Interview source failed: ${source.name}`);
      continue;
    }

    const entries =
      xml.match(/<entry>[\s\S]*?<\/entry>/gi) || [];

    console.log(
      `${source.name}: ${entries.length} YouTube entries found`
    );

    for (const entry of entries) {
      const videoId =
        xmlTag(entry, "yt:videoId") ||
        extractYouTubeId(xmlTag(entry, "link"));

      const title = xmlTag(entry, "title");
      const description = xmlTag(entry, "media:description");
      const publishedAt =
        xmlTag(entry, "published") ||
        xmlTag(entry, "updated");

      if (
        !videoId ||
        !title ||
        !isMovieInterview(
          title,
          description,
          source.name
        )
      ) {
        continue;
      }

      all.push({
        id: videoId,
        youtubeId: videoId,
        title,
        source: source.name,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        img: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        publishedAt:
          publishedAt &&
          !Number.isNaN(new Date(publishedAt).getTime())
            ? new Date(publishedAt).toISOString()
            : null,
        language: "Telugu",
        category: "Movie Interviews"
      });
    }
  }

  if (!all.length) {
    console.log("No channel RSS interviews found. Searching YouTube directly for current celebrity/movie interviews...");
  }

  const interviewQueries = [
    "Telugu celebrity interview movie",
    "Telugu actor interview latest movie",
    "Telugu actress interview latest movie",
    "Telugu director interview latest film",
    "Telugu movie team interview"
  ];

  for (const query of interviewQueries) {
    const found = await searchYouTubeInterviews(query, "YouTube Cinema Interviews");
    console.log(`${query}: ${found.length} interview candidates`);
    all.push(...found);
  }

  const seen = new Set();

  return all
    .filter(item => {
      if (seen.has(item.youtubeId)) return false;
      seen.add(item.youtubeId);
      return true;
    })
    .sort((a, b) => {
      const ad = a.publishedAt
        ? new Date(a.publishedAt).getTime()
        : 0;

      const bd = b.publishedAt
        ? new Date(b.publishedAt).getTime()
        : 0;

      return bd - ad;
    })
    .slice(0, 20);
}

/* =========================================================
   REVIEWS
========================================================= */

function extractReleaseDate(text) {
  const clean = text.replace(/\s+/g, " ");

  const patterns = [
    /Release\s*Date\s*:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i,
    /Release\s*Date\s*:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
    /Streaming\s*Date\s*:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i,
    /Streaming\s*Date\s*:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
    /Release\s*Date\s*[-–—]\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i,
    /Streaming\s*Date\s*[-–—]\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);

    if (match?.[1]) {
      const date = new Date(match[1]);

      if (!Number.isNaN(date.getTime())) {
        return date.toISOString().slice(0, 10);
      }
    }
  }

  return null;
}

function cleanTitle(title = "") {
  let t = decodeEntities(title)
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^['"“”‘’]+/, "")
    .replace(/['"“”‘’]+$/, "")
    .trim();

  t = t.replace(/^movie\s*name\s*:\s*/i, "");
  t = t.replace(
    /\s+(?:release|streaming)\s+date\s*:.*$/i,
    ""
  );
  t = t.replace(
    /\s+123telugu\.com\s+rating\s*:.*$/i,
    ""
  );

  t = t
    .replace(/^review\s*:\s*/i, "")
    .replace(/^movie\s+review\s*:\s*/i, "")
    .replace(/^telugu\s+movie\s+review\s*:\s*/i, "")
    .replace(/^ott\s+review\s*:\s*/i, "");

  t = t.replace(
    /\s+(?:movie\s+)?review\s*[:\-–—].*$/i,
    ""
  );

  t = t
    .replace(/\s+movie\s+review\s*$/i, "")
    .replace(/\s+review\s*$/i, "");

  const lower = t.toLowerCase();

  const knownTitles = [
    ["the paradise", "The Paradise"],
    ["mahendragiri varahi", "Mahendragiri Varahi"],
    ["epic first semester", "Epic First Semester"],
    ["ramba oorvasi menaka", "Ramba Oorvasi Menaka"],
    ["ramba oorvashi menaka", "Ramba Oorvasi Menaka"],
    ["sardar 2", "Sardar 2"],
    ["sardaar 2", "Sardar 2"],
    ["bethlehem kudumba unit", "Bethlehem Kudumba Unit"],
    ["i'm game", "I'm Game"],
    ["im game", "I'm Game"],
    ["romanchakam", "Romanchakam"],
    ["irumudi", "Irumudi"],
    ["pallaburusu", "Pallaburusu"],
    ["toxic", "Toxic"]
  ];

  for (const [needle, result] of knownTitles) {
    if (lower.includes(needle)) return result;
  }

  return t;
}

function extractMovieTitle(source, html, candidateText, pageText) {
  if (source.name === "123telugu") {
    const match = pageText.match(
      /Movie\s*Name\s*:\s*(.+?)(?:\s+(?:Release|Streaming)\s+Date\s*:|\s+123telugu\.com\s+Rating\s*:)/i
    );

    if (match?.[1]) return cleanTitle(match[1]);
  }

  if (source.name === "GreatAndhra") {
    const match = pageText.match(
      /Movie\s*:\s*(.+?)\s+Rating\s*:/i
    );

    if (match?.[1]) return cleanTitle(match[1]);
  }

  return cleanTitle(
    extractHeadline(html, candidateText)
  );
}

function extractRating(text, source) {
  const clean = text.replace(/\s+/g, " ");

  const patterns = {
    GreatAndhra: [
      /Movie\s*:\s*.*?Rating\s*:\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /Rating\s*:\s*(\d+(?:\.\d+)?)\s*\/\s*5/i
    ],
    Gulte: [
      /Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /(?:^|\s)(\d+(?:\.\d+)?)\s*\/\s*5/i
    ],
    "M9.news": [
      /(?:OUR\s+)?RATING\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /M9\s*Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i
    ],
    Telugu360: [
      /Telugu360\s*Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i
    ],
    "123telugu": [
      /123telugu(?:\.com)?\s*Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i
    ]
  };

  for (const pattern of patterns[source] || []) {
    const match = clean.match(pattern);

    if (!match) continue;

    const rating = Number(match[1]);

    if (
      Number.isFinite(rating) &&
      rating >= 0 &&
      rating <= 5
    ) {
      return rating;
    }
  }

  return null;
}

function isReviewLink(source, link) {
  const url = link.url.toLowerCase();
  const text = link.text.toLowerCase();

  if (!url.includes(source.domain)) return false;
  if (isBadTitle(link.text)) return false;
  if (link.text.length < 4 || link.text.length > 250) return false;

  if (source.name === "GreatAndhra") {
    return (
      url.includes("/movies/reviews/") &&
      url !== source.archive
    );
  }

  if (source.name === "Gulte") {
    return url.includes("/moviereviews/");
  }

  if (source.name === "M9.news") {
    return (
      url.includes("m9.news/reviews/") &&
      url !== source.archive
    );
  }

  if (source.name === "Telugu360") {
    return (
      url.includes("-movie-review") ||
      url.includes("-review/")
    );
  }

  if (source.name === "123telugu") {
    return (
      url.includes("123telugu.com/reviews/") ||
      (
        url.includes("123telugu.com/telugu/") &&
        text.includes("review")
      )
    );
  }

  return false;
}

async function getReviewCandidates(source) {
  console.log(`Loading ${source.name}: ${source.archive}`);

  const html = await fetchHTML(source.archive);
  if (!html) return [];

  const candidates = uniqueLinks(
    extractLinks(html, source.archive).filter(link =>
      isReviewLink(source, link)
    )
  );

  console.log(
    `${source.name}: found ${candidates.length} review links`
  );

  return candidates.slice(0, 20);
}

async function readReview(source, candidate) {
  const html = await fetchHTML(candidate.url);
  if (!html) return null;

  const pageText = stripHTML(html);

  const movie = extractMovieTitle(
    source,
    html,
    candidate.text,
    pageText
  );

  const lowerMovie = (movie || "").trim().toLowerCase();

  if (
    !movie ||
    movie.length < 2 ||
    movie.length > 100 ||
    [
      "movie reviews",
      "reviews",
      "review",
      "movie review",
      "latest reviews",
      "review archives"
    ].includes(lowerMovie)
  ) {
    return null;
  }

  const rating = extractRating(
    pageText,
    source.name
  );

  const releaseDate = extractReleaseDate(pageText);

  return {
    source: source.name,
    movie,
    releaseDate,
    rating,
    ratingText:
      rating === null
        ? "Not available"
        : `${rating}/5`,
    url: candidate.url,
    image: extractImage(html)
  };
}

function titleTokens(title) {
  return new Set(
    cleanTitle(title)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .filter(word =>
        ![
          "movie",
          "review",
          "rating",
          "film",
          "telugu",
          "ott",
          "the"
        ].includes(word)
      )
  );
}

function titlesMatch(a, b) {
  const aa = titleTokens(a);
  const bb = titleTokens(b);

  if (!aa.size || !bb.size) return false;

  if (
    aa.size === bb.size &&
    [...aa].every(token => bb.has(token))
  ) {
    return true;
  }

  const smaller = aa.size <= bb.size ? aa : bb;
  const larger = aa.size <= bb.size ? bb : aa;

  if (
    smaller.size >= 1 &&
    [...smaller].every(token => larger.has(token))
  ) {
    return true;
  }

  let common = 0;

  for (const token of aa) {
    if (bb.has(token)) common++;
  }

  return (
    common / Math.max(aa.size, bb.size)
  ) >= 0.7;
}

function groupReviews(reviews) {
  const groups = [];

  for (const review of reviews) {
    let group = groups.find(item =>
      titlesMatch(item.movie, review.movie)
    );

    if (!group) {
      group = {
        movie: review.movie,
        releaseDate: review.releaseDate || null,
        image: review.image || "",
        reviews: []
      };

      groups.push(group);
    } else if (
      review.releaseDate &&
      (
        !group.releaseDate ||
        review.releaseDate > group.releaseDate
      )
    ) {
      group.releaseDate = review.releaseDate;
    }

    const existing = group.reviews.find(
      item => item.source === review.source
    );

    if (existing) continue;

    group.reviews.push(review);

    if (!group.image && review.image) {
      group.image = review.image;
    }
  }

  return groups;
}

function calculateAverage(reviews) {
  const ratings = reviews
    .map(item => item.rating)
    .filter(
      value =>
        typeof value === "number" &&
        Number.isFinite(value)
    );

  if (!ratings.length) return null;

  const average =
    ratings.reduce(
      (sum, value) => sum + value,
      0
    ) / ratings.length;

  return Math.round(average * 100) / 100;
}

function buildReviews(groups) {
  return groups
    .map(group => {
      const average = calculateAverage(
        group.reviews
      );

      const sources =
        REVIEW_SOURCE_NAMES.map(name => {
          const found = group.reviews.find(
            review => review.source === name
          );

          if (!found) {
            return {
              source: name,
              rating: null,
              ratingText: "Not available",
              url: ""
            };
          }

          return {
            source: name,
            rating: found.rating,
            ratingText: found.ratingText,
            url: found.url
          };
        });

      return {
        t: group.movie,
        l: "Telugu",
        releaseDate: group.releaseDate || null,
        rating:
          average === null
            ? "Not available"
            : `${average}/5`,
        img: group.image || "",
        source:
          "GreatAndhra • Gulte • M9.news • Telugu360 • 123telugu",
        u: group.reviews[0]?.url || "",
        aggregator: {
          average,
          sources
        }
      };
    })
    .sort((a, b) => {
      const ad = a.releaseDate
        ? new Date(a.releaseDate).getTime()
        : 0;

      const bd = b.releaseDate
        ? new Date(b.releaseDate).getTime()
        : 0;

      return bd - ad;
    });
}

/* =========================================================
   MAIN
========================================================= */

async function main() {
  console.log("");
  console.log("======================================");
  console.log("CINEINSTA FEED UPDATE");
  console.log("======================================");

  const news = await collectNews();

  console.log("");
  console.log(`Final Telugu news: ${news.length}`);

  const trailers = await collectTrailers();

  console.log("");
  console.log(
    `Final Telugu trailers: ${trailers.length}`
  );

  const interviews = await collectInterviews();

  console.log("");
  console.log(
    `Final Telugu movie interviews: ${interviews.length}`
  );

  const allReviews = [];

  console.log("");
  console.log("======================================");
  console.log("TELUGU REVIEWS");
  console.log("======================================");

  for (const source of REVIEW_SOURCES) {
    console.log("");
    console.log(`========== ${source.name} ==========`);

    const candidates =
      await getReviewCandidates(source);

    for (const candidate of candidates) {
      const review =
        await readReview(
          source,
          candidate
        );

      if (!review) continue;

      console.log(
        `${source.name} | ${review.movie} | ${review.releaseDate || "No release date"} | ${review.ratingText}`
      );

      allReviews.push(review);
    }
  }

  console.log("");
  console.log(
    `Raw reviews collected: ${allReviews.length}`
  );

  const groups = groupReviews(allReviews);

  console.log(
    `Movies after grouping: ${groups.length}`
  );

  const reviews = buildReviews(groups);

  const feed = {
    updatedAt: new Date().toISOString(),
    language: "Telugu",
    news,
    trailers,
    interviews,
    reviews
  };

  await fs.mkdir("data", {
    recursive: true
  });

  await fs.writeFile(
    "data/feed.json",
    JSON.stringify(feed, null, 2),
    "utf8"
  );

  console.log("");
  console.log("======================================");
  console.log("FEED COMPLETE");
  console.log("======================================");
  console.log(`News: ${news.length}`);
  console.log(`Trailers: ${trailers.length}`);
  console.log(`Interviews: ${interviews.length}`);
  console.log(`Reviews: ${reviews.length}`);
  console.log("feed.json updated successfully.");
}

main().catch(error => {
  console.error("");
  console.error(
    "Cineinsta feed updater failed:"
  );
  console.error(error);
  process.exit(1);
});
