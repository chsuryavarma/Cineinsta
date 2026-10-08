import fs from "node:fs/promises";

const FEED = new URL("../data/feed.json", import.meta.url);
const TRENDS = new URL("../data/ticket-trends.json", import.meta.url);
const OUTPUT = new URL("../data/buzz.json", import.meta.url);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36 Cineinsta/1.0";

const SOURCES = [
  {
    id: "netflix",
    name: "Netflix",
    mode: "netflix",
    urls: [
      "https://www.netflix.com/in/browse/genre/34399",
      "https://qr.netflix.com/in/browse/genre/100381",
      "https://www.netflix.com/in/browse/genre/81610866",
    ],
  },
  {
    id: "prime-video",
    name: "Prime Video",
    mode: "prime",
    urls: ["https://www.primevideo.com/-/en/movie?tr=is"],
  },
  {
    id: "aha",
    name: "Aha",
    mode: "telugu",
    urls: ["https://www.aha.video/telugu/movies"],
  },
  {
    id: "jiohotstar",
    name: "JioHotstar",
    mode: "generic",
    urls: ["https://www.hotstar.com/in/cinema"],
  },
  {
    id: "zee5",
    name: "ZEE5",
    mode: "telugu",
    urls: [
      "https://www.zee5.com/movies/lang/telugu",
      "https://www.zee5.com/collections/telugu/0-8-3z5553078",
    ],
  },
  {
    id: "sun-nxt",
    name: "Sun NXT",
    mode: "generic",
    urls: [
      "https://www.sunnxt.com/movie/inside/telugu-movies?actioURL=true&publishid=45&title=Telugu+Movies&type=movie",
    ],
  },
  {
    id: "etv-win",
    name: "ETV Win",
    mode: "generic",
    urls: ["https://www.etvwin.com/"],
  },
  {
    id: "sonyliv",
    name: "SonyLIV",
    mode: "generic",
    urls: ["https://www.sonyliv.com/?lang=en"],
  },
];

const GENERIC_TITLES = new Set([
  "home","movies","movie","series","shows","show","watch now","subscribe",
  "login","sign in","more","previous","next","top 10","top listing",
  "latest movies","latest ott releases","ott releases","this week",
  "read more","advertisement","release date","telugu movies",
  "popular movies","trending","featured","view all","see all"
]);

function clean(v = "") {
  return String(v ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decode(v = "") {
  return String(v ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function strip(v = "") {
  return clean(
    decode(
      String(v)
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function attr(tag, name) {
  const m = String(tag).match(
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i")
  );
  return decode(m?.[1] || "");
}

function abs(url, base) {
  try { return new URL(url, base).href; } catch { return ""; }
}

function key(v = "") {
  return clean(decode(v))
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(v = "") {
  let t = clean(v)
    .replace(/^\d+[\).\s-]+/, "")
    .replace(/\s*\|\s*20\d{2}.*$/i, "")
    .replace(/\s*-\s*20\d{2}.*$/i, "")
    .trim();

  if (!t || t.length < 2 || t.length > 140) return "";
  if (GENERIC_TITLES.has(t.toLowerCase())) return "";
  if (/^(language|genre|cast|crew|details|audio|subtitles)$/i.test(t)) return "";
  return t;
}

function isTelugu(text = "") {
  return /[\u0C00-\u0C7F]/.test(String(text)) || /\btelugu\b/i.test(String(text));
}

async function fetchText(url, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function imageFromTag(tag, base) {
  const raw =
    attr(tag, "src") ||
    attr(tag, "data-src") ||
    attr(tag, "data-lazy-src") ||
    attr(tag, "data-original") ||
    attr(tag, "content");

  const url = abs(raw, base);
  if (!/^https?:\/\//i.test(url)) return "";
  if (/(logo|icon|sprite|avatar|facebook|instagram|twitter|google_play|app_store|advert|ads?[-_])/i.test(url))
    return "";
  return url;
}

function extractImageIndex(html, base) {
  const out = [];
  const re = /<img\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const img = imageFromTag(tag, base);
    if (!img) continue;
    const text = clean(
      [
        attr(tag, "alt"),
        attr(tag, "title"),
        attr(tag, "aria-label"),
        attr(tag, "data-title"),
      ].join(" ")
    );
    out.push({ img, text, k: key(text) });
  }
  return out;
}

function nearestImage(html, position, base, imageIndex) {
  const nearby = html.slice(
    Math.max(0, position - 5000),
    Math.min(html.length, position + 5000)
  );
  const tags = nearby.match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const img = imageFromTag(tag, base);
    if (img) return img;
  }
  return "";
}

function imageForTitle(title, imageIndex) {
  const wanted = key(title);
  if (!wanted) return "";
  const exact = imageIndex.find(x => x.k && (x.k === wanted || x.k.includes(wanted)));
  return exact?.img || "";
}

function extractCandidates(html, base, platform) {
  const imageIndex = extractImageIndex(html, base);
  const out = [];

  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) && out.length < 500) {
    const title = normalizeTitle(strip(m[2]));
    if (!title) continue;

    const block = m[2];
    let img = nearestImage(html, m.index, base, imageIndex);
    if (!img) img = imageForTitle(title, imageIndex);

    out.push({
      title,
      img,
      url: abs(m[1], base),
      platform: platform.name,
      text: strip(block),
    });
  }

  const headingRe = /<(h1|h2|h3|h4|h5)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  while ((m = headingRe.exec(html))) {
    const title = normalizeTitle(strip(m[2]));
    if (!title) continue;
    let img = nearestImage(html, m.index, base, imageIndex);
    if (!img) img = imageForTitle(title, imageIndex);
    out.push({
      title,
      img,
      url: "",
      platform: platform.name,
      text: strip(html.slice(Math.max(0, m.index - 1000), m.index + 2500)),
    });
  }

  // JSON-LD often survives server-side fetching even when visual cards do not.
  const ld = html.match(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
  ) || [];

  for (const script of ld) {
    const raw = script
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];

      const walk = node => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(walk);

        const title = normalizeTitle(node.name || node.headline || "");
        let image = node.image;
        if (Array.isArray(image)) image = image[0];
        if (image && typeof image === "object") image = image.url;

        if (title) {
          out.push({
            title,
            img: abs(String(image || ""), base),
            url: abs(String(node.url || ""), base),
            platform: platform.name,
            text: JSON.stringify(node).slice(0, 5000),
          });
        }
        Object.values(node).forEach(walk);
      };

      walk(nodes);
    } catch {}
  }

  const seen = new Set();
  return out.filter(x => {
    const k = `${key(x.title)}|${platform.id}`;
    if (!key(x.title) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function platformAccepts(source, item) {
  const text = `${item.title} ${item.text}`;
  if (source.mode === "telugu") return true;
  if (source.mode === "netflix") return true;
  if (source.mode === "prime") return isTelugu(text);
  return isTelugu(text);
}

async function parsePrime(items) {
  const result = [];
  for (const item of items.slice(0, 60)) {
    if (isTelugu(`${item.title} ${item.text}`)) {
      result.push({ ...item, verifiedTelugu: true });
      continue;
    }

    if (!item.url || !/primevideo\.com/i.test(item.url)) continue;

    try {
      const detail = await fetchText(item.url, 18000);
      if (isTelugu(detail) || /\baudio languages?\b[\s\S]{0,500}\btelugu\b/i.test(detail)) {
        const images = extractImageIndex(detail, item.url);
        result.push({
          ...item,
          img: imageForTitle(item.title, images) || item.img,
          verifiedTelugu: true,
        });
      }
    } catch {}
  }
  return result;
}

async function getSourceData(source) {
  const all = [];

  for (const url of source.urls) {
    try {
      const html = await fetchText(url);
      let items = extractCandidates(html, url, source);

      if (source.mode === "prime") {
        items = await parsePrime(items);
      } else {
        items = items.filter(x => platformAccepts(source, x));
      }

      all.push(...items);
    } catch (e) {
      console.warn(`${source.name}: ${url} failed: ${e.message}`);
    }
  }

  const seen = new Set();
  return all.filter(item => {
    const k = key(item.title);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 30);
}

function feedImageIndex(feed, previous) {
  const out = [];
  const add = x => {
    if (x?.title && x?.img) out.push({ k: key(x.title), img: x.img });
  };

  for (const x of feed.news || []) add({ title: x.title || x.t, img: x.img });
  for (const x of feed.reviews || []) add({ title: x.title || x.t || x.movie, img: x.img });
  for (const x of feed.trailers || []) add({ title: x.title || x.t, img: x.img });

  for (const p of Object.values(previous?.ottTrending || {})) {
    for (const x of p.items || []) add(x);
  }

  return out;
}

async function imageWorks(url) {
  if (!/^https?:\/\//i.test(String(url || ""))) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": UA, Range: "bytes=0-4095" },
      signal: controller.signal,
    });
    return r.ok && /^image\//i.test(r.headers.get("content-type") || "");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function chooseImage(item, feedImages) {
  const candidates = [];
  if (item.img) candidates.push(item.img);

  const k = key(item.title);
  for (const x of feedImages) {
    if (x.k === k || x.k.includes(k) || k.includes(x.k)) candidates.push(x.img);
  }

  for (const url of candidates) {
    if (await imageWorks(url)) return url;
  }
  return "";
}

function buildOtt(results, previous, now) {
  const out = {};

  for (const source of SOURCES) {
    const fresh = results[source.id] || [];
    const valid = fresh.filter(x => x.title).slice(0, 10);

    // CRITICAL: a scraper failure must never erase the last successful dataset.
    if (valid.length > 0) {
      out[source.id] = {
        id: source.id,
        name: source.name,
        status: "ok",
        updatedAt: now,
        items: valid.map((x, i) => ({
          rank: i + 1,
          title: x.title,
          language: "Telugu",
          img: x.img,
          platform: source.name,
          releaseDate: x.releaseDate || "",
          languages: "Telugu",
        })),
        note: `Fresh Telugu-relevant titles collected from ${source.name}'s public source.`,
      };
    } else {
      const old = previous?.ottTrending?.[source.id];
      if (old?.items?.length) {
        out[source.id] = {
          ...old,
          status: "stale",
          lastAttemptedAt: now,
          note: `${source.name} source could not be read reliably on this run. Showing the last successful dataset instead of replacing it with zero.`,
        };
      } else {
        out[source.id] = {
          id: source.id,
          name: source.name,
          status: "unavailable",
          updatedAt: now,
          items: [],
          note: `No successful dataset is available yet for ${source.name}.`,
        };
      }
    }
  }

  return out;
}

async function main() {
  const feed = JSON.parse(await fs.readFile(FEED, "utf8"));

  let trends = { movies: [] };
  try { trends = JSON.parse(await fs.readFile(TRENDS, "utf8")); } catch {}

  let previous = null;
  try { previous = JSON.parse(await fs.readFile(OUTPUT, "utf8")); } catch {}

  const now = new Date().toISOString();
  const feedImages = feedImageIndex(feed, previous);

  const results = {};
  for (const source of SOURCES) {
    results[source.id] = await getSourceData(source);
    console.log(`${source.name}: ${results[source.id].length} extracted`);
  }

  // Resolve images without rejecting a title merely because the anchor did not
  // contain an <img>. This was one of the main causes of Netflix/ZEE5 = 0.
  for (const source of SOURCES) {
    const resolved = [];
    for (const item of results[source.id]) {
      const img = await chooseImage(item, feedImages);
      if (img) resolved.push({ ...item, img });
    }
    results[source.id] = resolved;
    console.log(`${source.name}: ${resolved.length} image-valid titles`);
  }

  const ottTrending = buildOtt(results, previous, now);

  // Preserve the existing Buzz movie calculation.
  const candidates = new Map();
  const add = (title, img, kind) => {
    title = clean(title);
    if (!title) return;
    const id = key(title);
    if (!id) return;
    const item = candidates.get(id) || {
      title, img: img || "", reviews: 0, trailers: 0, cinemas: 0, shows: 0
    };
    if (!item.img && img) item.img = img;
    if (kind === "review") item.reviews++;
    if (kind === "trailer") item.trailers++;
    if (kind === "theatre") {
      item.cinemas += 1;
      item.shows += 1;
    }
    candidates.set(id, item);
  };

  for (const x of feed.reviews || []) add(x.title || x.t || x.movie, x.img, "review");
  for (const x of feed.trailers || []) add(x.title || x.t, x.img, "trailer");
  for (const x of trends.movies || []) add(x.movie, x.img, "theatre");

  const news = feed.news || [];
  const buzz = [...candidates.values()]
    .filter(x => x.img)
    .map(x => {
      const k = key(x.title);
      const newsSignals = news.filter(n => {
        const t = key([n?.title || "", n?.summary || "", n?.dek || ""].join(" "));
        return t.includes(k) || (k.split(" ").filter(w => w.length > 2).filter(w => t.includes(w)).length >= Math.ceil(k.split(" ").length * .75));
      }).length;

      const score = Math.min(
        100,
        12 + Math.min(newsSignals * 10, 30) +
        Math.min(x.reviews * 10, 20) +
        Math.min(x.trailers * 5, 10) +
        Math.min(x.cinemas * 3, 30)
      );

      return {
        id: k.replace(/\s+/g, "-").slice(0, 100),
        title: x.title,
        img: x.img,
        language: "Telugu",
        buzzScore: Math.round(score),
        status: score >= 70 ? "HIGH BUZZ" : score >= 50 ? "RISING" : score < 30 ? "COOLING" : "STEADY",
        theatre: { cinemas: x.cinemas, shows: x.shows },
        sourceSignals: { news: newsSignals, reviews: x.reviews, trailers: x.trailers, theatreLocations: x.cinemas, theatreShows: x.shows }
      };
    })
    .sort((a, b) => b.buzzScore - a.buzzScore)
    .slice(0, 24);

  const payload = {
    updatedAt: now,
    language: "Telugu",
    tabs: [
      { id: "buzz", name: "Buzz Now", status: "active" },
      { id: "theatres", name: "Theatres Now", status: "ok" },
      ...SOURCES.map(s => ({
        id: s.id,
        name: s.name,
        status: ottTrending[s.id].status
      }))
    ],
    movies: buzz,
    ottTrending,
    methodology:
      "OTT data is collected independently per platform. No hard-coded movie list is used. A failed source read never overwrites the last successful OTT dataset with zero items. Netflix and ZEE5 use their dedicated Telugu catalogue pages; Prime Video verifies Telugu titles using catalogue/detail-page language evidence; other platforms publish only titles that can be reliably identified."
  };

  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log("Cineinsta Buzz updated.");
  for (const source of SOURCES) {
    const x = ottTrending[source.id];
    console.log(`${source.name}: ${x.items.length} titles (${x.status})`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
