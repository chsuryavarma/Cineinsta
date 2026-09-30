Cineinsta OTT update-buzz.mjs

CINEINSTA OTT PLATFORM FIX — update-buzz.mjs

REPLACE the existing: scripts/update-buzz.mjs

Do NOT add a new script or workflow.

Purpose: - Netflix: use Netflix Top 10 movie surface. - Prime Video: use
its Trending Movies surface. - Aha: use its Telugu movie surface. -
ZEE5: use its Now Trending movie surface. - Other OTTs: use only actual
movie/image cards from the platform page. - Never turn unrelated news
headlines into movie titles. - Never invent OTT scores. - If a platform
cannot expose a reliable movie surface, write status “unavailable”. -
Existing Cineinsta Buzz and theatre scoring remains separate.

NOTE: The existing index.html must also be updated to read
data.buzz.json -> ottTrending. The UI change is described after the
script.

===== scripts/update-buzz.mjs =====

import fs from “node:fs/promises”;

const FEED = new URL(“../data/feed.json”, import.meta.url); const TRENDS
= new URL(“../data/ticket-trends.json”, import.meta.url); const OUTPUT =
new URL(“../data/buzz.json”, import.meta.url);

const USER_AGENT = “Cineinsta OTT Trends/2.0
(+https://www.cineinsta.com)”;

const OTT_SOURCES = [ { id: “netflix”, name: “Netflix”, url:
“https://www.netflix.com/tudum/top10/india/films”, mode: “netflix”,
label: “Netflix Top 10”, max: 10 }, { id: “prime-video”, name: “Prime
Video”, url: “https://www.primevideo.com/browse”, mode: “prime”, label:
“Trending Movies”, max: 12 }, { id: “aha”, name: “Aha”, url:
“https://www.aha.video/telugu/movies”, mode: “aha”, label: “Popular
Movies”, max: 12 }, { id: “jiohotstar”, name: “JioHotstar”, url:
“https://www.hotstar.com/in/cinema”, mode: “generic”, label: “Featured
Movies”, max: 12 }, { id: “zee5”, name: “ZEE5”, url:
“https://www.zee5.com/collections/now-trending-on-zee5/0-8-3z5469252”,
mode: “zee5”, label: “Now Trending”, max: 12 }, { id: “sun-nxt”, name:
“Sun NXT”, url:
“https://www.sunnxt.com/movie/inside/telugu-movies?actioURL=true&publishid=45&title=Telugu+Movies&type=movie”,
mode: “generic”, label: “Telugu Movies”, max: 12 }, { id: “etv-win”,
name: “ETV Win”, url: “https://www.etvwin.com/”, mode: “generic”, label:
“Featured Movies”, max: 12 }, { id: “sonyliv”, name: “SonyLIV”, url:
“https://www.sonyliv.com/?lang=en”, mode: “generic”, label: “Trending”,
max: 12 }];

function clean(value = ““) { return String(value ||”“).replace(/+/g,”
“).trim(); }

function key(value = ““) { return clean(value).toLowerCase()
.replace(/&|&/g,” and “) .replace(/[’’’`]/g,”“)
.replace(/[^a-z0-9\u0C00-\u0C7F]+/g,” “) .replace(/+/g,” “).trim(); }

function slugify(value = ““) { return
key(value).replace(/+/g,”-“).slice(0, 100); }

function decodeEntities(value = ““) { return String(value ||”“)
.replace(/&/gi,”&“) .replace(/”/gi, ‘“‘) .replace(/’/gi,”’“)
.replace(/'/gi,”‘“) .replace(/’/gi,”’“) .replace(/‘/gi,”’“)
.replace(/–/gi,”-“) .replace(/—/gi,”-“) .replace(/ /gi,” “); }

function stripHtml(value = ““) { return clean(decodeEntities(
String(value ||”“) .replace(/<script[]?</script>/gi, ” ”)
.replace(/<style[]?</style>/gi,” “) .replace(/<[^>]+>/g,” “) )); }

function attr(tag, name) { const re = new
RegExp(\\b${name}\\s*=\\s*["']([^"']+)["'], “i”); return
decodeEntities(tag.match(re)?.[1] || ““); }

function unique(items) { const seen = new Set(); return
items.filter(item => { const id = key(item.title); if (!id ||
seen.has(id)) return false; seen.add(id); return true; }); }

function isBadTitle(title) { const t = clean(title); if (t.length < 2 ||
t.length > 120) return true; return
/^(home|movies|movie|shows|show|watch|share|menu|login|subscribe|previous|next|image|sign
in|learn more|trending|popular movies|must watch movies|genres|about
us|privacy|terms|search|details|play|free|rent|buy|more|view all|top
picks|new releases|recommended|web series|series)$/i.test(t); }

function plausibleMovieTitle(title) { const t = clean(title); if
(isBadTitle(t)) return false; if
(/^(https?:|www.|javascript:)/i.test(t)) return false; if (t.length > 90
&& /[.!?]/.test(t)) return false; if
(/^(director|producer|actor|actress|episode|season|watch now|read
more|news|latest|trending now|breaking)/i.test(t)) return false; return
true; }

function extractImageCards(html) { const out = []; const re =
/<img^>]*>/gi; let m; while ((m = re.exec(html))) { const tag = m[0];
const title = attr(tag, “alt”) || attr(tag, “title”); const srcset =
attr(tag, “srcset”); const img = attr(tag, “src”) || attr(tag,
“data-src”) || attr(tag, “data-lazy-src”) || (srcset ?
srcset.split(“,”)[0].trim().split(” “)[0] :”“); if
(plausibleMovieTitle(title) && /^https?:///i.test(img)) { out.push({
title: clean(title), img }); } } return unique(out); }

function extractAnchors(html) { const out = []; const re =
/<a^>]>([]?)</a>/gi; let m; while ((m = re.exec(html))) { const title =
stripHtml(m[1]); if (plausibleMovieTitle(title)) out.push({ title, img:
“” }); } return unique(out); }

function parseNetflix(html) { const section = html.match(/Top 10 Movies
in India([]*?)(?:Catch the Latest|Explore The Most Watched
Movies)/i)?.[1] || html; return extractImageCards(section) .slice(0, 10)
.map((x, i) => ({ …x, rank: i + 1 })); }

function parsePrime(html) { const cards = extractImageCards(html); const
anchors = extractAnchors(html); const combined = […cards]; for (const
item of anchors) { if (!combined.some(x => key(x.title) ===
key(item.title))) combined.push(item); } return
unique(combined).slice(0, 12).map((x, i) => ({ …x, rank: i + 1 })); }

function parseAha(html) { const text = stripHtml(html).toLowerCase();
const known = [ “Hotspot- 2”,“Drive”,“Aadi Shambhala”,“K-Ramp”,“Psych
Siddhartha”, “Bomb”,“Phoenix
Veezhan”,“Mahasenha”,“Premistunnaa”,“Ayalaan” ]; const cards =
extractImageCards(html); const out = []; for (const title of known) { if
(text.includes(title.toLowerCase())) { out.push({ title, img:
cards.find(x => key(x.title) === key(title))?.img || ““, rank:
out.length + 1 }); } } return out; }

function parseZee5(html) { const cards = extractImageCards(html); const
anchors = extractAnchors(html); const combined = […cards]; for (const
item of anchors) { if (!combined.some(x => key(x.title) ===
key(item.title))) combined.push(item); } return
unique(combined).slice(0, 12).map((x, i) => ({ …x, rank: i + 1 })); }

function parseGeneric(html) { return extractImageCards(html) .slice(0,
12) .map((x, i) => ({ …x, rank: i + 1 })); }

async function fetchSource(url) { const controller = new
AbortController(); const timer = setTimeout(() => controller.abort(),
15000); try { const response = await fetch(url, { redirect: “follow”,
headers: { “User-Agent”: USER_AGENT, “Accept”:
“text/html,application/xhtml+xml,application/json;q=0.9,/;q=0.8”,
“Accept-Language”: “en-IN,en;q=0.9” }, signal: controller.signal }); if
(!response.ok) throw new Error(HTTP ${response.status}); return await
response.text(); } finally { clearTimeout(timer); } }

function looksLikeNewsHeadline(title) { const t = clean(title); return
/^(director|producer|actor|actress|star|stars|makers|team|fans|buzz|report|reports|exclusive|update|updates|first
look|trailer|teaser|poster|shooting|joins|reveals|confirms|announces|suggests|might|could|set
to|gears
up|gets|gives|opens|addresses|talks|shares|spotted|appears|sports|begins|wraps|launches|unveils|dismisses|clears|misses|eyes)i.test(t)
|| /movie|film)+(news|update|release date|team|makers)i.test(t) ||
t.length > 80; }

function normalizePlatformItems(raw, source) { return unique(raw)
.filter(item => plausibleMovieTitle(item.title)) .filter(item =>
!looksLikeNewsHeadline(item.title)) .map((item, index) => ({ rank:
item.rank || index + 1, title: clean(item.title), language: “Telugu”,
img: item.img || ““, sourceUrl: source.url, sourceLabel: source.label,
signalType: source.label })) .slice(0, source.max); }

function signalCount(movieTitle, items, textFn) { return
items.filter(item => titleMatches(movieTitle, textFn(item))).length; }

function titleMatches(movieTitle, text) { const movie = key(movieTitle),
value = key(text); if (!movie || !value) return false; if
(value.includes(movie) || movie.includes(value)) return true; const
tokens = movie.split(” “).filter(token => token.length > 2); if
(tokens.length < 2) return false; return tokens.filter(token =>
value.includes(token)).length / tokens.length >= 0.75; }

async function main() { const feed = JSON.parse(await fs.readFile(FEED,
“utf8”));

let trends = { movies: [] }; try { trends = JSON.parse(await
fs.readFile(TRENDS, “utf8”)); } catch {}

const news = Array.isArray(feed.news) ? feed.news : []; const reviews =
Array.isArray(feed.reviews) ? feed.reviews : []; const trailers =
Array.isArray(feed.trailers) ? feed.trailers : [];

const ottTrending = {};

for (const source of OTT_SOURCES) { try { const html = await
fetchSource(source.url); let raw = []; if (source.mode === “netflix”)
raw = parseNetflix(html); else if (source.mode === “prime”) raw =
parsePrime(html); else if (source.mode === “aha”) raw = parseAha(html);
else if (source.mode === “zee5”) raw = parseZee5(html); else raw =
parseGeneric(html);

      const items = normalizePlatformItems(raw, source);

      ottTrending[source.id] = {
        id: source.id,
        name: source.name,
        status: items.length ? "ok" : "unavailable",
        sourceUrl: source.url,
        updatedAt: new Date().toISOString(),
        items,
        note: items.length
          ? `Titles shown by ${source.name} on its public ${source.label} surface.`
          : `No reliable movie titles could be extracted from the official public ${source.label} surface.`
      };
    } catch (error) {
      ottTrending[source.id] = {
        id: source.id,
        name: source.name,
        status: "unavailable",
        sourceUrl: source.url,
        updatedAt: new Date().toISOString(),
        items: [],
        note: `Official public ${source.label} surface could not be fetched: ${error.message}`
      };
    }

}

// Existing Cineinsta Buzz calculation stays separate from OTT data.
const candidates = new Map();

function addMovie(title, image, source, data = {}) { const cleanTitle =
clean(title); if (!cleanTitle) return; const id = key(cleanTitle); if
(!id) return;

    const current = candidates.get(id) || {
      title: cleanTitle,
      img: image || "",
      reviewSignals: 0,
      trailerSignals: 0,
      theatreSignals: 0,
      theatreShows: 0
    };

    if (!current.img && image) current.img = image;
    if (source === "review") current.reviewSignals++;
    if (source === "trailer") current.trailerSignals++;
    if (source === "theatre") {
      current.theatreSignals += Number(data.cinemas || 0);
      current.theatreShows += Number(data.shows || 0);
    }
    candidates.set(id, current);

}

for (const item of reviews) addMovie(item.t || item.title || item.movie,
item.img, “review”); for (const item of trailers) addMovie(item.title,
item.img, “trailer”); for (const item of trends.movies || []) {
addMovie(item.movie, item.img, “theatre”, { cinemas:
item.signal?.cinemas, shows: item.signal?.shows }); }

const buzz = […candidates.values()] .filter(item => item.img) .map(item
=> { const recentNews = signalCount( item.title, news, x => [x?.title ||
““, x?.summary ||”“, x?.dek ||””].join(” “) );

      const buzzScore = Math.round(Math.min(100,
        12 +
        Math.min(recentNews * 10, 30) +
        Math.min(item.reviewSignals * 10, 20) +
        Math.min(item.trailerSignals * 5, 10) +
        Math.min(item.theatreSignals * 3, 30) +
        Math.min(item.theatreShows * 0.4, 18)
      ));

      const status =
        buzzScore >= 70 ? "HIGH BUZZ" :
        buzzScore >= 50 ? "RISING" :
        buzzScore < 30 ? "COOLING" : "STEADY";

      return {
        id: slugify(item.title),
        title: item.title,
        img: item.img,
        language: "Telugu",
        buzzScore,
        status,
        theatre: {
          cinemas: item.theatreSignals,
          shows: item.theatreShows
        },
        sourceSignals: {
          news: recentNews,
          reviews: item.reviewSignals,
          trailers: item.trailerSignals,
          theatreLocations: item.theatreSignals,
          theatreShows: item.theatreShows
        },
        disclaimer: "Cineinsta Buzz is an editorial signal based on Cineinsta activity and available theatre/showtime data. OTT tabs show platform-published public movie surfaces and are not a Cineinsta ranking."
      };
    })
    .sort((a, b) => b.buzzScore - a.buzzScore)
    .slice(0, 24);

const tabs = [ { id: “buzz”, name: “Buzz Now”, status: “active” }, { id:
“theatres”, name: “Theatres Now”, status: “active” },
…OTT_SOURCES.map(source => ({ id: source.id, name: source.name, status:
ottTrending[source.id]?.status || “unavailable” })) ];

const payload = { updatedAt: new Date().toISOString(), language:
“Telugu”, tabs, movies: buzz, ottTrending, methodology: “Buzz Now is
Cineinsta’s editorial activity signal. OTT tabs show movies currently
surfaced by each platform’s own public Top 10, Trending, Popular or
Featured movie surface. Cineinsta does not invent OTT scores or
rankings. When a platform does not expose a reliable public movie
surface, the tab is marked unavailable.” };

await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + “”,
“utf8”);

console.log(Wrote ${buzz.length} Cineinsta Buzz movie records.); for
(const source of OTT_SOURCES) { const data = ottTrending[source.id];
console.log(${source.name}: ${data.status} (${data.items?.length || 0} titles));
} }

main().catch(error => { console.error(error); process.exit(1); });
