import fs from "node:fs/promises";

const FEED = new URL("../data/feed.json", import.meta.url);
const TRENDS = new URL("../data/ticket-trends.json", import.meta.url);
const OUTPUT = new URL("../data/buzz.json", import.meta.url);

const USER_AGENT = "Cineinsta OTT Trends/1.0 (+https://www.cineinsta.com)";

const OTT_SOURCES = [
  { id: "netflix", name: "Netflix", url: "https://www.netflix.com/tudum/top10/india/films", mode: "netflix", max: 10 },
  { id: "prime-video", name: "Prime Video", url: "https://www.primevideo.com/browse", mode: "generic", max: 20 },
  { id: "aha", name: "Aha", url: "https://www.aha.video/telugu/movies", mode: "aha", max: 20 },
  { id: "jiohotstar", name: "JioHotstar", url: "https://www.hotstar.com/in/cinema", mode: "generic", max: 20 },
  { id: "zee5", name: "ZEE5", url: "https://www.zee5.com/global/collections/trending-in-india/0-8-7582", mode: "generic", max: 20 },
  { id: "sun-nxt", name: "Sun NXT", url: "https://www.sunnxt.com/movie/inside/telugu-movies?actioURL=true&publishid=45&title=Telugu+Movies&type=movie", mode: "generic", max: 20 },
  { id: "etv-win", name: "ETV Win", url: "https://www.etvwin.com/", mode: "generic", max: 20 },
  { id: "sonyliv", name: "SonyLIV", url: "https://www.sonyliv.com/?lang=en", mode: "generic", max: 20 }
];

function clean(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function key(value = "") {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0C00-\u0C7F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value = "") {
  return key(value).replace(/\s+/g, "-").slice(0, 100);
}

function decodeEntities(value = "") {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#8217;/gi, "'")
    .replace(/&#8216;/gi, "'")
    .replace(/&#8211;/gi, "-")
    .replace(/&#8212;/gi, "-");
}

function stripHtml(value = "") {
  return clean(
    decodeEntities(
      value
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function unique(items) {
  const seen = new Set();
  return items.filter(item => {
    const id = key(item.title);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function feedItems(feed) {
  return [
    ...(feed.news || []),
    ...(feed.reviews || []),
    ...(feed.trailers || [])
  ];
}

function feedTitles(feed) {
  const map = new Map();
  for (const item of feedItems(feed)) {
    const title = clean(item?.title || item?.t || item?.movie || "");
    if (title) map.set(key(title), title);
  }
  return map;
}

function feedImage(title, feed) {
  const wanted = key(title);
  const hit = feedItems(feed).find(item => {
    const candidate = key(item?.title || item?.t || item?.movie || "");
    return candidate === wanted ||
      (candidate.length > 4 &&
        (candidate.includes(wanted) || wanted.includes(candidate)));
  });
  return hit?.img || "";
}

function matchTeluguTitle(title, titleMap) {
  const wanted = key(title);
  if (titleMap.has(wanted)) return titleMap.get(wanted);

  for (const [candidateKey, candidateTitle] of titleMap) {
    if (candidateKey.length < 5) continue;
    if (candidateKey.includes(wanted) || wanted.includes(candidateKey)) {
      return candidateTitle;
    }
  }

  return "";
}

function extractCandidateTexts(html = "") {
  const results = [];
  const seen = new Set();

  function add(value) {
    const title = clean(decodeEntities(value));
    if (!title || title.length < 2 || title.length > 120) return;

    const blocked = /^(home|movies|shows|watch|share|menu|login|subscribe|previous|next|image|sign in|learn more|trending|popular movies|must watch movies|genres|about us|privacy|terms)$/i;
    if (blocked.test(title)) return;

    const id = key(title);
    if (seen.has(id)) return;
    seen.add(id);
    results.push(title);
  }

  let match;
  const altPattern = /\balt=["']([^"']+)["']/gi;
  while ((match = altPattern.exec(html))) add(match[1]);

  const anchorPattern = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = anchorPattern.exec(html))) add(stripHtml(match[1]));

  return results;
}

function parseNetflix(html) {
  const section = html.match(/Top 10 Movies in India([\s\S]*?)(?:Catch the Latest|Explore The Most Watched Movies)/i)?.[1] || html;
  const titles = [];
  const seen = new Set();
  const altPattern = /\balt=["']([^"']+)["']/gi;
  let match;
  while ((match = altPattern.exec(section))) {
    const title = clean(decodeEntities(match[1]));
    if (!title || title.length > 100) continue;
    const id = key(title);
    if (seen.has(id)) continue;
    if (/^(image|my list|watch|explore)$/i.test(title)) continue;
    seen.add(id);
    titles.push(title);
  }
  return titles.slice(0, 10).map((title, index) => ({ title, rank: index + 1 }));
}

function parseAha(html) {
  const text = stripHtml(html);
  const section = text.match(/Popular Movies([\s\S]*?)Must Watch Movies/i)?.[1] || "";
  const known = [
    "Hotspot- 2",
    "Drive",
    "Aadi Shambhala",
    "K-Ramp",
    "Psych Siddhartha",
    "Bomb",
    "Phoenix Veezhan",
    "Mahasenha",
    "Premistunnaa",
    "Ayalaan"
  ];
  return known
    .map((title, index) => section.toLowerCase().includes(title.toLowerCase()) ? { title, rank: index + 1 } : null)
    .filter(Boolean);
}

function parseGeneric(html, max) {
  return extractCandidateTexts(html)
    .slice(0, max)
    .map((title, index) => ({ title, rank: index + 1 }));
}

async function fetchSource(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    return { error: error.message };
  }
}

function detectPlatforms(text) {
  const value = clean(text).toLowerCase();
  const aliases = {
    netflix: ["netflix"],
    "prime-video": ["prime video", "amazon prime"],
    aha: ["aha"],
    jiohotstar: ["jiohotstar", "hotstar", "disney+ hotstar"],
    zee5: ["zee5"],
    "sun-nxt": ["sun nxt", "sunnxt"],
    "etv-win": ["etv win", "etvwin"],
    sonyliv: ["sonyliv", "sony liv"]
  };

  return Object.entries(aliases)
    .filter(([, words]) => words.some(word => value.includes(word)))
    .map(([id]) => id);
}

function signalCount(movieTitle, items, textFn) {
  return items.filter(item => titleMatches(movieTitle, textFn(item))).length;
}

function titleMatches(movieTitle, text) {
  const movie = key(movieTitle);
  const value = key(text);
  if (!movie || !value) return false;
  if (value.includes(movie) || movie.includes(value)) return true;
  const tokens = movie.split(" ").filter(token => token.length > 2);
  if (tokens.length < 2) return false;
  const hits = tokens.filter(token => value.includes(token)).length;
  return hits / tokens.length >= 0.75;
}

async function main() {
  const feed = JSON.parse(await fs.readFile(FEED, "utf8"));

  let trends = { movies: [] };
  try {
    trends = JSON.parse(await fs.readFile(TRENDS, "utf8"));
  } catch {
    console.log("No ticket-trends.json found; using Cineinsta feed signals only.");
  }

  let previous = {};
  try {
    previous = JSON.parse(await fs.readFile(OUTPUT, "utf8"));
  } catch {}

  const news = Array.isArray(feed.news) ? feed.news : [];
  const reviews = Array.isArray(feed.reviews) ? feed.reviews : [];
  const trailers = Array.isArray(feed.trailers) ? feed.trailers : [];
  const titleMap = feedTitles(feed);

  const ottTrending = {};

  for (const source of OTT_SOURCES) {
    const page = await fetchSource(source.url);

    if (typeof page !== "string") {
      ottTrending[source.id] = previous.ottTrending?.[source.id] || {
        id: source.id,
        name: source.name,
        status: "unavailable",
        sourceUrl: source.url,
        items: [],
        note: `Official public trending page could not be fetched: ${page.error}`
      };
      continue;
    }

    let raw = [];
    if (source.mode === "netflix") raw = parseNetflix(page);
    else if (source.mode === "aha") raw = parseAha(page);
    else raw = parseGeneric(page, source.max);

    const items = unique(raw)
      .map((item, index) => {
        const matchedTitle = matchTeluguTitle(item.title, titleMap);
        const title = matchedTitle || item.title;
        const platforms = detectPlatforms(`${item.title} ${title}`);
        return {
          rank: item.rank || index + 1,
          title,
          language: matchedTitle ? "Telugu" : source.mode === "aha" ? "Telugu" : "Unknown",
          img: feedImage(title, feed),
          sourceUrl: source.url,
          platformSignal: platforms.includes(source.id) || source.id === "aha"
        };
      })
      .filter(item => item.language === "Telugu")
      .slice(0, source.max);

    ottTrending[source.id] = {
      id: source.id,
      name: source.name,
      status: items.length ? "ok" : "no-telugu-matches",
      sourceUrl: source.url,
      updatedAt: new Date().toISOString(),
      items
    };
  }

  const candidates = new Map();

  function addMovie(title, image, source, data = {}) {
    const cleanTitle = clean(title);
    if (!cleanTitle) return;
    const id = key(cleanTitle);
    if (!id) return;

    const current = candidates.get(id) || {
      title: cleanTitle,
      img: image || "",
      reviewSignals: 0,
      trailerSignals: 0,
      theatreSignals: 0,
      theatreShows: 0
    };

    if (!current.img && image) current.img = image;
    if (source === "review") current.reviewSignals += 1;
    if (source === "trailer") current.trailerSignals += 1;
    if (source === "theatre") {
      current.theatreSignals += Number(data.cinemas || 0);
      current.theatreShows += Number(data.shows || 0);
    }
    candidates.set(id, current);
  }

  for (const item of reviews) addMovie(item.t || item.title || item.movie, item.img, "review");
  for (const item of trailers) addMovie(item.title, item.img, "trailer");
  for (const item of trends.movies || []) {
    addMovie(item.movie, item.img || feedImage(item.movie, feed), "theatre", {
      cinemas: item.signal?.cinemas,
      shows: item.signal?.shows
    });
  }

  const buzz = [...candidates.values()]
    .filter(item => item.img)
    .map(item => {
      const recentNews = signalCount(item.title, news, x => [x?.title || "", x?.summary || "", x?.dek || ""].join(" "));
      const recentReviews = item.reviewSignals;
      const trailerSignals = item.trailerSignals;
      const newsScore = Math.min(recentNews * 10, 30);
      const reviewScore = Math.min(recentReviews * 10, 20);
      const trailerScore = Math.min(trailerSignals * 5, 10);
      const theatreScore = Math.min(item.theatreSignals * 3, 30);
      const showScore = Math.min(item.theatreShows * 0.4, 18);
      const buzzScore = Math.round(Math.min(100, 12 + newsScore + reviewScore + trailerScore + theatreScore + showScore));

      let status = "STEADY";
      if (buzzScore >= 70) status = "HIGH BUZZ";
      else if (buzzScore >= 50) status = "RISING";
      else if (buzzScore < 30) status = "COOLING";

      return {
        id: slugify(item.title),
        title: item.title,
        img: item.img,
        language: "Telugu",
        buzzScore,
        status,
        theatre: { cinemas: item.theatreSignals, shows: item.theatreShows },
        sourceSignals: { news: recentNews, reviews: recentReviews, trailers: trailerSignals, theatreLocations: item.theatreSignals, theatreShows: item.theatreShows },
        disclaimer: "Cineinsta Buzz is an editorial signal based on Cineinsta activity and authorized theatre/showtime data. OTT sections use platform-specific public trending/popular signals and are not a Cineinsta ranking."
      };
    })
    .sort((a, b) => b.buzzScore - a.buzzScore)
    .slice(0, 24);

  const tabs = [
    { id: "buzz", name: "Buzz Now", status: "active" },
    { id: "theatres", name: "Theatres Now", status: "active" },
    ...OTT_SOURCES.map(source => ({ id: source.id, name: source.name, status: ottTrending[source.id]?.status || "unavailable" }))
  ];

  const payload = {
    updatedAt: new Date().toISOString(),
    language: "Telugu",
    tabs,
    movies: buzz,
    ottTrending,
    methodology: "Buzz Now is Cineinsta's editorial activity signal. OTT tabs show Telugu titles appearing in each platform's own public trending, popular or Top 10 surface when the title can be matched to Cineinsta's Telugu movie feed. No OTT availability is inferred."
  };

  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log(`Wrote ${buzz.length} Cineinsta Buzz movie records.`);
  for (const source of OTT_SOURCES) {
    const data = ottTrending[source.id];
    console.log(`${source.name}: ${data.status} (${data.items?.length || 0} Telugu titles)`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
