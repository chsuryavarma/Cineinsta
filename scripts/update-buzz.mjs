/**
 * Cineinsta Buzz / OTT updater
 *
 * Replace:
 *   scripts/update-buzz.mjs
 *
 * Design goals:
 * - Platform-specific extraction instead of one generic parser.
 * - Netflix and ZEE5 use dedicated Telugu catalogue pages.
 * - Prime Video verifies Telugu availability from listing/detail pages.
 * - Aha keeps its working parser.
 * - JioHotstar, Sun NXT, ETV Win and SonyLIV use multiple public catalogue
 *   surfaces and detail-page language verification where possible.
 * - A source failure NEVER replaces the last successful OTT dataset with [].
 * - No hard-coded movie list is used.
 *
 * Runtime: Node 20+ (GitHub Actions).
 * No external npm packages required.
 */

import fs from 'node:fs/promises';

const ROOT = process.cwd();
const FEED_FILE = `${ROOT}/data/feed.json`;
const OUTPUT = `${ROOT}/data/buzz.json`;

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0 Safari/537.36 CineinstaBot/1.0';

const MAX_ITEMS = 12;
const DETAIL_LIMIT = 24;
const REQUEST_TIMEOUT = 25000;

const PLATFORMS = [
  {
    id: 'netflix',
    name: 'Netflix',
    mode: 'catalog',
    urls: [
      'https://www.netflix.com/in/browse/genre/81396423',
      'https://www.netflix.com/in/browse/genre/100381'
    ],
    detailHosts: ['netflix.com']
  },
  {
    id: 'prime-video',
    name: 'Prime Video',
    mode: 'verify',
    urls: [
      'https://www.primevideo.com/-/en/movie?tr=is',
      'https://www.primevideo.com/movie?tr=tv'
    ],
    detailHosts: ['primevideo.com']
  },
  {
    id: 'aha',
    name: 'Aha',
    mode: 'catalog',
    urls: [
      'https://www.aha.video/telugu/movies'
    ],
    detailHosts: ['aha.video']
  },
  {
    id: 'jiohotstar',
    name: 'JioHotstar',
    mode: 'verify',
    urls: [
      'https://www.hotstar.com/in/cinema',
      'https://www.hotstar.com/in/movies'
    ],
    detailHosts: ['hotstar.com']
  },
  {
    id: 'zee5',
    name: 'ZEE5',
    mode: 'catalog',
    urls: [
      'https://www.zee5.com/movies/lang/telugu',
      'https://www.zee5.com/collections/telugu/0-8-manualcoll_727670498'
    ],
    detailHosts: ['zee5.com']
  },
  {
    id: 'sun-nxt',
    name: 'Sun NXT',
    mode: 'verify',
    urls: [
      'https://www.sunnxt.com/movie/inside/telugu-movies?actioURL=true&publishid=45&title=Telugu+Movies&type=movie',
      'https://www.sunnxt.com/movies/telugu'
    ],
    detailHosts: ['sunnxt.com']
  },
  {
    id: 'etv-win',
    name: 'ETV Win',
    mode: 'verify',
    urls: [
      'https://www.etvwin.com/',
      'https://www.etvwin.com/movies'
    ],
    detailHosts: ['etvwin.com']
  },
  {
    id: 'sonyliv',
    name: 'SonyLIV',
    mode: 'verify',
    urls: [
      'https://www.sonyliv.com/',
      'https://www.sonyliv.com/movies'
    ],
    detailHosts: ['sonyliv.com']
  }
];

const BAD_TITLES = new Set([
  'home', 'movies', 'movie', 'series', 'shows', 'more', 'watch now',
  'view all', 'see all', 'subscribe', 'sign in', 'login', 'search',
  'trending', 'popular', 'featured', 'new', 'latest', 'top 10',
  'top 10 movies', 'telugu movies', 'all movies', 'free', 'premium',
  'languages', 'genres', 'kids', 'sports', 'live tv', 'originals',
  'continue watching', 'recommended for you', 'browse all', 'details'
]);

function clean(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&#x2F;|&#47;/gi, '/')
    .replace(/&#x3A;|&#58;/gi, ':')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(value) {
  return clean(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function absoluteUrl(value, base) {
  if (!value) return '';
  try {
    const url = new URL(value, base);
    if (!/^https?:$/i.test(url.protocol)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function safeUrl(value, base) {
  const url = absoluteUrl(value, base);
  if (!url) return '';
  if (/^(javascript|data|blob):/i.test(url)) return '';
  return url;
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function key(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
    .replace(/(the|a|an)$/g, '');
}

function looksLikeTitle(title) {
  const t = clean(title);
  const lower = t.toLowerCase();
  if (!t || t.length < 2 || t.length > 140) return false;
  if (BAD_TITLES.has(lower)) return false;
  if (/^(image|logo|poster|play|watch|arrow|menu|close)$/i.test(t)) return false;
  if (/^(https?:\/\/|www\.)/i.test(t)) return false;
  if (/^(page|next|previous|\d+)$/.test(lower)) return false;
  // Catalogue navigation / genre pages are never movie titles.
  if (/^(go to|more details for|watch telugu|watch for free|view all|see all)\b/i.test(t)) return false;
  if (/^watch\s+telugu\b/i.test(t)) return false;
  if (/\b(movies|movie)\s+(by|in|on)\s+(genre|language)/i.test(t)) return false;
  if (/^(action|adventure|thriller|romance|comedy|horror|kids|drama|crime|sci[- ]?fi|fantasy|suspense)\s+movies$/i.test(t)) return false;
  if (/^(instagram|facebook|twitter|android|ios|support@|offers|my aha)\b/i.test(t)) return false;
  return true;
}

function hasTeluguEvidence(text) {
  const s = String(text || '');
  return /తెలుగు|telugu/i.test(s);
}

function parseAttributes(tag) {
  const out = {};
  const re = /([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = re.exec(tag))) {
    out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? '');
  }
  return out;
}

function extractImages(html, baseUrl) {
  const images = [];
  const re = /<img\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const a = parseAttributes(m[1]);
    const src =
      a.src ||
      a['data-src'] ||
      a['data-lazy-src'] ||
      a['data-original'] ||
      a.content ||
      '';
    const url = safeUrl(src, baseUrl);
    if (!url) continue;
    images.push({
      url,
      alt: a.alt || '',
      title: a.title || '',
      dataTitle: a['data-title'] || '',
      pos: m.index
    });
  }
  return images;
}

function nearestImage(images, start, end, title = '') {
  const lower = title.toLowerCase();
  const candidates = images
    .map(img => {
      const distance =
        img.pos >= start && img.pos <= end
          ? 0
          : Math.min(Math.abs(img.pos - start), Math.abs(img.pos - end));
      const text = `${img.alt} ${img.title} ${img.dataTitle}`.toLowerCase();
      const titleBonus =
        lower && text.includes(lower) ? -100000 :
        lower && lower.split(/\s+/).filter(Boolean).some(w => w.length > 4 && text.includes(w))
          ? -5000 : 0;
      return { img, score: distance + titleBonus };
    })
    .sort((a, b) => a.score - b.score);
  return candidates[0]?.img?.url || '';
}

function extractAnchorCandidates(html, baseUrl) {
  const images = extractImages(html, baseUrl);
  const results = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(html))) {
    const attrs = parseAttributes(m[1]);
    const body = m[2];
    const href = safeUrl(attrs.href || '', baseUrl);
    const title =
      clean(attrs['aria-label']) ||
      clean(attrs.title) ||
      clean(attrs['data-title']) ||
      clean(body);

    if (!looksLikeTitle(title)) continue;

    const start = m.index;
    const end = m.index + m[0].length;
    const img = nearestImage(images, start, end, title);

    results.push({
      title,
      url: href,
      img,
      evidence: `${attrs['aria-label'] || ''} ${attrs.title || ''} ${body}`,
      sourcePos: start
    });
  }

  return results;
}

function extractHeadingCandidates(html, baseUrl) {
  const images = extractImages(html, baseUrl);
  const results = [];
  const re = /<(h1|h2|h3|h4|h5|h6)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;

  while ((m = re.exec(html))) {
    const attrs = parseAttributes(m[2]);
    const title =
      clean(attrs['aria-label']) ||
      clean(attrs.title) ||
      clean(m[3]);

    if (!looksLikeTitle(title)) continue;

    const img = nearestImage(images, m.index, m.index + m[0].length, title);
    results.push({
      title,
      url: '',
      img,
      evidence: clean(m[3]),
      sourcePos: m.index
    });
  }
  return results;
}

function extractJsonLdCandidates(html, baseUrl) {
  const results = [];
  const re = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;

  while ((m = re.exec(html))) {
    let json;
    try {
      json = JSON.parse(m[1].trim());
    } catch {
      continue;
    }

    const stack = Array.isArray(json) ? [...json] : [json];
    while (stack.length) {
      const item = stack.shift();
      if (!item || typeof item !== 'object') continue;

      if (Array.isArray(item)) {
        stack.push(...item);
        continue;
      }

      const name = clean(item.name || item.headline || '');
      const image = Array.isArray(item.image) ? item.image[0] : item.image;
      const url = safeUrl(item.url || '', baseUrl);

      if (looksLikeTitle(name)) {
        results.push({
          title: name,
          url,
          img: safeUrl(image || '', baseUrl),
          evidence: JSON.stringify(item).slice(0, 5000),
          sourcePos: m.index
        });
      }

      for (const value of Object.values(item)) {
        if (value && typeof value === 'object') stack.push(value);
      }
    }
  }
  return results;
}

function dedupeCandidates(items) {
  const map = new Map();

  for (const item of items) {
    const title = clean(item.title);
    if (!looksLikeTitle(title)) continue;

    const k = key(title);
    if (!k || k.length < 2) continue;

    const existing = map.get(k);
    if (!existing) {
      map.set(k, {
        title,
        url: item.url || '',
        img: item.img || '',
        evidence: item.evidence || ''
      });
      continue;
    }

    if (!existing.img && item.img) existing.img = item.img;
    if (!existing.url && item.url) existing.url = item.url;
    if ((item.evidence || '').length > (existing.evidence || '').length) {
      existing.evidence = item.evidence;
    }
  }

  return [...map.values()];
}

function filterByPlatform(platform, candidates) {
  const detailPattern = {
    netflix: /netflix\.com\/.*\/title\/|netflix\.com\/title\//i,
    'prime-video': /primevideo\.com\/detail\//i,
    aha: /aha\.video\/movie\//i,
    jiohotstar: /hotstar\.com\/.*\/(?:movies|movie)\//i,
    zee5: /zee5\.com\/(?:movies|movie)\//i,
    'sun-nxt': /sunnxt\.com\/(?:movie|movies)\//i,
    'etv-win': /etvwin\.com\/.*(?:movie|movies)/i,
    sonyliv: /sonyliv\.com\/.*(?:movie|movies)/i
  };

  return candidates.filter(item => {
    if (!looksLikeTitle(item.title)) return false;

    // Catalog platforms must point to an actual title/detail page.
    if (platform.id === 'netflix') {
      return /netflix\.com\/(?:in\/)?title\//i.test(item.url || '');
    }
    if (platform.id === 'zee5') {
      const u = item.url || '';
      return /zee5\.com\/.*\/movies\//i.test(u) && !/\/(genre|collections?)\//i.test(u);
    }
    if (platform.id === 'aha') {
      return /aha\.video\/movie\//i.test(item.url || '');
    }

    if (hasTeluguEvidence(item.evidence)) return true;
    if (platform.id === 'prime-video' && /\(telugu\)|telugu/i.test(item.title)) return true;
    return item.url && detailPattern[platform.id]?.test(item.url);
  });
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9,te;q=0.8'
      },
      redirect: 'follow',
      signal: controller.signal
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return { text, url: response.url || url };
  } finally {
    clearTimeout(timer);
  }
}

async function extractFromUrl(url, platform) {
  const result = await fetchText(url);
  const html = result.text;
  const finalUrl = result.url;

  const candidates = dedupeCandidates([
    ...extractAnchorCandidates(html, finalUrl),
    ...extractHeadingCandidates(html, finalUrl),
    ...extractJsonLdCandidates(html, finalUrl)
  ]);

  return {
    html,
    finalUrl,
    candidates: filterByPlatform(platform, candidates)
  };
}

async function fetchDetailMetadata(url) {
  try {
    const { text } = await fetchText(url);
    const titleMatches = [];
    const imageMatches = [];

    const metaRe = /<meta\b([^>]+)>/gi;
    let m;
    while ((m = metaRe.exec(text))) {
      const a = parseAttributes(m[1]);
      const property = (a.property || a.name || '').toLowerCase();
      const content = a.content || '';
      if (/^(og:title|twitter:title)$/i.test(property) && content) titleMatches.push(clean(content));
      if (/^(og:image|twitter:image)$/i.test(property) && content) imageMatches.push(content);
    }

    const jsonLd = extractJsonLdCandidates(text, url);
    const title = titleMatches.find(looksLikeTitle) || jsonLd.find(x => looksLikeTitle(x.title))?.title || '';
    const image = imageMatches.map(x => safeUrl(x, url)).find(Boolean) || jsonLd.find(x => x.img)?.img || '';

    return {
      text,
      title: title || '',
      image: image || ''
    };
  } catch {
    return null;
  }
}

function hasStrongTeluguEvidence(text) {
  const s = String(text || '');
  if (/\(telugu\)|\btelugu\s+(audio|language|dubbed|version|track)\b/i.test(s)) return true;
  if (/\b(audio\s+languages?|languages?|audio|dubbed|language)\b[^\n]{0,300}\btelugu\b/i.test(s)) return true;
  if (/\btelugu\b[^\n]{0,300}\b(audio\s+languages?|languages?|audio|dubbed|language)\b/i.test(s)) return true;
  return false;
}

async function enrichAndVerify(platform, candidates) {
  const out = [];
  const seen = new Set();

  for (const candidate of candidates.slice(0, DETAIL_LIMIT)) {
    const k = key(candidate.title);
    if (!k || seen.has(k)) continue;

    let accepted = false;
    let detail = null;

    if (candidate.url) detail = await fetchDetailMetadata(candidate.url);

    if (platform.id === 'netflix' || platform.id === 'zee5' || platform.id === 'aha') {
      // Only publish real movie/detail pages, never catalogue/genre/navigation cards.
      accepted = Boolean(detail && (detail.title || candidate.title));
    } else if (platform.id === 'prime-video') {
      accepted = /\(telugu\)|telugu/i.test(candidate.title) || hasStrongTeluguEvidence(detail?.text || candidate.evidence);
    } else {
      accepted = hasStrongTeluguEvidence(detail?.text || candidate.evidence);
    }

    if (!accepted) continue;

    const finalTitle = detail?.title && looksLikeTitle(detail.title) ? detail.title : candidate.title;
    if (!looksLikeTitle(finalTitle)) continue;

    const finalKey = key(finalTitle);
    if (seen.has(finalKey)) continue;
    seen.add(finalKey);

    out.push({
      title: finalTitle.replace(/^Go to\s+/i, '').replace(/^More details for\s+/i, ''),
      url: candidate.url,
      img: detail?.image || candidate.img || '',
      languages: 'Telugu'
    });

    if (out.length >= MAX_ITEMS) break;
  }

  return out;
}

function imageFromExistingFeed(title, feed) {
  const all = [
    ...(Array.isArray(feed.news) ? feed.news : []),
    ...(Array.isArray(feed.reviews) ? feed.reviews : []),
    ...(Array.isArray(feed.trailers) ? feed.trailers : []),
    ...(Array.isArray(feed.buzz) ? feed.buzz : [])
  ];

  const target = key(title);
  const match = all.find(item => key(item?.title || item?.t || '') === target);

  return match?.img || '';
}

function previousOtt(payload, id) {
  const item = payload?.ottTrending?.[id];
  return item && Array.isArray(item.items) ? item : null;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function scrapePlatform(platform) {
  const combined = [];
  const attempted = [];

  for (const url of platform.urls) {
    try {
      const result = await extractFromUrl(url, platform);
      attempted.push({
        url,
        ok: true,
        candidateCount: result.candidates.length
      });
      combined.push(...result.candidates);
    } catch (error) {
      attempted.push({
        url,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const candidates = dedupeCandidates(combined);
  const items = await enrichAndVerify(platform, candidates);

  return {
    items,
    attempted,
    candidates: candidates.length
  };
}

function makeTabs(ottTrending) {
  return [
    { id: 'buzz', name: 'Buzz Now', status: 'active' },
    { id: 'theatres', name: 'Theatres Now', status: 'ok' },
    ...PLATFORMS.map(platform => ({
      id: platform.id,
      name: platform.name,
      status: ottTrending[platform.id]?.status || 'unavailable'
    }))
  ];
}

function buildBuzz(feed) {
  const candidates = new Map();

  for (const item of Array.isArray(feed.news) ? feed.news : []) {
    const title = clean(item?.title || item?.t || '');
    if (looksLikeTitle(title)) {
      const k = key(title);
      const existing = candidates.get(k) || {
        title,
        img: item?.img || '',
        news: 0,
        reviews: 0,
        trailers: 0
      };
      existing.news += 1;
      if (!existing.img) existing.img = item?.img || '';
      candidates.set(k, existing);
    }
  }

  for (const item of Array.isArray(feed.reviews) ? feed.reviews : []) {
    const title = clean(item?.title || item?.t || '');
    if (!looksLikeTitle(title)) continue;
    const k = key(title);
    const existing = candidates.get(k) || {
      title,
      img: item?.img || '',
      news: 0,
      reviews: 0,
      trailers: 0
    };
    existing.reviews += 1;
    if (!existing.img) existing.img = item?.img || '';
    candidates.set(k, existing);
  }

  for (const item of Array.isArray(feed.trailers) ? feed.trailers : []) {
    const title = clean(item?.title || item?.t || '');
    if (!looksLikeTitle(title)) continue;
    const k = key(title);
    const existing = candidates.get(k) || {
      title,
      img: item?.img || '',
      news: 0,
      reviews: 0,
      trailers: 0
    };
    existing.trailers += 1;
    if (!existing.img) existing.img = item?.img || '';
    candidates.set(k, existing);
  }

  return [...candidates.values()]
    .filter(item => item.img)
    .map(item => {
      const score = Math.min(
        100,
        15 +
          Math.min(item.news * 12, 45) +
          Math.min(item.reviews * 10, 25) +
          Math.min(item.trailers * 5, 15)
      );

      return {
        id: slug(item.title),
        title: item.title,
        img: item.img,
        language: 'Telugu',
        buzzScore: Math.round(score),
        status:
          score >= 70 ? 'HIGH BUZZ' :
          score >= 50 ? 'RISING' :
          score < 30 ? 'COOLING' : 'STEADY',
        sourceSignals: {
          news: item.news,
          reviews: item.reviews,
          trailers: item.trailers
        }
      };
    })
    .sort((a, b) => b.buzzScore - a.buzzScore)
    .slice(0, 24);
}

async function main() {
  const feed = await readJson(FEED_FILE, {});
  const previous = await readJson(OUTPUT, {});

  const ottTrending = {};

  for (const platform of PLATFORMS) {
    console.log(`\n[OTT] ${platform.name}`);

    const previousBlock = previousOtt(previous, platform.id);
    const result = await scrapePlatform(platform);

    const validItems = result.items
      .map(item => ({
        ...item,
        img: item.img || imageFromExistingFeed(item.title, feed)
      }))
      .filter(item => item.img);

    if (validItems.length > 0) {
      ottTrending[platform.id] = {
        status: 'ok',
        updatedAt: new Date().toISOString(),
        lastAttemptedAt: new Date().toISOString(),
        items: validItems.slice(0, MAX_ITEMS)
      };

      console.log(
        `[OTT] ${platform.name}: ${validItems.length} fresh titles`
      );
    } else if (previousBlock?.items?.length) {
      ottTrending[platform.id] = {
        ...previousBlock,
        status: 'stale',
        lastAttemptedAt: new Date().toISOString(),
        note:
          'Fresh extraction failed or returned no validated titles; the last successful dataset was preserved.'
      };

      console.log(
        `[OTT] ${platform.name}: 0 fresh titles — preserved ${previousBlock.items.length} previous titles`
      );
    } else {
      ottTrending[platform.id] = {
        status: 'unavailable',
        updatedAt: null,
        lastAttemptedAt: new Date().toISOString(),
        items: [],
        note:
          'No validated titles were obtained from the platform public catalogue during this run.'
      };

      console.log(`[OTT] ${platform.name}: unavailable`);
    }
  }

  const movies = buildBuzz(feed);

  const payload = {
    updatedAt: new Date().toISOString(),
    language: 'Telugu',
    tabs: makeTabs(ottTrending),
    movies,
    ottTrending,
    methodology:
      'OTT tabs are collected independently from each platform public catalogue or movie surface. Netflix and ZEE5 use Telugu catalogue pages. Prime Video and other platforms verify Telugu evidence from listing/detail pages where required. No hard-coded movie list is used. A temporary source failure never replaces the last successful OTT dataset with zero items.'
  };

  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  console.log('\n=== Cineinsta OTT update summary ===');
  for (const platform of PLATFORMS) {
    const block = ottTrending[platform.id];
    console.log(
      `${platform.name}: ${block.items.length} items (${block.status})`
    );
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
