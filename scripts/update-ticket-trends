import fs from "node:fs/promises";

const CITY_URL = "https://in.bookmyshow.com/explore/home/hyderabad";
const CINEMA_BASES = [
  "https://in.bookmyshow.com/cinemas/hyderabad/pvr-atrium-gachibowli-hyderabad/buytickets/PVTS",
  "https://in.bookmyshow.com/cinemas/hyderabad/pvr-central-mall-panjagutta/buytickets/PVYH",
  "https://in.bookmyshow.com/cinemas/hyderabad/pvr-preston-gachibowli-hyderabad/buytickets/PVTP",
  "https://in.bookmyshow.com/cinemas/hyderabad/pvr-icon-hitech-madhapur-hyderabad/buytickets/PVHM"
];
const OUTPUT = new URL("../data/ticket-trends.json", import.meta.url);
const FEED = new URL("../data/feed.json", import.meta.url);

const FALLBACK = [
  ["The Paradise", ["telugu"]],
  ["Avengers Endgame: Encore", ["english", "hindi", "tamil"]],
  ["The Vvaan - Force of the Forrest", ["hindi"]],
  ["Hanuman Ansh", ["hindi"]],
  ["Heart of the Beast", ["english"]],
  ["Resident Evil", ["english", "tamil", "telugu", "hindi", "malayalam"]]
];

function decode(s = "") {
  return s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ");
}
function strip(s = "") { return decode(s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()); }
function key(s = "") { return strip(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function slugTitle(s = "") { return key(s).replace(/\b(ua\d+|u|a)\b/g, "").replace(/\s+/g, " ").trim(); }
function extractAnchors(html) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']*\/movies\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const title = strip(m[2]);
    if (title && title.length < 120) out.push({ title, href: m[1] });
  }
  return out;
}
function section(html, startText, endText) {
  const a = html.toLowerCase().indexOf(startText.toLowerCase());
  if (a < 0) return "";
  const b = html.toLowerCase().indexOf(endText.toLowerCase(), a + startText.length);
  return html.slice(a, b > 0 ? b : undefined);
}
function bestFeedImage(title, feed) {
  const pools = [...(feed.news || []), ...(feed.trailers || []), ...(feed.reviews || [])];
  const k = slugTitle(title);
  const match = pools.find(x => x?.title && (slugTitle(x.title).includes(k) || k.includes(slugTitle(x.title))));
  return match?.img || "";
}
async function fetchText(url) {
  const r = await fetch(url, { headers: { "user-agent": "Cineinsta/1.0", accept: "text/html,application/xhtml+xml" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}

async function main() {
  const feed = JSON.parse(await fs.readFile(FEED, "utf8"));
  const cityHtml = await fetchText(CITY_URL);
  const recommended = section(cityHtml, "Recommended Movies", "The Best Of Live Events");
  const nowShowing = section(cityHtml, "Movies Now Showing in Hyderabad", "Upcoming Movies Per Week");
  const allCity = [...extractAnchors(recommended), ...extractAnchors(nowShowing)];
  const cityTitles = [...new Map(allCity.map(x => [key(x.title), x.title])).values()];
  const recommendedKeys = new Set(extractAnchors(recommended).map(x => key(x.title)));

  const counts = new Map();
  for (const title of cityTitles) counts.set(key(title), { title, coverage: 0 });

  const todayIST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
  const cinemaUrls = CINEMA_BASES.map(base => `${base}/${todayIST}`);

  for (const url of cinemaUrls) {
    try {
      const html = await fetchText(url);
      const text = strip(html).toLowerCase();
      for (const item of counts.values()) if (text.includes(item.title.toLowerCase())) item.coverage += 1;
    } catch (e) {
      console.warn(`Skipping cinema source: ${e.message}`);
    }
  }

  const movies = [...counts.values()].map(item => {
    const k = key(item.title);
    const recommendedBonus = recommendedKeys.has(k) ? 6 : 0;
    const coverageScore = Math.min(item.coverage, cinemaUrls.length);
    const score = recommendedBonus + coverageScore;
    return { ...item, score };
  }).filter(x => x.score > 0)
    .sort((a,b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 8);

  if (!movies.length) throw new Error("No current Hyderabad movie signals were detected; previous data was preserved.");

  const outputMovies = movies.map((m, i) => {
    const fallback = FALLBACK.find(([t]) => key(t) === key(m.title));
    const language = fallback?.[1] || [];
    return {
      movie: m.title,
      lang: language.length ? language.map(x => x[0].toUpperCase()+x.slice(1)).join(" / ") : "Now Showing",
      language,
      status: ["showing"],
      trendScore: m.score,
      trendRank: i + 1,
      img: bestFeedImage(m.title, feed),
      source: "Public Hyderabad booking/showing signals"
    };
  });

  const payload = {
    updatedAt: new Date().toISOString(),
    city: "Hyderabad",
    movies: outputMovies,
    methodology: "Cineinsta trend ranking uses public Hyderabad booking/showing visibility and cinema coverage. It does not estimate tickets sold or claim a rating ranking."
  };
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outputMovies.length} Cineinsta Hyderabad trend movies.`);
}

main().catch(async err => {
  console.error(err.message);
  process.exit(1);
});
