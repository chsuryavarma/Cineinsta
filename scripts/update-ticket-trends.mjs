import fs from "node:fs/promises";

const API_BASE = "https://api.internationalshowtimes.com/v5";
const CITY = "Hyderabad";
const COUNTRY = "IN";
const OUTPUT = new URL("../data/ticket-trends.json", import.meta.url);
const FEED = new URL("../data/feed.json", import.meta.url);
const API_KEY = process.env.SHOWTIMES_API_KEY?.trim();

function key(s = "") {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function bestFeedImage(title, feed) {
  const pools = [...(feed.news || []), ...(feed.trailers || []), ...(feed.reviews || [])];
  const k = key(title);
  const match = pools.find(x => {
    const t = key(x?.title || "");
    return t && (t.includes(k) || k.includes(t));
  });
  return match?.img || "";
}

async function api(path) {
  const r = await fetch(`${API_BASE}${path}`, {
    headers: {
      "X-API-Key": API_KEY,
      "Accept": "application/json"
    }
  });
  if (!r.ok) throw new Error(`International Showtimes API ${r.status} for ${path}`);
  return r.json();
}

async function main() {
  // GitHub Actions must remain green even before the optional API key is configured.
  // Until then, preserve the last verified dataset instead of failing the workflow.
  if (!API_KEY) {
    console.log("SHOWTIMES_API_KEY is not configured; preserving the last verified ticket-trends.json.");
    return;
  }

  const feed = JSON.parse(await fs.readFile(FEED, "utf8"));

  const cityData = await api(`/cities?countries=${COUNTRY}&query=${encodeURIComponent(CITY)}&limit=20`);
  const city = (cityData.cities || []).find(x => key(x.name) === key(CITY)) || cityData.cities?.[0];
  if (!city?.id) throw new Error("Hyderabad was not found in the International Showtimes API for India.");

  const movieData = await api(`/movies?city_ids=${encodeURIComponent(city.id)}&countries=${COUNTRY}&limit=100&fields=id,title,poster_image_thumbnail`);
  const candidates = Array.isArray(movieData.movies) ? movieData.movies : [];
  if (!candidates.length) throw new Error("No Hyderabad movies were returned by the showtimes API.");

  const scored = [];
  for (const movie of candidates.slice(0, 20)) {
    try {
      const showData = await api(`/showtimes?city_ids=${encodeURIComponent(city.id)}&movie_id=${encodeURIComponent(movie.id)}&countries=${COUNTRY}`);
      const shows = Array.isArray(showData.showtimes) ? showData.showtimes : [];
      const cinemaIds = new Set();
      for (const show of shows) {
        if (show.cinema_id != null) cinemaIds.add(String(show.cinema_id));
        if (show.cinema?.id != null) cinemaIds.add(String(show.cinema.id));
      }
      if (shows.length) scored.push({ movie, showCount: shows.length, cinemaCount: cinemaIds.size });
    } catch (error) {
      console.warn(`Skipping ${movie.title}: ${error.message}`);
    }
  }

  if (!scored.length) throw new Error("No current Hyderabad showtime signals were returned; previous data was preserved.");

  scored.sort((a, b) =>
    (b.cinemaCount - a.cinemaCount) ||
    (b.showCount - a.showCount) ||
    String(a.movie.title).localeCompare(String(b.movie.title))
  );

  const outputMovies = scored.slice(0, 8).map((item, i) => ({
    movie: item.movie.title,
    lang: "Now Showing",
    language: [],
    status: ["showing"],
    trendScore: item.cinemaCount * 10 + item.showCount,
    trendRank: i + 1,
    img: item.movie.poster_image_thumbnail || bestFeedImage(item.movie.title, feed),
    source: "International Showtimes API — Hyderabad public showtime coverage",
    signal: {
      cinemas: item.cinemaCount,
      shows: item.showCount
    }
  }));

  const payload = {
    updatedAt: new Date().toISOString(),
    city: CITY,
    movies: outputMovies,
    methodology: "Cineinsta trend ranking uses current Hyderabad public showtime coverage from an authorized showtimes API. It measures cinema/showtime activity; it does not estimate tickets sold and does not claim a rating ranking.",
    source: "International Showtimes API"
  };

  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outputMovies.length} Cineinsta Hyderabad trend movies.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
