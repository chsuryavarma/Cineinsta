import fs from "node:fs/promises";

const FEED = new URL("../data/feed.json", import.meta.url);
const TRENDS = new URL("../data/ticket-trends.json", import.meta.url);
const OUTPUT = new URL("../data/buzz.json", import.meta.url);

const OTT_PLATFORMS = [
  { id: "netflix", name: "Netflix" },
  { id: "prime-video", name: "Prime Video" },
  { id: "aha", name: "Aha" },
  { id: "jiohotstar", name: "JioHotstar" },
  { id: "zee5", name: "ZEE5" },
  { id: "sun-nxt", name: "Sun NXT" },
  { id: "etv-win", name: "ETV Win" },
  { id: "sonyliv", name: "SonyLIV" }
];

function clean(value = "") { return String(value || "").trim(); }
function key(value = "") {
  return clean(value).toLowerCase().replace(/[^a-z0-9\u0C00-\u0C7F]+/g, " ").replace(/\s+/g, " ").trim();
}
function slugify(value = "") { return key(value).replace(/\s+/g, "-").slice(0, 100); }

function titleMatches(movieTitle, text) {
  const movie = key(movieTitle);
  const value = key(text);
  if (!movie || !value) return false;
  if (value.includes(movie) || movie.includes(value)) return true;
  const tokens = movie.split(" ").filter(x => x.length > 2);
  if (tokens.length < 2) return false;
  const hits = tokens.filter(token => value.includes(token)).length;
  return hits / tokens.length >= 0.75;
}

function signalCount(movieTitle, items, textFn) {
  return items.filter(item => titleMatches(movieTitle, textFn(item))).length;
}

function feedImage(title, feed) {
  const pools = [...(feed.reviews || []), ...(feed.trailers || []), ...(feed.news || [])];
  const match = pools.find(item => titleMatches(title, item?.title || item?.t || ""));
  return match?.img || "";
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
  return OTT_PLATFORMS.filter(p => aliases[p.id].some(a => value.includes(a))).map(p => p.name);
}

function detectPlatformSignals(movieTitle, items) {
  const result = {};
  for (const item of items) {
    const text = [item?.title || "", item?.summary || "", item?.dek || "", item?.t || ""].join(" ");
    if (!titleMatches(movieTitle, text)) continue;
    for (const platform of detectPlatforms(text)) {
      const p = OTT_PLATFORMS.find(x => x.name === platform);
      if (!p) continue;
      result[p.id] ||= { name: p.name, mentions: 0, label: "Mentioned in recent Cineinsta coverage" };
      result[p.id].mentions += 1;
    }
  }
  return result;
}

async function main() {
  const feed = JSON.parse(await fs.readFile(FEED, "utf8"));
  let trends = { updatedAt: null, city: "Hyderabad", movies: [] };
  try { trends = JSON.parse(await fs.readFile(TRENDS, "utf8")); }
  catch { console.log("No ticket-trends.json found; Buzz will use Cineinsta feed signals only."); }

  const news = Array.isArray(feed.news) ? feed.news : [];
  const reviews = Array.isArray(feed.reviews) ? feed.reviews : [];
  const trailers = Array.isArray(feed.trailers) ? feed.trailers : [];
  const candidates = new Map();

  function addMovie(title, image, source, sourceData = {}) {
    const cleanTitle = clean(title);
    if (!cleanTitle) return;
    const id = key(cleanTitle);
    if (!id) return;
    const current = candidates.get(id) || {
      title: cleanTitle, img: image || "", reviewSignals: 0, theatreSignals: 0,
      theatreShows: 0, trailerSignals: 0, platforms: [], sourceData: []
    };
    if (!current.img && image) current.img = image;
    if (source === "review") current.reviewSignals += 1;
    if (source === "trailer") current.trailerSignals += 1;
    if (source === "theatre") {
      current.theatreSignals += Number(sourceData.cinemas || 0);
      current.theatreShows += Number(sourceData.shows || 0);
    }
    current.sourceData.push(sourceData);
    current.platforms = [...new Set([...current.platforms, ...detectPlatforms(`${cleanTitle} ${sourceData.text || ""} ${sourceData.summary || ""} ${sourceData.dek || ""}`)])];
    candidates.set(id, current);
  }

  for (const item of reviews) addMovie(item.t || item.title || item.movie, item.img, "review", item);
  for (const item of trailers) addMovie(item.title, item.img, "trailer", item);
  for (const item of trends.movies || []) addMovie(item.movie, item.img || feedImage(item.movie, feed), "theatre", {
    cinemas: item.signal?.cinemas, shows: item.signal?.shows, text: item.source
  });

  const buzz = [...candidates.values()]
    .filter(item => item.img)
    .map(item => {
      const recentNews = signalCount(item.title, news, x => [x?.title || "", x?.summary || "", x?.dek || ""].join(" "));
      const ott = detectPlatformSignals(item.title, news);
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

      const why = [];
      if (item.theatreSignals > 0) why.push(`${item.theatreSignals} Hyderabad cinema locations currently carrying the film`);
      if (item.theatreShows > 0) why.push(`${item.theatreShows} public showtimes in the current theatre dataset`);
      if (recentNews > 0) why.push(`${recentNews} recent Cineinsta news signal${recentNews === 1 ? "" : "s"}`);
      if (recentReviews > 0) why.push("Cineinsta review activity");
      if (trailerSignals > 0) why.push("Recent trailer activity");
      if (Object.keys(ott).length) why.push(`OTT mentioned: ${Object.values(ott).map(x => x.name).join(", ")}`);

      return {
        id: slugify(item.title), title: item.title, img: item.img, language: "Telugu",
        buzzScore, status, platforms: item.platforms, ott,
        theatre: { cinemas: item.theatreSignals, shows: item.theatreShows },
        why: why.slice(0, 2).join(" · ") || "Recent Cineinsta movie activity",
        sourceSignals: { news: recentNews, reviews: recentReviews, trailers: trailerSignals, theatreLocations: item.theatreSignals, theatreShows: item.theatreShows },
        disclaimer: "Cineinsta Buzz is an editorial signal based on available Cineinsta activity and authorized theatre/showtime data. It is not an official OTT popularity ranking."
      };
    })
    .sort((a, b) => b.buzzScore - a.buzzScore)
    .slice(0, 24);

  const payload = {
    updatedAt: new Date().toISOString(), language: "Telugu",
    tabs: [{ id: "theatres", name: "Theatres Now", status: "active" }, ...OTT_PLATFORMS.map(p => ({ id: p.id, name: p.name, status: "cineinsta-signal" }))],
    movies: buzz,
    methodology: "Cineinsta Buzz is built around movie-level signals from Cineinsta reviews, news/trailer activity and authorized theatre/showtime data. OTT tabs group titles only when Cineinsta coverage explicitly mentions the named platform. They do not claim verified OTT availability until an authorized commercial OTT availability source is connected."
  };
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${buzz.length} Cineinsta Buzz movie records.`);
}
main().catch(error => { console.error(error); process.exit(1); });
