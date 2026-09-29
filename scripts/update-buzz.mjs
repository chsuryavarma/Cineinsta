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

function clean(value = "") {
  return String(value || "").trim();
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

function scoreNews(title, news) {
  const target = key(title);
  return news.filter(item => {
    const t = key(item?.title);
    return t && (t.includes(target) || target.includes(t));
  }).length;
}

function scoreReviews(title, reviews) {
  const target = key(title);
  return reviews.filter(item => {
    const t = key(item?.title || item?.movie);
    return t && (t.includes(target) || target.includes(t));
  }).length;
}

function feedImage(title, feed) {
  const pools = [
    ...(feed.news || []),
    ...(feed.reviews || []),
    ...(feed.trailers || [])
  ];

  const target = key(title);
  const match = pools.find(item => {
    const t = key(item?.title);
    return t && (t === target || t.includes(target) || target.includes(t));
  });

  return match?.img || "";
}

function detectPlatforms(text) {
  const value = clean(text).toLowerCase();

  return OTT_PLATFORMS
    .filter(platform => {
      const aliases = {
        netflix: ["netflix"],
        "prime-video": ["prime video", "amazon prime", "prime"],
        aha: ["aha"],
        jiohotstar: ["jiohotstar", "hotstar", "disney+ hotstar"],
        zee5: ["zee5"],
        "sun-nxt": ["sun nxt", "sunnxt"],
        "etv-win": ["etv win", "etvwin"],
        sonyliv: ["sonyliv", "sony liv"]
      };

      return aliases[platform.id].some(alias => value.includes(alias));
    })
    .map(platform => platform.name);
}

/*
  Important:
  This script deliberately does NOT call TMDB, JustWatch, Netflix,
  Prime Video, Aha, ZEE5 or other consumer sites.

  Until Cineinsta has an authorized commercial OTT availability feed,
  OTT platform labels are only created when the platform is explicitly
  mentioned in Cineinsta's own collected/editorial data.

  This prevents us from presenting guessed or scraped availability
  as verified platform data.
*/

async function main() {
  const feed = JSON.parse(await fs.readFile(FEED, "utf8"));

  let trends = {
    updatedAt: null,
    city: "Hyderabad",
    movies: []
  };

  try {
    trends = JSON.parse(await fs.readFile(TRENDS, "utf8"));
  } catch {
    console.log("No ticket-trends.json found; Buzz will use Cineinsta feed signals only.");
  }

  const news = Array.isArray(feed.news) ? feed.news : [];
  const reviews = Array.isArray(feed.reviews) ? feed.reviews : [];
  const trailers = Array.isArray(feed.trailers) ? feed.trailers : [];

  const candidates = new Map();

  function addCandidate(title, image, source, sourceData = {}) {
    const cleanTitle = clean(title);
    if (!cleanTitle) return;

    const id = key(cleanTitle);
    if (!id) return;

    const current = candidates.get(id) || {
      title: cleanTitle,
      img: image || "",
      newsSignals: 0,
      reviewSignals: 0,
      theatreSignals: 0,
      theatreShows: 0,
      platforms: [],
      source: source || "",
      sourceData
    };

    if (!current.img && image) current.img = image;
    current.newsSignals += source === "news" ? 1 : 0;
    current.reviewSignals += source === "review" ? 1 : 0;

    if (source === "theatre") {
      current.theatreSignals += Number(sourceData.cinemas || 0);
      current.theatreShows += Number(sourceData.shows || 0);
    }

    const detected = detectPlatforms(
      `${cleanTitle} ${sourceData.text || ""} ${sourceData.summary || ""} ${sourceData.dek || ""}`
    );

    current.platforms = [...new Set([...current.platforms, ...detected])];

    candidates.set(id, current);
  }

  for (const item of news) {
    addCandidate(
      item.title,
      item.img,
      "news",
      { summary: item.summary, dek: item.dek }
    );
  }

  for (const item of reviews) {
    addCandidate(item.title || item.movie, item.img, "review", item);
  }

  for (const item of trailers) {
    addCandidate(item.title, item.img, "trailer", item);
  }

  for (const item of trends.movies || []) {
    addCandidate(
      item.movie,
      item.img,
      "theatre",
      {
        cinemas: item.signal?.cinemas,
        shows: item.signal?.shows,
        text: item.source
      }
    );
  }

  const buzz = [...candidates.values()]
    .filter(item => item.img)
    .map(item => {
      const newsScore = Math.min(item.newsSignals * 12, 36);
      const reviewScore = Math.min(item.reviewSignals * 8, 16);
      const theatreScore = Math.min(item.theatreSignals * 3, 30);
      const showScore = Math.min(item.theatreShows * 0.4, 18);

      const buzzScore = Math.round(
        Math.min(100, 10 + newsScore + reviewScore + theatreScore + showScore)
      );

      let status = "STEADY";
      if (buzzScore >= 70) status = "HIGH BUZZ";
      else if (buzzScore >= 50) status = "RISING";
      else if (buzzScore < 30) status = "COOLING";

      const why = [];

      if (item.theatreSignals > 0) {
        why.push(`${item.theatreSignals} Hyderabad cinema locations currently carrying the film`);
      }

      if (item.theatreShows > 0) {
        why.push(`${item.theatreShows} public showtimes in the current theatre dataset`);
      }

      if (item.newsSignals > 0) {
        why.push(`${item.newsSignals} recent Cineinsta news signal${item.newsSignals === 1 ? "" : "s"}`);
      }

      if (item.reviewSignals > 0) {
        why.push("Cineinsta review activity");
      }

      if (item.platforms.length) {
        why.push(`OTT mentioned: ${item.platforms.join(", ")}`);
      }

      return {
        id: slugify(item.title),
        title: item.title,
        img: item.img,
        language: "Telugu",
        buzzScore,
        status,
        platforms: item.platforms,
        theatre: {
          cinemas: item.theatreSignals,
          shows: item.theatreShows
        },
        why: why.slice(0, 2).join(" · ") || "Recent Cineinsta activity",
        sourceSignals: {
          news: item.newsSignals,
          reviews: item.reviewSignals,
          theatreLocations: item.theatreSignals,
          theatreShows: item.theatreShows
        },
        disclaimer:
          "Cineinsta Buzz is an editorial signal based on available Cineinsta activity and authorized theatre/showtime data. It is not an official OTT popularity ranking."
      };
    })
    .sort((a, b) => b.buzzScore - a.buzzScore)
    .slice(0, 24);

  const payload = {
    updatedAt: new Date().toISOString(),
    language: "Telugu",
    tabs: [
      { id: "theatres", name: "Theatres Now", status: "active" },
      ...OTT_PLATFORMS.map(platform => ({
        id: platform.id,
        name: platform.name,
        status: "signal-only"
      }))
    ],
    movies: buzz,
    methodology:
      "Cineinsta Buzz combines Cineinsta news/review activity with authorized theatre/showtime signals. OTT availability is not inferred or scraped. Platform labels appear only when an OTT service is explicitly mentioned in Cineinsta data until an authorized commercial OTT data source is connected."
  };

  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${buzz.length} Cineinsta Buzz records.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
