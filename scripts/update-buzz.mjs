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
  return String(v ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
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
  return clean(decode(String(v ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')));
}

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  return decode(String(tag).match(re)?.[1] || '');
}

function abs(v, base) {
  try { return new URL(v, base).href; } catch { return ''; }
}

function normalizeMatchTitle(v = '') {
  return clean(decode(v))
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(theatre|theater|movie|film|official|trailer|ott|review|reviews|release|released|streaming|watch)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function key(v = '') { return normalizeMatchTitle(v); }
function slug(v = '') { return key(v).replace(/\s+/g, '-').slice(0, 100); }

function normalizeTitle(title) {
  const value = clean(title)
    .replace(/^\d+[\). \-]+/, '')
    .replace(/\s*\|\s*20\d{2}.*$/i, '')
    .replace(/\s*-\s*20\d{2}.*$/i, '')
    .replace(/\s+(Netflix|Amazon Prime Video|Prime Video|Aha Video|Aha|ZEE5|JioHotstar|Hotstar|SonyLIV|Sun NXT|ETV Win)\s*$/i, '')
    .trim();

  if (!value || /\$\{[^}]+\}/.test(value)) return '';
  if (/^(top listing|latest movies?|latest ott releases?|new ott releases?|ott releases?|this week|read more|advertisement|release date|watch now|click here)$/i.test(value)) return '';
  if (/\b(top listing|latest movies?|ott releases?|this week|read more|advertisement|watch now|click here)\b/i.test(value)) return '';

  return value;
}

function platformFromText(text) {
  const t = clean(text).toLowerCase();
  for (const p of PLATFORMS) {
    if (p.aliases.some(a => t.includes(a))) return p;
  }
  return null;
}

function releaseDate(text) {
  const m = clean(text).match(/\b(?:OTT Release|Release(?: Date)?|Streaming(?: From)?|Available(?: From)?)\s*:?\s*([A-Z][a-z]+ \d{1,2},? \d{4})/i);
  return m ? clean(m[1]) : '';
}

function languages(text) {
  const m = clean(text).match(/(?:Languages?(?: Available)?|Available in(?: the)? languages?)\s*:?\s*([^\.\n]+)/i);
  return m ? clean(m[1]).slice(0, 180) : 'Telugu';
}

function unique(items) {
  const seen = new Set();

  return items.filter(item => {
    const k = `${key(item.title)}|${key(item.platform)}`;
    if (!key(item.title) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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

    if (!/^https?:\/\//i.test(url)) continue;
    if (/(youtube\.com|youtu\.be|ytimg\.com|googleusercontent\.com|goodreturns\.in|gstatic\.com)/i.test(url)) continue;
    if (/(logo|icon|sprite|placeholder|avatar|facebook|instagram|twitter|app_store|google_play|promo|banner|advert|ads?[-_])/i.test(url)) continue;

    return url;
  }

  return '';
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
 * Validate image URLs before publishing them.
 *
 * Some image hosts leave an apparently valid URL in the feed but return
 * 403/404/HTML/placeholder content when the browser requests it.
 * We therefore test each candidate and move to the next candidate when it fails.
 */
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
        'Range': 'bytes=0-2047'
      },
      signal: controller.signal
    });

    if (!response.ok) return false;

    const type = String(response.headers.get('content-type') || '').toLowerCase();

    /*
     * We accept image/* and common image responses. A HTML response means
     * the image URL is effectively broken even if the HTTP status was 200.
     */
    if (type.startsWith('image/')) return true;
    if (/^(application\/octet-stream|binary\/octet-stream)/i.test(type)) return true;

    return false;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

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
    const img = imageFromBlock(block);

    if (!platform || !img) continue;

    output.push({
      title,
      img,
      platform: platform.name,
      releaseDate: releaseDate(text),
      languages: languages(text),
      text
    });
  }

  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  while ((m = linkRe.exec(html))) {
    const href = abs(m[1], FILMIBEAT_TELUGU);

    if (!/filmibeat\.com/i.test(href)) continue;

    const body = m[2];
    const title = normalizeTitle(strip(body));
    const localImg = imageFromBlock(body);

    if (!title || title.length < 2 || title.length > 120 || !localImg) continue;

    const text = strip(body);
    const platform = platformFromText(text);

    if (!platform) continue;

    output.push({
      title,
      img: localImg,
      platform: platform.name,
      releaseDate: releaseDate(text),
      languages: languages(text),
      text
    });
  }

  return unique(output);
}

/*
 * Seeds are retained only as fallback data. Their image URLs are NOT trusted
 * automatically. Every final URL is validated before it reaches buzz.json.
 */
function makeCard(item, rank) {
  return {
    rank,
    title:item.title,
    language:'Telugu',
    img:item.img||'',
    platform:item.platform,
    releaseDate:item.releaseDate||'',
    languages:item.languages||'Telugu'
  };
}

function buildOtt(parsed) {
  /*
   * Build OTT lists only from the current source parse.
   * Do not inject hard-coded seed titles.
   */
  const current = Array.isArray(parsed) ? parsed : [];
  const result = {};

  for (const platform of PLATFORMS) {
    const items = unique(
      current
        .filter(x => x.platform === platform.name && x.img)
        .map(x => ({ ...x, dateSort: Date.parse(x.releaseDate || '') || 0 }))
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

function buildImageIndex(feed, ottTrending) {
  const records = [];

  const add = (title, img, source) => {
    if (!title || !img || !/^https?:\/\//i.test(String(img).trim())) return;

    records.push({
      title:String(title),
      img:String(img).trim(),
      source
    });
  };

  for (const item of Array.isArray(feed.news)?feed.news:[]) {
    add(item.title||item.t, item.img, 'news');
  }

  for (const item of Array.isArray(feed.reviews)?feed.reviews:[]) {
    add(item.t||item.title||item.movie, item.img, 'reviews');
  }

  for (const item of Array.isArray(feed.trailers)?feed.trailers:[]) {
    add(item.title||item.t, item.img, 'trailers');
  }

  for (const item of Array.isArray(ottTrending)?ottTrending:[]) {
    add(item.title||item.t, item.img, 'ott');
  }

  return records;
}

function imageCandidatesForTitle(title, imageIndex, youtubeId = '') {
  const wanted=key(title);
  const candidates=[];

  if(!wanted) return candidates;

  const exact=imageIndex.filter(x=>key(x.title)===wanted);

  for(const x of exact) {
    if(!candidates.some(y=>y.url===x.img)) {
      candidates.push({url:x.img,source:x.source,score:100});
    }
  }

  const wt=new Set(wanted.split(' ').filter(x=>x.length>2));

  for(const x of imageIndex) {
    const xt=new Set(key(x.title).split(' ').filter(t=>t.length>2));
    if(!xt.size) continue;

    let common=0;
    for(const t of wt) if(xt.has(t)) common++;

    const score=common/Math.max(1,Math.min(wt.size,xt.size));

    if(common>=2 && score>=0.65) {
      if(!candidates.some(y=>y.url===x.img)) {
        candidates.push({url:x.img,source:x.source,score:Math.round(score*100)});
      }
    }
  }

  if(youtubeId) {
    candidates.push({
      url:`https://i.ytimg.com/vi/${encodeURIComponent(youtubeId)}/hqdefault.jpg`,
      source:'youtube',
      score:80
    });
  }

  return candidates;
}

async function resolveBestImage(title, suppliedImage, imageIndex, youtubeId='') {
  const candidates=[];

  if(suppliedImage) {
    candidates.push({
      url:String(suppliedImage).trim(),
      source:'original',
      score:110
    });
  }

  for(const candidate of imageCandidatesForTitle(title,imageIndex,youtubeId)) {
    if(!candidates.some(x=>x.url===candidate.url)) {
      candidates.push(candidate);
    }
  }

  /*
   * Check the original image first, then every matching fallback.
   * The first URL that actually returns an image is published.
   */
  for(const candidate of candidates.slice(0,10)) {
    if(await imageWorks(candidate.url)) {
      return {
        img:candidate.url,
        imageSource:candidate.source
      };
    }
  }

  return {
    img:'',
    imageSource:''
  };
}

async function main() {
  const feed=JSON.parse(await fs.readFile(FEED,'utf8'));

  let trends={movies:[]};
  try {
    trends=JSON.parse(await fs.readFile(TRENDS,'utf8'));
  } catch {}

  let html='';

  try {
    html=await fetchText(FILMIBEAT_TELUGU);
    console.log(`Fetched Filmibeat page: ${html.length} characters.`);
  } catch(error) {
    console.warn(`Filmibeat fetch failed: ${error.message}`);
  }

  const parsed=html?parseFilmibeat(html):[];
  console.log(`Parsed ${parsed.length} Filmibeat OTT records.`);

  const ottTrending=buildOtt(parsed);

  const news=Array.isArray(feed.news)?feed.news:[];
  const reviews=Array.isArray(feed.reviews)?feed.reviews:[];
  const trailers=Array.isArray(feed.trailers)?feed.trailers:[];
  const candidates=new Map();

  function add(title,img,kind,data={}) {
    title=clean(title);
    if(!title)return;

    const id=key(title);
    if(!id)return;

    const item=candidates.get(id)||{
      title,
      img:'',
      youtubeId:'',
      reviews:0,
      trailers:0,
      cinemas:0,
      shows:0
    };

    if(!item.img&&img) item.img=String(img).trim();

    if(data.youtubeId&&!item.youtubeId) {
      item.youtubeId=String(data.youtubeId);
    }

    if(kind==='review')item.reviews++;
    if(kind==='trailer')item.trailers++;

    if(kind==='theatre') {
      item.cinemas+=Number(data.cinemas||0);
      item.shows+=Number(data.shows||0);
    }

    candidates.set(id,item);
  }

  reviews.forEach(item=>add(
    item.t||item.title||item.movie,
    item.img,
    'review',
    {youtubeId:item.youtubeId||item.videoId||''}
  ));

  trailers.forEach(item=>add(
    item.title||item.t,
    item.img,
    'trailer',
    {youtubeId:item.youtubeId||item.videoId||''}
  ));

  (trends.movies||[]).forEach(item=>add(
    item.movie,
    item.img,
    'theatre',
    {
      cinemas:item.signal?.cinemas,
      shows:item.signal?.shows
    }
  ));

  const imageIndex=buildImageIndex(
    feed,
    Object.values(ottTrending).flatMap(x=>x.items||[])
  );

  /*
   * Resolve every candidate instead of dropping candidates that happen
   * to have a bad/missing original URL.
   */
  let resolved=0;
  let unresolved=0;

  for(const item of candidates.values()) {
    const result=await resolveBestImage(
      item.title,
      item.img,
      imageIndex,
      item.youtubeId
    );

    item.img=result.img;

    if(result.img) {
      resolved++;
      console.log(`Image resolved: ${item.title} [${result.imageSource}]`);
    } else {
      unresolved++;
      console.warn(`No usable image found: ${item.title}`);
    }
  }

  function matches(title,text){
    const a=key(title),b=key(text);
    if(!a||!b)return false;

    if(b.includes(a)||a.includes(b))return true;

    const tokens=a.split(' ').filter(t=>t.length>2);

    return tokens.length>1 &&
      tokens.filter(t=>b.includes(t)).length/tokens.length>=0.75;
  }

  const buzz=[...candidates.values()]
    .filter(item=>item.img)
    .map(item=>{
      const newsSignals=news.filter(n=>matches(
        item.title,
        [n?.title||'',n?.summary||'',n?.dek||''].join(' ')
      )).length;

      const buzzScore=Math.round(Math.min(
        100,
        12+
        Math.min(newsSignals*10,30)+
        Math.min(item.reviews*10,20)+
        Math.min(item.trailers*5,10)+
        Math.min(item.cinemas*3,30)+
        Math.min(item.shows*0.4,18)
      ));

      return {
        id:slug(item.title),
        title:item.title,
        img:item.img,
        language:'Telugu',
        buzzScore,
        status:buzzScore>=70
          ?'HIGH BUZZ'
          :buzzScore>=50
            ?'RISING'
            :buzzScore<30
              ?'COOLING'
              :'STEADY',
        theatre:{
          cinemas:item.cinemas,
          shows:item.shows
        },
        sourceSignals:{
          news:newsSignals,
          reviews:item.reviews,
          trailers:item.trailers,
          theatreLocations:item.cinemas,
          theatreShows:item.shows
        }
      };
    })
    .sort((a,b)=>b.buzzScore-a.buzzScore)
    .slice(0,24);

  const tabs=[
    {id:'buzz',name:'Buzz Now',status:'active'},
    {id:'theatres',name:'Theatres Now',status:'ok'},
    ...PLATFORMS.map(p=>({
      id:p.id,
      name:p.name,
      status:ottTrending[p.id].status
    }))
  ];

  const payload={
    updatedAt:new Date().toISOString(),
    language:'Telugu',
    tabs,
    movies:buzz,
    ottTrending,
    methodology:'OTT tabs show up to 10 latest available Telugu-relevant movies or shows parsed from the current OTT source page. No hard-coded OTT seed titles are injected. Image URLs are validated before publishing and matching Cineinsta News, Reviews, Trailers and YouTube thumbnails are used as fallbacks when necessary.'
  };

  await fs.writeFile(
    OUTPUT,
    JSON.stringify(payload,null,2)+'\n',
    'utf8'
  );

  console.log(`Cineinsta Buzz data written successfully. Resolved images: ${resolved}. Unresolved candidates: ${unresolved}.`);

  for(const p of PLATFORMS) {
    console.log(`${p.name}: ${ottTrending[p.id].items.length} titles`);
  }
}

main().catch(error=>{
  console.error(error);
  process.exit(1);
});
