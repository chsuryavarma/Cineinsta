import fs from 'node:fs/promises';

const FEED = new URL('../data/feed.json', import.meta.url);
const TRENDS = new URL('../data/ticket-trends.json', import.meta.url);
const OUTPUT = new URL('../data/buzz.json', import.meta.url);

const DIGIT_LATEST = 'https://www.digit.in/digit-binge/movies/telugu/latest/';
const USER_AGENT = 'Cineinsta Movie Data/1.0 (+https://www.cineinsta.com)';

const PLATFORMS = [
  { id: 'netflix', name: 'Netflix', match: /^netflix$/i },
  { id: 'prime-video', name: 'Prime Video', match: /^prime video$/i },
  { id: 'aha', name: 'Aha', match: /^aha$/i },
  { id: 'jiohotstar', name: 'JioHotstar', match: /^(jiohotstar|disney\+?hotstar|hotstar)$/i },
  { id: 'zee5', name: 'ZEE5', match: /^zee5$/i },
  { id: 'sun-nxt', name: 'Sun NXT', match: /^sun nxt$/i },
  { id: 'etv-win', name: 'ETV Win', match: /^etv win$/i },
  { id: 'sonyliv', name: 'SonyLIV', match: /^sonyliv$/i }
];

const PROVIDERS = [
  'Prime Video', 'Netflix', 'ZEE5', 'JioHotstar', 'Disney+Hotstar',
  'Hotstar', 'Aha', 'SonyLiv', 'SonyLIV', 'Sun NXT', 'ETV Win', 'Theatrical'
];

const GENRES = [
  'Suspense & Thriller', 'Dance and Music', 'Travel and Culture',
  'Reality based', 'Historical', 'Documentary', 'Animation', 'Adventure',
  'Superhero', 'Mythology', 'Fantasy', 'Mystery', 'Romance', 'Comedy',
  'Action', 'Drama', 'Crime', 'Horror', 'Family', 'Sci-Fi', 'Biopic',
  'Teenage', 'Sports', 'Devotional', 'Entertainment', 'Politics', 'Animal', 'Other'
];

function clean(v = '') {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
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

function key(v = '') {
  return clean(v)
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9\u0C00-\u0C7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(v = '') {
  return key(v).replace(/\s+/g, '-').slice(0, 100);
}

function strip(v = '') {
  return clean(
    decode(
      String(v ?? '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    )
  );
}

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  return decode(String(tag).match(re)?.[1] || '');
}

function abs(v, base) {
  try {
    return new URL(v, base).href;
  } catch {
    return '';
  }
}

function imageFromTag(tag) {
  const srcset = attr(tag, 'srcset');
  const raw =
    attr(tag, 'src') ||
    attr(tag, 'data-src') ||
    attr(tag, 'data-lazy-src') ||
    (srcset ? srcset.split(',').pop().trim().split(/\s+/)[0] : '');

  return abs(raw, DIGIT_LATEST);
}

function validImage(v) {
  return (
    /^https?:\/\//i.test(v || '') &&
    !/(logo|icon|sprite|placeholder|avatar|facebook|instagram|twitter|google_play|app_store)/i.test(v || '')
  );
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

function escapeRegExp(v) {
  return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTitle(text, alt) {
  if (alt && alt.length > 2 && !/image|poster/i.test(alt)) {
    return clean(alt);
  }

  let title = strip(text)
    .replace(/^\s*\d+(?:\.\d+)?\s+/, '')
    .replace(/\s*\|\s*20\d{2}.*$/, '');

  for (const provider of PROVIDERS) {
    title = title.replace(
      new RegExp(`\\s+${escapeRegExp(provider)}\\s*$`, 'i'),
      ''
    );
  }

  for (const genre of GENRES) {
    title = title.replace(
      new RegExp(`\\s+${escapeRegExp(genre)}\\s*$`, 'i'),
      ''
    );
  }

  return clean(title);
}

function provider(text) {
  const t = strip(text);

  return (
    PROVIDERS.find(providerName =>
      new RegExp(`\\b${escapeRegExp(providerName)}\\b`, 'i').test(t)
    ) || 'Theatrical'
  );
}

function genre(text) {
  const t = strip(text).toLowerCase();

  return GENRES.find(g => t.includes(g.toLowerCase())) || '';
}

function year(text) {
  const match = strip(text).match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function rating(text) {
  const match = strip(text).match(/^\s*(\d(?:\.\d+)?)\s+/);
  return match ? Number(match[1]) : null;
}

function parseMovies(html) {
  const output = [];
  const re =
    /<a\b[^>]*href=["']([^"']*\/digit-binge\/movies\/[^"']+\.html[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = re.exec(html))) {
    const href = abs(decode(match[1]), DIGIT_LATEST);
    const body = match[2];
    const imageTag = body.match(/<img\b[^>]*>/i)?.[0] || '';
    const rawText = strip(body);
    const title = parseTitle(rawText, attr(imageTag, 'alt'));
    const img = imageFromTag(imageTag);

    if (!title || title.length > 100 || !validImage(img)) continue;

    output.push({
      title,
      img,
      url: href,
      provider: provider(rawText),
      genre: genre(rawText),
      year: year(rawText),
      rating: rating(rawText)
    });
  }

  return unique(output);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function makeCard(movie, rank, platform) {
  return {
    rank,
    title: movie.title,
    language: 'Telugu',
    img: movie.img,
    url: movie.url,
    platform,
    genre: movie.genre || '',
    year: movie.year || null,
    rating: movie.rating || null
  };
}

async function main() {
  const feed = JSON.parse(await fs.readFile(FEED, 'utf8'));

  let trends = { movies: [] };
  try {
    trends = JSON.parse(await fs.readFile(TRENDS, 'utf8'));
  } catch {}

  const html = await fetchText(DIGIT_LATEST);
  const allMovies = parseMovies(html);

  console.log(`Parsed ${allMovies.length} Telugu movie records.`);

  const ottTrending = {};

  for (const platform of PLATFORMS) {
    const items = allMovies
      .filter(movie => platform.match.test(movie.provider || ''))
      .slice(0, 12)
      .map((movie, index) => makeCard(movie, index + 1, platform.name));

    ottTrending[platform.id] = {
      id: platform.id,
      name: platform.name,
      status: items.length ? 'ok' : 'unavailable',
      sourceUrl: DIGIT_LATEST,
      updatedAt: new Date().toISOString(),
      items,
      note: items.length
        ? `Latest Telugu movies currently listed with ${platform.name} availability.`
        : `No matching latest Telugu movie records with usable images were found.`
    };

    console.log(`${platform.name}: ${items.length}`);
  }

  const theatres = allMovies
    .filter(movie => /^theatrical$/i.test(movie.provider || ''))
    .slice(0, 12)
    .map((movie, index) => makeCard(movie, index + 1, 'Theatrical'));

  ottTrending.theatres = {
    id: 'theatres',
    name: 'Theatres Now',
    status: theatres.length ? 'ok' : 'unavailable',
    sourceUrl: DIGIT_LATEST,
    updatedAt: new Date().toISOString(),
    items: theatres,
    note: theatres.length
      ? 'Latest Telugu movies currently listed as theatrical.'
      : 'No matching theatrical records with usable images were found.'
  };

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

    const item =
      candidates.get(id) || {
        title,
        img: img || '',
        reviews: 0,
        trailers: 0,
        cinemas: 0,
        shows: 0
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
    const a = key(title);
    const b = key(text);

    if (!a || !b) return false;
    if (b.includes(a) || a.includes(b)) return true;

    const tokens = a.split(' ').filter(token => token.length > 2);
    return (
      tokens.length > 1 &&
      tokens.filter(token => b.includes(token)).length / tokens.length >= 0.75
    );
  }

  const buzz = [...candidates.values()]
    .filter(item => item.img)
    .map(item => {
      const newsSignals = news.filter(newsItem =>
        matches(
          item.title,
          [
            newsItem?.title || '',
            newsItem?.summary || '',
            newsItem?.dek || ''
          ].join(' ')
        )
      ).length;

      const buzzScore = Math.round(
        Math.min(
          100,
          12 +
            Math.min(newsSignals * 10, 30) +
            Math.min(item.reviews * 10, 20) +
            Math.min(item.trailers * 5, 10) +
            Math.min(item.cinemas * 3, 30) +
            Math.min(item.shows * 0.4, 18)
        )
      );

      return {
        id: slug(item.title),
        title: item.title,
        img: item.img,
        language: 'Telugu',
        buzzScore,
        status:
          buzzScore >= 70
            ? 'HIGH BUZZ'
            : buzzScore >= 50
              ? 'RISING'
              : buzzScore < 30
                ? 'COOLING'
                : 'STEADY',
        theatre: {
          cinemas: item.cinemas,
          shows: item.shows
        },
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
    { id: 'theatres', name: 'Theatres Now', status: ottTrending.theatres.status },
    ...PLATFORMS.map(platform => ({
      id: platform.id,
      name: platform.name,
      status: ottTrending[platform.id].status
    }))
  ];

  const payload = {
    updatedAt: new Date().toISOString(),
    language: 'Telugu',
    tabs,
    movies: buzz,
    ottTrending,
    methodology:
      'OTT and theatre tabs use the latest Telugu movie availability data and filter it by the listed streaming or theatrical field. Cineinsta does not create OTT rankings or scores.'
  };

  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log('Cineinsta Buzz data written successfully.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
