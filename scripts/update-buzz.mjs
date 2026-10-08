import fs from 'node:fs/promises';

const FEED = new URL('../data/feed.json', import.meta.url);
const TRENDS = new URL('../data/ticket-trends.json', import.meta.url);
const OUTPUT = new URL('../data/buzz.json', import.meta.url);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36 Cineinsta/1.0';

const OTT_SOURCES = [
  {
    id: 'netflix',
    name: 'Netflix',
    url: 'https://www.netflix.com/in/browse/genre/34399',
    secondaryUrls: [
      'https://www.netflix.com/in/browse/genre/81610866',
      'https://www.netflix.com/tudum/top10/india/films'
    ],
    mode: 'netflix'
  },
  {
    id: 'prime-video',
    name: 'Prime Video',
    url: 'https://www.primevideo.com/-/en/movie?tr=is',
    mode: 'prime'
  },
  {
    id: 'aha',
    name: 'Aha',
    url: 'https://www.aha.video/telugu/movies',
    mode: 'aha'
  },
  {
    id: 'jiohotstar',
    name: 'JioHotstar',
    url: 'https://www.hotstar.com/in/cinema',
    mode: 'jiohotstar'
  },
  {
    id: 'zee5',
    name: 'ZEE5',
    url: 'https://www.zee5.com/movies/lang/telugu',
    secondaryUrls: [
      'https://www.zee5.com/collections/telugu/0-8-3z5553078'
    ],
    mode: 'zee5'
  },
  {
    id: 'sun-nxt',
    name: 'Sun NXT',
    url: 'https://www.sunnxt.com/movie/inside/telugu-movies?actioURL=true&publishid=45&title=Telugu+Movies&type=movie',
    mode: 'sunnxt'
  },
  {
    id: 'etv-win',
    name: 'ETV Win',
    url: 'https://www.etvwin.com/',
    mode: 'etvwin'
  },
  {
    id: 'sonyliv',
    name: 'SonyLIV',
    url: 'https://www.sonyliv.com/?lang=en',
    mode: 'sonyliv'
  }
];

const PLATFORM_ALIASES = {
  netflix: ['netflix'],
  'prime-video': ['prime video', 'amazon prime'],
  aha: ['aha'],
  jiohotstar: ['jiohotstar', 'jio hotstar', 'hotstar', 'disney+ hotstar'],
  zee5: ['zee5', 'zee 5'],
  'sun-nxt': ['sun nxt', 'sunnxt'],
  'etv-win': ['etv win', 'etvwin'],
  sonyliv: ['sonyliv', 'sony liv']
};

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
    .replace(/&#x27;/gi, "'")
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
  try {
    return new URL(v, base).href;
  } catch {
    return '';
  }
}

function key(v = '') {
  return clean(decode(v))
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(v = '') {
  return key(v)
    .replace(/[^\p{ASCII}]/gu, '')
    .replace(/\s+/g, '-')
    .slice(0, 100);
}

function normalizeTitle(title) {
  const value = clean(title)
    .replace(/^\d+[\).\s-]+/, '')
    .replace(/\s*\|\s*20\d{2}.*$/i, '')
    .replace(/\s*-\s*20\d{2}.*$/i, '')
    .trim();

  if (!value || value.length < 2 || value.length > 140) return '';
  if (/^(home|movies?|movie|series|shows?|watch now|subscribe|login|sign in|more|previous|next|top 10|top listing|latest movies?|latest ott releases?|ott releases?|this week|read more|advertisement|release date)$/i.test(value)) {
    return '';
  }
  return value;
}

function isTeluguText(text = '') {
  return /[\u0C00-\u0C7F]/.test(String(text));
}

function unique(items) {
  const seen = new Set();
  return items.filter(item => {
    const k = `${key(item.title)}|${item.platform || ''}`;
    if (!key(item.title) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function fetchText(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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

async function imageWorks(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Range': 'bytes=0-4095'
      },
      signal: controller.signal
    });

    if (!response.ok) return false;

    const type = String(response.headers.get('content-type') || '').toLowerCase();
    return type.startsWith('image/') ||
      /^(application\/octet-stream|binary\/octet-stream)/i.test(type);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function imageFromBlock(block, baseUrl) {
  const tags = block.match(/<img\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const srcset = attr(tag, 'srcset');
    const raw =
      attr(tag, 'src') ||
      attr(tag, 'data-src') ||
      attr(tag, 'data-lazy-src') ||
      attr(tag, 'data-original') ||
      (srcset ? srcset.split(',').pop().trim().split(/\s+/)[0] : '');

    const url = abs(raw, baseUrl);

    if (!/^https?:\/\//i.test(url)) continue;
    if (/(logo|icon|sprite|placeholder|avatar|facebook|instagram|twitter|app_store|google_play|promo|banner|advert|ads?[-_])/i.test(url)) continue;

    return url;
  }

  return '';
}

function extractAnchors(html, baseUrl, platform) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  let count = 0;

  while ((m = re.exec(html)) && count < 600) {
    const href = abs(m[1], baseUrl);
    const body = m[2];
    const title = normalizeTitle(strip(body));

    if (!title) continue;

    const img = imageFromBlock(body, baseUrl);
    if (!img) continue;

    out.push({
      title,
      img,
      url: href,
      platform: platform.name,
      text: strip(body)
    });

    count++;
  }

  return unique(out);
}

function extractHeadings(html, baseUrl, platform) {
  const out = [];
  const re = /<(h1|h2|h3|h4|h5)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;

  while ((m = re.exec(html))) {
    const title = normalizeTitle(strip(m[2]));
    if (!title) continue;

    const block = html.slice(
      Math.max(0, m.index - 1200),
      Math.min(html.length, re.lastIndex + 2200)
    );

    const img = imageFromBlock(block, baseUrl);
    if (!img) continue;

    out.push({
      title,
      img,
      platform: platform.name,
      text: strip(block).slice(0, 2500)
    });
  }

  return unique(out);
}

function parseJsonLd(html, baseUrl, platform) {
  const out = [];
  const scripts =
    html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    const title = normalizeTitle(
      node.name || node.headline || node.itemOffered?.name || ''
    );

    let image = node.image;
    if (Array.isArray(image)) image = image[0];
    if (image && typeof image === 'object') image = image.url;

    if (title && image) {
      const img = abs(String(image), baseUrl);
      if (img) {
        out.push({
          title,
          img,
          platform: platform.name,
          text: JSON.stringify(node).slice(0, 3000)
        });
      }
    }

    Object.values(node).forEach(walk);
  }

  for (const script of scripts) {
    const raw = script
      .replace(/^<script[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();

    try {
      walk(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON-LD.
    }
  }

  return unique(out);
}

/* -------------------- NETFLIX -------------------- */

function parseNetflixTop10(html, source) {
  const out = [];
  const anchors = extractAnchors(html, source.url, source);
  const headings = extractHeadings(html, source.url, source);

  [...anchors, ...headings].forEach((item, index) => {
    const text = `${item.title} ${item.text}`;
    out.push({
      ...item,
      rank: index + 1,
      netflixTop10: true,
      text
    });
  });

  return unique(out);
}

function parseNetflixTeluguCatalogue(html, source) {
  const out = [];

  for (const item of [
    ...extractAnchors(html, source.url, source),
    ...extractHeadings(html, source.url, source),
    ...parseJsonLd(html, source.url, source)
  ]) {
    if (!item.title) continue;
    out.push({
      ...item,
      netflixTelugu: true
    });
  }

  return unique(out);
}

/* -------------------- PRIME VIDEO -------------------- */

function primeLooksTelugu(text = '', title = '') {
  const t = `${title} ${text}`;

  if (isTeluguText(t)) return true;
  if (/\((?:telugu|telugu audio)\)/i.test(t)) return true;
  if (/\b(?:audio languages|languages)\b[\s\S]{0,300}\btelugu\b/i.test(t)) return true;
  if (/\bతెలుగు\b/.test(t)) return true;

  return false;
}

async function enrichPrimeCandidate(item) {
  if (primeLooksTelugu(item.text, item.title)) {
    return { ...item, verifiedTelugu: true };
  }

  if (!item.url || !/primevideo\.com/i.test(item.url)) {
    return null;
  }

  try {
    const detail = await fetchText(item.url, 18000);

    if (!primeLooksTelugu(detail, item.title)) {
      return null;
    }

    const detailImage = imageFromBlock(detail, item.url);

    return {
      ...item,
      img: detailImage || item.img,
      verifiedTelugu: true,
      text: `${item.text} ${strip(detail).slice(0, 5000)}`
    };
  } catch {
    return null;
  }
}

async function parsePrime(html, source) {
  const candidates = [
    ...extractAnchors(html, source.url, source),
    ...extractHeadings(html, source.url, source),
    ...parseJsonLd(html, source.url, source)
  ];

  const uniqueCandidates = unique(candidates).slice(0, 80);
  const verified = [];

  for (const item of uniqueCandidates) {
    const result = await enrichPrimeCandidate(item);
    if (result) verified.push(result);
  }

  return unique(verified).slice(0, 20);
}

/* -------------------- ZEE5 -------------------- */

function parseZee5(html, source) {
  const candidates = [
    ...extractAnchors(html, source.url, source),
    ...extractHeadings(html, source.url, source),
    ...parseJsonLd(html, source.url, source)
  ];

  return unique(
    candidates.filter(item => {
      const text = `${item.title} ${item.text}`;
      return !/home|login|subscribe|watch now|previous|next|genre|language/i.test(item.title) &&
        (isTeluguText(text) || /telugu|తెలుగు/i.test(text) || source.url.includes('/lang/telugu') || source.url.includes('/collections/telugu/'));
    })
  ).slice(0, 20);
}

/* -------------------- OTHER OTT SOURCES -------------------- */

function parseRegionalSource(html, source) {
  const candidates = [
    ...extractAnchors(html, source.url, source),
    ...extractHeadings(html, source.url, source),
    ...parseJsonLd(html, source.url, source)
  ];

  return unique(
    candidates.filter(item => {
      const title = item.title.toLowerCase();
      if (/^(home|movies?|series|shows?|watch now|subscribe|login|sign in|more|previous|next|popular|trending|featured)$/.test(title)) {
        return false;
      }

      // For explicitly Telugu catalogue pages, the page itself establishes
      // the language context. Do not require the word "Telugu" on every card.
      return true;
    })
  ).slice(0, 20);
}

async function getPlatformData(source) {
  try {
    const primary = await fetchText(source.url);
    let records = [];

    if (source.mode === 'netflix') {
      records = parseNetflixTeluguCatalogue(primary, source);

      for (const url of source.secondaryUrls || []) {
        try {
          const html = await fetchText(url);
          const secondary =
            url.includes('/tudum/top10/')
              ? parseNetflixTop10(html, { ...source, url })
              : parseNetflixTeluguCatalogue(html, { ...source, url });

          records = unique([...records, ...secondary]);
        } catch (error) {
          console.warn(`Netflix secondary source failed: ${url} — ${error.message}`);
        }
      }

      // Prefer titles that appear in Netflix's current Top 10 when available.
      const top10Url = (source.secondaryUrls || []).find(url => url.includes('/tudum/top10/'));
      if (top10Url) {
        try {
          const topHtml = await fetchText(top10Url);
          const top = parseNetflixTop10(topHtml, { ...source, url: top10Url });
          const topKeys = new Set(top.map(x => key(x.title)));

          const ranked = records
            .filter(x => topKeys.has(key(x.title)))
            .map(x => ({
              ...x,
              rank: top.find(y => key(y.title) === key(x.title))?.rank || 99
            }))
            .sort((a, b) => a.rank - b.rank);

          if (ranked.length) records = unique([...ranked, ...records]);
        } catch {}
      }
    } else if (source.mode === 'prime') {
      records = await parsePrime(primary, source);
    } else if (source.mode === 'zee5') {
      records = parseZee5(primary, source);

      for (const url of source.secondaryUrls || []) {
        try {
          const html = await fetchText(url);
          records = unique([
            ...records,
            ...parseZee5(html, { ...source, url })
          ]);
        } catch {}
      }
    } else {
      records = parseRegionalSource(primary, source);
    }

    return records.filter(x => x.title && x.img).slice(0, 20);
  } catch (error) {
    console.warn(`${source.name}: source unavailable — ${error.message}`);
    return [];
  }
}

function makeOttCard(item, platform, rank) {
  return {
    rank,
    title: item.title,
    language: 'Telugu',
    img: item.img,
    platform: platform.name,
    releaseDate: item.releaseDate || '',
    languages: item.languages || 'Telugu'
  };
}

function buildOtt(results) {
  const output = {};

  for (const platform of OTT_SOURCES) {
    const records = unique(results[platform.id] || [])
      .filter(item => item.img)
      .slice(0, 10);

    output[platform.id] = {
      id: platform.id,
      name: platform.name,
      status: records.length ? 'ok' : 'unavailable',
      updatedAt: new Date().toISOString(),
      items: records.map((item, index) =>
        makeOttCard(item, platform, item.rank || index + 1)
      ),
      note: records.length
        ? `Current Telugu-relevant titles surfaced from ${platform.name}'s public catalogue/trending page.`
        : `No reliable Telugu movie data could be extracted from ${platform.name}'s current public source.`
    };
  }

  return output;
}

/* -------------------- EXISTING CINEINSTA BUZZ LOGIC -------------------- */

function buildImageIndex(feed, ottTrending) {
  const records = [];
  const add = (title, img, source) => {
    if (title && img && /^https?:\/\//i.test(String(img).trim())) {
      records.push({
        title: String(title),
        img: String(img).trim(),
        source
      });
    }
  };

  for (const item of Array.isArray(feed.news) ? feed.news : []) {
    add(item.title || item.t, item.img, 'news');
  }

  for (const item of Array.isArray(feed.reviews) ? feed.reviews : []) {
    add(item.t || item.title || item.movie, item.img, 'reviews');
  }

  for (const item of Array.isArray(feed.trailers) ? feed.trailers : []) {
    add(item.title || item.t, item.img, 'trailers');
  }

  for (const item of Object.values(ottTrending || {}).flatMap(x => x.items || [])) {
    add(item.title, item.img, 'ott');
  }

  return records;
}

function imageCandidatesForTitle(title, imageIndex, youtubeId = '') {
  const wanted = key(title);
  const candidates = [];

  if (!wanted) return candidates;

  for (const x of imageIndex.filter(x => key(x.title) === wanted)) {
    if (!candidates.some(y => y.url === x.img)) {
      candidates.push({ url: x.img, source: x.source });
    }
  }

  if (youtubeId) {
    candidates.push({
      url: `https://i.ytimg.com/vi/${encodeURIComponent(youtubeId)}/hqdefault.jpg`,
      source: 'youtube'
    });
  }

  return candidates;
}

async function resolveBestImage(title, suppliedImage, imageIndex, youtubeId = '') {
  const candidates = [];

  if (suppliedImage) {
    candidates.push({
      url: String(suppliedImage).trim(),
      source: 'platform'
    });
  }

  for (const candidate of imageCandidatesForTitle(title, imageIndex, youtubeId)) {
    if (!candidates.some(x => x.url === candidate.url)) {
      candidates.push(candidate);
    }
  }

  for (const candidate of candidates.slice(0, 10)) {
    if (await imageWorks(candidate.url)) {
      return {
        img: candidate.url,
        imageSource: candidate.source
      };
    }
  }

  return { img: '', imageSource: '' };
}

async function main() {
  const feed = JSON.parse(await fs.readFile(FEED, 'utf8'));

  let trends = { movies: [] };
  try {
    trends = JSON.parse(await fs.readFile(TRENDS, 'utf8'));
  } catch {}

  const results = Object.fromEntries(
    OTT_SOURCES.map(source => [source.id, []])
  );

  for (const source of OTT_SOURCES) {
    results[source.id] = await getPlatformData(source);
    console.log(
      `${source.name}: ${results[source.id].length} reliable candidates`
    );
  }

  const ottTrending = buildOtt(results);

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
      title,
      img: '',
      youtubeId: '',
      reviews: 0,
      trailers: 0,
      cinemas: 0,
      shows: 0
    };

    if (!item.img && img) item.img = String(img).trim();
    if (data.youtubeId && !item.youtubeId) item.youtubeId = String(data.youtubeId);

    if (kind === 'review') item.reviews++;
    if (kind === 'trailer') item.trailers++;

    if (kind === 'theatre') {
      item.cinemas += Number(data.cinemas || 0);
      item.shows += Number(data.shows || 0);
    }

    candidates.set(id, item);
  }

  reviews.forEach(item =>
    add(
      item.t || item.title || item.movie,
      item.img,
      'review',
      { youtubeId: item.youtubeId || item.videoId || '' }
    )
  );

  trailers.forEach(item =>
    add(
      item.title || item.t,
      item.img,
      'trailer',
      { youtubeId: item.youtubeId || item.videoId || '' }
    )
  );

  (trends.movies || []).forEach(item =>
    add(
      item.movie,
      item.img,
      'theatre',
      {
        cinemas: item.signal?.cinemas,
        shows: item.signal?.shows
      }
    )
  );

  const imageIndex = buildImageIndex(feed, ottTrending);

  let resolved = 0;
  let unresolved = 0;

  for (const item of candidates.values()) {
    const result = await resolveBestImage(
      item.title,
      item.img,
      imageIndex,
      item.youtubeId
    );

    item.img = result.img;

    if (result.img) resolved++;
    else unresolved++;
  }

  function matches(title, text) {
    const a = key(title);
    const b = key(text);

    if (!a || !b) return false;
    if (b.includes(a) || a.includes(b)) return true;

    const tokens = a.split(' ').filter(t => t.length > 2);

    return (
      tokens.length > 1 &&
      tokens.filter(t => b.includes(t)).length / tokens.length >= 0.75
    );
  }

  const buzz = [...candidates.values()]
    .filter(item => item.img)
    .map(item => {
      const newsSignals = news.filter(n =>
        matches(
          item.title,
          [n?.title || '', n?.summary || '', n?.dek || ''].join(' ')
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
    { id: 'theatres', name: 'Theatres Now', status: 'ok' },
    ...OTT_SOURCES.map(source => ({
      id: source.id,
      name: source.name,
      status: ottTrending[source.id].status
    }))
  ];

  const payload = {
    updatedAt: new Date().toISOString(),
    language: 'Telugu',
    tabs,
    movies: buzz,
    ottTrending,
    methodology:
      'OTT tabs are built independently from public platform catalogue/trending pages. Netflix uses its Telugu catalogue and current India Top 10 surfaces. Prime Video titles are verified for Telugu by catalogue text or the title detail page audio-language metadata. ZEE5 uses its Telugu catalogue. Other platforms are published only when reliable public Telugu-relevant movie data can be extracted. Cineinsta does not use hard-coded OTT titles and does not invent OTT rankings or scores.'
  };

  await fs.writeFile(
    OUTPUT,
    JSON.stringify(payload, null, 2) + '\n',
    'utf8'
  );

  console.log(
    `Cineinsta Buzz written. Buzz images resolved: ${resolved}; unresolved: ${unresolved}.`
  );

  for (const source of OTT_SOURCES) {
    console.log(
      `${source.name}: ${ottTrending[source.id].items.length} published titles`
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
