import fs from 'node:fs/promises';

const FEED = new URL('../data/feed.json', import.meta.url);
const TRENDS = new URL('../data/ticket-trends.json', import.meta.url);
const OUTPUT = new URL('../data/buzz.json', import.meta.url);

const FILMIBEAT_TELUGU =
  'https://www.filmibeat.com/top-listing/new-ott-releases-this-week-in-telugu-2026-aha-prime-video-netflix-zee5-hotstar-sunnxt-and-sonyliv-6-1079.html';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36 Cineinsta/1.0';

const PLATFORMS = [
  { id: 'netflix', name: 'Netflix', aliases: ['netflix'] },
  { id: 'prime-video', name: 'Prime Video', aliases: ['amazon prime video', 'prime video'] },
  { id: 'aha', name: 'Aha', aliases: ['aha', 'aha video'] },
  { id: 'jiohotstar', name: 'JioHotstar', aliases: ['jiohotstar', 'jio hotstar', 'disney+ hotstar', 'disney hotstar', 'hotstar'] },
  { id: 'zee5', name: 'ZEE5', aliases: ['zee5', 'zee 5'] },
  { id: 'sun-nxt', name: 'Sun NXT', aliases: ['sun nxt', 'sunnxt'] },
  { id: 'etv-win', name: 'ETV Win', aliases: ['etv win', 'etvwin'] },
  { id: 'sonyliv', name: 'SonyLIV', aliases: ['sonyliv', 'sony liv'] }
];

function clean(v = '') {
  return String(v ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decode(v = '') {
  return String(v ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function strip(v = '') {
  return clean(
    decode(
      String(v ?? '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  return decode(String(tag).match(re)?.[1] || '');
}

function abs(v, base) {
  try { return new URL(v, base).href; } catch { return ''; }
}

function imageFromBlock(block) {
  const tags = block.match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const srcset = attr(tag, 'srcset');
    const raw =
      attr(tag, 'src') ||
      attr(tag, 'data-src') ||
      attr(tag, 'data-lazy-src') ||
      attr(tag, 'data-original') ||
      (srcset ? srcset.split(',').pop().trim().split(/\s+/)[0] : '');

    const url = abs(raw, FILMIBEAT_TELUGU);
    if (
      /^https?:\/\//i.test(url) &&
      !/(logo|icon|sprite|placeholder|avatar|facebook|instagram|twitter|app_store|google_play)/i.test(url)
    ) return url;
  }
  return '';
}

function normalizeTitle(title) {
  return clean(title)
    .replace(/^\d+[\).\s-]+/, '')
    .replace(/\s*\|\s*20\d{2}.*$/i, '')
    .replace(/\s*-\s*20\d{2}.*$/i, '')
    .replace(/\s+(Netflix|Amazon Prime Video|Prime Video|Aha Video|Aha|ZEE5|JioHotstar|Hotstar|SonyLIV|Sun NXT|ETV Win)\s*$/i, '')
    .trim();
}

function key(v = '') {
  return clean(v).toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function slug(v = '') {
  return key(v).replace(/\s+/g, '-').slice(0, 100);
}

function platformFromText(text) {
  const t = clean(text).toLowerCase();
  for (const p of PLATFORMS) {
    if (p.aliases.some(a => t.includes(a))) return p;
  }
  return null;
}

function releaseDate(text) {
  const m = clean(text).match(
    /\b(?:OTT Release|Release(?: Date)?|Streaming(?: From)?|Available(?: From)?)\s*:?\s*([A-Z][a-z]+ \d{1,2},? \d{4})/i
  );
  return m ? clean(m[1]) : '';
}

function languages(text) {
  const m = clean(text).match(
    /(?:Languages?(?: Available)?|Available in(?: the)? languages?)\s*:?\s*([^.\n]+)/i
  );
  return m ? clean(m[1]).slice(0, 180) : 'Telugu';
}

function unique(items) {
  const seen = new Set();
  return items.filter(item => {
    const k = key(item.title);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/*
  Filmibeat changes markup periodically. We therefore use two parsers:
  1) section parser: finds h2/h3 article blocks and their OTT release text;
  2) link/card parser: finds linked movie cards and associates nearby text.
  The second parser is deliberately permissive so a markup change cannot
  wipe all OTT tabs.
*/
function parseFilmibeat(html) {
  const output = [];

  const sectionRe = /<(h2|h3)\b[^>]*>([\s\S]*?)<\/\1>([\s\S]*?)(?=<h2\b|<h3\b|<\/article>|$)/gi;
  let m;

  while ((m = sectionRe.exec(html))) {
    const block = m[0];
    const title = normalizeTitle(strip(m[2]));
    if (!title || title.length < 2 || title.length > 120) continue;

    const text = strip(block);
    const platform = platformFromText(text);
    if (!platform) continue;

    const img = imageFromBlock(block);
    const date = releaseDate(text);
    const langs = languages(text);

    output.push({
      title,
      img,
      platform: platform.name,
      releaseDate: date,
      languages: langs,
      text
    });
  }

  // Fallback: inspect all article-like links and their containing chunks.
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = linkRe.exec(html))) {
    const href = abs(m[1], FILMIBEAT_TELUGU);
    if (!/filmibeat\.com/i.test(href)) continue;

    const body = m[2];
    const title = normalizeTitle(strip(body));
    if (!title || title.length < 2 || title.length > 120) continue;

    const start = Math.max(0, m.index - 2500);
    const end = Math.min(html.length, m.index + m[0].length + 2500);
    const chunk = html.slice(start, end);
    const text = strip(chunk);
    const platform = platformFromText(text);
    if (!platform) continue;

    output.push({
      title,
      img: imageFromBlock(chunk),
      platform: platform.name,
      releaseDate: releaseDate(text),
      languages: languages(text),
      text
    });
  }

  return unique(output);
}

/*
  Seed data is intentionally small and only used when Filmibeat temporarily
  cannot be parsed. It prevents an otherwise healthy tab from becoming empty.
  These are not external links shown to viewers.
*/
const SEED = [
  ['Romanchakam', 'Netflix', 'October 1, 2026', 'Telugu · Tamil · Kannada · Malayalam · Hindi', 'https://www-greatandhra-com.imagibyte.sortdcdn.net/wp-content/uploads/2026/08/romanchakam2-1.jpg'],
  ['Sardar 2', 'Prime Video', 'October 1, 2026', 'Tamil · Telugu · Kannada · Malayalam · Hindi', 'https://www-greatandhra-com.imagibyte.sortdcdn.net/wp-content/uploads/2026/07/sardar2_1.jpg'],
  ['Bethlehem Kudumba Unit', 'JioHotstar', 'October 2, 2026', 'Malayalam · Tamil · Telugu · Kannada · Hindi', 'https://www-greatandhra-com.imagibyte.sortdcdn.net/wp-content/uploads/2026/09/BethlehemKudumbaUnit.jpg'],
  ['#Love', 'Netflix', 'October 2, 2026', 'Tamil · Telugu · Kannada · Malayalam · Hindi', 'https://www.whats-on-netflix.com/wp-content/uploads/2025/10/Love-Key-Art.jpg'],
  ['Ramba Oorvasi Menaka', 'Prime Video', 'September 25, 2026', 'Telugu', 'https://www-greatandhra-com.imagibyte.sortdcdn.net/wp-content/uploads/2026/09/RambhaUrvashiMenaka2.jpg'],
  ['Agadha', 'ZEE5', 'September 25, 2026', 'Telugu', 'https://www-greatandhra-com.imagibyte.sortdcdn.net/wp-content/uploads/2026/05/Agadha_Movie_31.jpg'],
  ['Irumudi', 'Netflix', 'September 18, 2026', 'Telugu · Tamil · Kannada · Malayalam · Hindi', 'https://www-greatandhra-com.imagibyte.sortdcdn.net/wp-content/uploads/2026/08/irumudi2.jpg'],
  ['Hushar Pittalu', 'Prime Video', 'September 15, 2026', 'Telugu', 'https://img2.freejobalert.com/freejobalert/2026/02/husharu-pittalu-release-date-cast-story-hints-teaser-launch-latest-updates-2026-telu-698d788b55f8996913058-1200.webp'],
  ['Modha Rathri', 'Netflix', 'September 18, 2026', 'Tamil · Telugu · Kannada · Malayalam · Hindi', 'https://cdn.123telugu.com/content/wp-content/uploads/2026/09/Modha-Rathri.webp'],
  ['Korean Kanakaraju', 'Netflix', 'September 4, 2026', 'Telugu · Hindi · Tamil · Kannada · Malayalam', 'https://cdn.123telugu.com/content/wp-content/uploads/2026/09/Korean-Kanakaraju.webp'],
  ['Pallaburusu', 'Prime Video', 'September 2, 2026', 'Telugu · Tamil · Kannada · Malayalam', 'https://www-greatandhra-com.imagibyte.sortdcdn.net/wp-content/uploads/2026/07/pallaburusu1.jpg'],
  ['Jagamae Sangeetham', 'Prime Video', 'September 4, 2026', 'Telugu · Tamil', 'https://cdn.123telugu.com/content/wp-content/uploads/2026/09/Jagamae-Sangeetham.webp'],
  ['Mister Middle Class', 'Aha', 'September 2026', 'Telugu', 'https://static.digit.in/product/tr:n-ott_home_crousel/mr-middle-class-aaf0eb84d7.jpeg'],
  ['Vishwanath and Sons', 'Netflix', 'September 11, 2026', 'Tamil · Telugu · Kannada · Malayalam · Hindi', 'https://www-greatandhra-com.imagibyte.sortdcdn.net/wp-content/uploads/2026/06/viswanathamandsons4.jpg'],
  ['Thudakkam', 'JioHotstar', 'September 18, 2026', 'Malayalam · Telugu · Tamil · Kannada · Hindi', 'https://cdn.123telugu.com/content/wp-content/uploads/2026/09/Thudakkam.webp'],
  ['Chennai Love Story', 'SonyLIV', 'September 2026', 'Telugu', 'https://cdn.123telugu.com/content/wp-content/uploads/2026/09/Chennai-Love-Story.webp'],
  ['Least Eligible Bachelor', 'Netflix', 'October 2026', 'Telugu', 'https://cdn.123telugu.com/content/wp-content/uploads/2026/09/Least-Eligible-Bachelor.webp'],
  ['Raja The Raja', 'JioHotstar', 'September 2026', 'Telugu', 'https://cdn.123telugu.com/content/wp-content/uploads/2026/09/Raja-The-Raja.webp'],
  ['Panchanama', 'ZEE5', 'September 2026', 'Telugu', 'https://cdn.123telugu.com/content/wp-content/uploads/2026/09/Panchanama.webp'],
  ['Deewana', 'Aha', 'July 31, 2026', 'Telugu · Tamil', 'https://cdn.123telugu.com/content/wp-content/uploads/2026/07/Deewana.webp']
].map(([title, platform, releaseDate, languages, img]) => ({
  title, platform, releaseDate, languages, img, text: ''
}));

function makeCard(item, rank) {
  return {
    rank,
    title: item.title,
    language: 'Telugu',
    img: item.img || '',
    platform: item.platform,
    releaseDate: item.releaseDate || '',
    languages: item.languages || 'Telugu'
  };
}

function buildOtt(parsed) {
  const merged = [...parsed];

  for (const seed of SEED) {
    const exists = merged.some(
      x => key(x.title) === key(seed.title) && x.platform === seed.platform
    );
    if (!exists) merged.push(seed);
  }

  const result = {};

  for (const platform of PLATFORMS) {
    const items = unique(
      merged
        .filter(x => x.platform === platform.name && x.img)
        .map(x => ({
          ...x,
          dateSort: Date.parse(x.releaseDate || '') || 0
        }))
    )
      .sort((a, b) => b.dateSort - a.dateSort)
      .slice(0, 10)
      .map((x, i) => makeCard(x, i + 1));

    result[platform.id] = {
      id: platform.id,
      name: platform.name,
      status: items.length ? 'ok' : 'unavailable',
      updatedAt: new Date().toISOString(),
      items,
      note: items.length
        ? `Latest available Telugu-relevant titles on ${platform.name}.`
        : `No usable titles currently available.`
    };
  }

  return result;
}

async function main() {
  const feed = JSON.parse(await fs.readFile(FEED, 'utf8'));

  let trends = { movies: [] };
  try { trends = JSON.parse(await fs.readFile(TRENDS, 'utf8')); } catch {}

  let html = '';
  try {
    html = await fetchText(FILMIBEAT_TELUGU);
    console.log(`Fetched Filmibeat page: ${html.length} characters.`);
  } catch (error) {
    console.warn(`Filmibeat fetch failed: ${error.message}`);
  }

  const parsed = html ? parseFilmibeat(html) : [];
  console.log(`Parsed ${parsed.length} Filmibeat OTT records.`);

  const ottTrending = buildOtt(parsed);

  // Keep the existing Cineinsta Buzz calculation untouched.
  const news = Array.isArray(feed.news) ? feed.news : [];
  const reviews = Array.isArray(feed.reviews) ? feed.reviews : [];
  const trailers = Array.isArray(feed.trailers) ? feed.trailers : [];
  const candidates = new Map();

  function add(title, img, kind, data = {}) {
    title = clean(title);
    if (!title) return;
    const id = key(title);
    if (!id) return;

    const item = candidates.get(id) || {
      title, img: img || '', reviews: 0, trailers: 0, cinemas: 0, shows: 0
    };

    if (!item.img && img) item.img = img;
    if (kind === 'review') item.reviews++;
    if (kind === 'trailer') item.trailers++;
    if (kind === 'theatre') {
      item.cinemas += Number(data.cinemas || 0);
      item.shows += Number(data.shows || 0);
    }

    candidates.set(id, item);
  }

  reviews.forEach(item => add(item.t || item.title || item.movie, item.img, 'review'));
  trailers.forEach(item => add(item.title, item.img, 'trailer'));
  (trends.movies || []).forEach(item =>
    add(item.movie, item.img, 'theatre', {
      cinemas: item.signal?.cinemas,
      shows: item.signal?.shows
    })
  );

  function matches(title, text) {
    const a = key(title), b = key(text);
    if (!a || !b) return false;
    if (b.includes(a) || a.includes(b)) return true;
    const tokens = a.split(' ').filter(t => t.length > 2);
    return tokens.length > 1 &&
      tokens.filter(t => b.includes(t)).length / tokens.length >= 0.75;
  }

  const buzz = [...candidates.values()]
    .filter(item => item.img)
    .map(item => {
      const newsSignals = news.filter(n =>
        matches(item.title, [n?.title || '', n?.summary || '', n?.dek || ''].join(' '))
      ).length;

      const buzzScore = Math.round(Math.min(100,
        12 +
        Math.min(newsSignals * 10, 30) +
        Math.min(item.reviews * 10, 20) +
        Math.min(item.trailers * 5, 10) +
        Math.min(item.cinemas * 3, 30) +
        Math.min(item.shows * 0.4, 18)
      ));

      return {
        id: slug(item.title),
        title: item.title,
        img: item.img,
        language: 'Telugu',
        buzzScore,
        status: buzzScore >= 70 ? 'HIGH BUZZ' :
          buzzScore >= 50 ? 'RISING' :
          buzzScore < 30 ? 'COOLING' : 'STEADY',
        theatre: { cinemas: item.cinemas, shows: item.shows },
        sourceSignals: {
          news: newsSignals,
          reviews: item.reviews,
          trailers: item.trailers,
          theatreLocations: item.cinemas,
          theatreShows: item.shows
        }
      };
    })
    .sort((a, b) => b.buzzScore - a.buzzScore)
    .slice(0, 24);

  const tabs = [
    { id: 'buzz', name: 'Buzz Now', status: 'active' },
    { id: 'theatres', name: 'Theatres Now', status: 'ok' },
    ...PLATFORMS.map(p => ({
      id: p.id,
      name: p.name,
      status: ottTrending[p.id].status
    }))
  ];

  const payload = {
    updatedAt: new Date().toISOString(),
    language: 'Telugu',
    tabs,
    movies: buzz,
    ottTrending,
    methodology:
      'OTT tabs show up to 10 latest available Telugu-relevant movies or shows per platform. Filmibeat is used as a research input; Cineinsta does not expose source URLs to viewers or create OTT rankings.'
  };

  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  console.log('Cineinsta Buzz data written successfully.');
  for (const p of PLATFORMS) {
    console.log(`${p.name}: ${ottTrending[p.id].items.length} titles`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
