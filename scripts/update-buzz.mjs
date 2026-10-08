import fs from 'node:fs/promises';

const FEED = new URL('../data/feed.json', import.meta.url);
const TRENDS = new URL('../data/ticket-trends.json', import.meta.url);
const OUTPUT = new URL('../data/buzz.json', import.meta.url);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36 Cineinsta/1.0';

const PLATFORMS = [
  { id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com/tudum/top10/india/films', mode: 'netflix' },
  { id: 'prime-video', name: 'Prime Video', url: 'https://www.primevideo.com/browse', mode: 'generic' },
  { id: 'aha', name: 'Aha', url: 'https://www.aha.video/telugu/movies', mode: 'generic' },
  { id: 'jiohotstar', name: 'JioHotstar', url: 'https://www.hotstar.com/in/cinema', mode: 'generic' },
  { id: 'zee5', name: 'ZEE5', url: 'https://www.zee5.com/movies/lang/telugu', mode: 'generic' },
  { id: 'sun-nxt', name: 'Sun NXT', url: 'https://www.sunnxt.com/movie/inside/telugu-movies?actioURL=true&publishid=45&title=Telugu+Movies&type=movie', mode: 'generic' },
  { id: 'etv-win', name: 'ETV Win', url: 'https://www.etvwin.com/', mode: 'generic' },
  { id: 'sonyliv', name: 'SonyLIV', url: 'https://www.sonyliv.com/?lang=en', mode: 'generic' }
];

function clean(v='') {
  return String(v ?? '').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
}
function decode(v='') {
  return String(v ?? '')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>');
}
function strip(v='') {
  return clean(decode(String(v ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi,' ')
    .replace(/<[^>]+>/g,' ')));
}
function attr(tag,name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`,'i');
  return decode(String(tag).match(re)?.[1] || '');
}
function abs(v,base) {
  try { return new URL(v,base).href; } catch { return ''; }
}
function key(v='') {
  return clean(decode(v)).toLowerCase()
    .replace(/[’'`]/g,'')
    .replace(/&/g,' and ')
    .replace(/\b(theatre|theater|movie|film|official|trailer|ott|review|reviews|release|released|streaming|watch)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ').trim();
}
function slug(v='') { return key(v).replace(/\s+/g,'-').slice(0,100); }

function normalizeTitle(title) {
  const value=clean(title)
    .replace(/^\d+[\). \-]+/,'')
    .replace(/\s*\|\s*20\d{2}.*$/i,'')
    .replace(/\s*-\s*20\d{2}.*$/i,'')
    .replace(/\s+(Netflix|Amazon Prime Video|Prime Video|Aha Video|Aha|ZEE5|JioHotstar|Hotstar|SonyLIV|Sun NXT|ETV Win)\s*$/i,'')
    .trim();
  if(!value || /\$\{[^}]+\}/.test(value)) return '';
  if(/^(home|movies?|series|shows?|watch now|subscribe|login|sign in|more|previous|next|top 10|top listing|latest movies?|latest ott releases?|ott releases?|this week|read more|advertisement|release date)$/i.test(value)) return '';
  return value;
}

async function fetchText(url) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),25000);
  try {
    const response=await fetch(url,{
      redirect:'follow',
      headers:{
        'User-Agent':USER_AGENT,
        'Accept':'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        'Accept-Language':'en-IN,en;q=0.9'
      },
      signal:controller.signal
    });
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}

async function imageWorks(url) {
  if(!/^https?:\/\//i.test(String(url||''))) return false;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),9000);
  try {
    const response=await fetch(url,{
      method:'GET', redirect:'follow',
      headers:{
        'User-Agent':USER_AGENT,
        'Accept':'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Range':'bytes=0-2047'
      },
      signal:controller.signal
    });
    if(!response.ok) return false;
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    return type.startsWith('image/') || /^(application\/octet-stream|binary\/octet-stream)/i.test(type);
  } catch { return false; }
  finally { clearTimeout(timer); }
}

function imageFromBlock(block,baseUrl) {
  const tags=block.match(/<img\b[^>]*>/gi)||[];
  for(const tag of tags) {
    const srcset=attr(tag,'srcset');
    const raw=attr(tag,'src') || attr(tag,'data-src') || attr(tag,'data-lazy-src') ||
      attr(tag,'data-original') || (srcset ? srcset.split(',').pop().trim().split(/\s+/)[0] : '');
    const url=abs(raw,baseUrl);
    if(!/^https?:\/\//i.test(url)) continue;
    if(/(youtube\.com|youtu\.be|ytimg\.com|googleusercontent\.com|gstatic\.com)/i.test(url)) continue;
    if(/(logo|icon|sprite|placeholder|avatar|facebook|instagram|twitter|app_store|google_play|promo|banner|advert|ads?[-_])/i.test(url)) continue;
    return url;
  }
  return '';
}

function parseJsonLd(html,baseUrl) {
  const out=[];
  const scripts=html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi)||[];
  for(const script of scripts) {
    const raw=script.replace(/^<script[^>]*>|<\/script>$/gi,'').trim();
    try {
      const data=JSON.parse(raw);
      const stack=Array.isArray(data)?data:[data];
      const walk=(node)=>{
        if(!node || typeof node!=='object') return;
        if(Array.isArray(node)) { node.forEach(walk); return; }
        const type=Array.isArray(node['@type'])?node['@type'].join(' '):String(node['@type']||'');
        const title=node.name||node.headline||node.itemOffered?.name;
        const image=Array.isArray(node.image)?node.image[0]:node.image;
        if(title && image && /movie|film|video|itemlist|creativework|tvseries/i.test(type+' '+JSON.stringify(node))) {
          const t=normalizeTitle(title), img=abs(String(image),baseUrl);
          if(t && img) out.push({title:t,img});
        }
        for(const v of Object.values(node)) if(v && typeof v==='object') walk(v);
      };
      stack.forEach(walk);
    } catch {}
  }
  return out;
}

function parseGenericPage(html,source) {
  const out=[];
  const base=source.url;
  const jsonld=parseJsonLd(html,base);
  out.push(...jsonld.map(x=>({...x,platform:source.name,text:''})));

  // Conservative heading/card parsing: only accept headings that have a nearby image.
  const headingRe=/<(h2|h3|h4)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while((m=headingRe.exec(html))) {
    const title=normalizeTitle(strip(m[2]));
    if(!title || title.length<2 || title.length>120) continue;
    const start=Math.max(0,m.index-2500);
    const end=Math.min(html.length,headingRe.lastIndex+3500);
    const block=html.slice(start,end);
    const img=imageFromBlock(block,base);
    if(!img) continue;
    out.push({title,img,platform:source.name,text:strip(block).slice(0,3000)});
  }

  const linkRe=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let links=0;
  while((m=linkRe.exec(html)) && links<300) {
    const title=normalizeTitle(strip(m[2]));
    if(!title || title.length<2 || title.length>100) continue;
    const body=m[2];
    const img=imageFromBlock(body,base);
    if(!img) continue;
    out.push({title,img,platform:source.name,text:strip(body)});
    links++;
  }
  return unique(out);
}

function parseNetflix(html,source) {
  const parsed=parseGenericPage(html,source);
  // Netflix Tudum exposes an explicit Top 10 list; preserve the visible ranking when present.
  return parsed.slice(0,20).map((x,i)=>({...x,rank:i+1}));
}

function unique(items) {
  const seen=new Set();
  return items.filter(item=>{
    const k=`${key(item.title)}|${item.platform}`;
    if(!key(item.title) || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function releaseSort(item) {
  const d=Date.parse(item.releaseDate||'');
  return Number.isFinite(d)?d:0;
}

function buildOtt(byPlatform) {
  const result={};
  for(const p of PLATFORMS) {
    const parsed=unique(byPlatform[p.id]||[])
      .filter(x=>x.img)
      .slice(0,20);
    const items=parsed.slice(0,10).map((x,i)=>({
      rank:x.rank||i+1,
      title:x.title,
      language:'Telugu',
      img:x.img,
      platform:p.name,
      releaseDate:x.releaseDate||'',
      languages:x.languages||'Telugu'
    }));
    result[p.id]={
      id:p.id,name:p.name,
      status:items.length?'ok':'unavailable',
      updatedAt:new Date().toISOString(),
      items,
      note:items.length
        ? `Current Telugu-relevant titles surfaced by ${p.name}'s public movie/trending surface.`
        : `No usable public movie titles could be extracted from ${p.name}'s current source.`
    };
  }
  return result;
}

function buildImageIndex(feed,ottTrending) {
  const records=[];
  const add=(title,img,source)=>{
    if(title && img && /^https?:\/\//i.test(String(img).trim()))
      records.push({title:String(title),img:String(img).trim(),source});
  };
  for(const item of (Array.isArray(feed.news)?feed.news:[])) add(item.title||item.t,item.img,'news');
  for(const item of (Array.isArray(feed.reviews)?feed.reviews:[])) add(item.t||item.title||item.movie,item.img,'reviews');
  for(const item of (Array.isArray(feed.trailers)?feed.trailers:[])) add(item.title||item.t,item.img,'trailers');
  for(const item of Object.values(ottTrending||{}).flatMap(x=>x.items||[])) add(item.title,item.img,'ott');
  return records;
}

function imageCandidatesForTitle(title,imageIndex,youtubeId='') {
  const wanted=key(title), candidates=[];
  if(!wanted) return candidates;
  for(const x of imageIndex.filter(x=>key(x.title)===wanted))
    if(!candidates.some(y=>y.url===x.img)) candidates.push({url:x.img,source:x.source});
  if(youtubeId) candidates.push({url:`https://i.ytimg.com/vi/${encodeURIComponent(youtubeId)}/hqdefault.jpg`,source:'youtube'});
  return candidates;
}

async function resolveBestImage(title,suppliedImage,imageIndex,youtubeId='') {
  const candidates=[];
  if(suppliedImage) candidates.push({url:String(suppliedImage).trim(),source:'platform'});
  for(const x of imageCandidatesForTitle(title,imageIndex,youtubeId))
    if(!candidates.some(y=>y.url===x.url)) candidates.push(x);
  for(const candidate of candidates.slice(0,10))
    if(await imageWorks(candidate.url)) return {img:candidate.url,imageSource:candidate.source};
  return {img:'',imageSource:''};
}

async function main() {
  const feed=JSON.parse(await fs.readFile(FEED,'utf8'));
  let trends={movies:[]};
  try { trends=JSON.parse(await fs.readFile(TRENDS,'utf8')); } catch {}

  const byPlatform=Object.fromEntries(PLATFORMS.map(p=>[p.id,[]]));

  for(const p of PLATFORMS) {
    try {
      const html=await fetchText(p.url);
      const parsed=p.mode==='netflix' ? parseNetflix(html,p) : parseGenericPage(html,p);
      byPlatform[p.id]=parsed;
      console.log(`${p.name}: fetched ${html.length} chars, parsed ${parsed.length} candidates.`);
    } catch(error) {
      console.warn(`${p.name}: source unavailable — ${error.message}`);
    }
  }

  const ottTrending=buildOtt(byPlatform);
  const news=Array.isArray(feed.news)?feed.news:[];
  const reviews=Array.isArray(feed.reviews)?feed.reviews:[];
  const trailers=Array.isArray(feed.trailers)?feed.trailers:[];
  const candidates=new Map();

  function add(title,img,kind,data={}) {
    title=clean(title); if(!title) return;
    const id=key(title); if(!id) return;
    const item=candidates.get(id)||{title,img:'',youtubeId:'',reviews:0,trailers:0,cinemas:0,shows:0};
    if(!item.img && img) item.img=String(img).trim();
    if(data.youtubeId && !item.youtubeId) item.youtubeId=String(data.youtubeId);
    if(kind==='review') item.reviews++;
    if(kind==='trailer') item.trailers++;
    if(kind==='theatre') {
      item.cinemas+=Number(data.cinemas||0);
      item.shows+=Number(data.shows||0);
    }
    candidates.set(id,item);
  }

  reviews.forEach(item=>add(item.t||item.title||item.movie,item.img,'review',{youtubeId:item.youtubeId||item.videoId||''}));
  trailers.forEach(item=>add(item.title||item.t,item.img,'trailer',{youtubeId:item.youtubeId||item.videoId||''}));
  (trends.movies||[]).forEach(item=>add(item.movie,item.img,'theatre',{cinemas:item.signal?.cinemas,shows:item.signal?.shows}));

  const imageIndex=buildImageIndex(feed,ottTrending);
  let resolved=0, unresolved=0;
  for(const item of candidates.values()) {
    const result=await resolveBestImage(item.title,item.img,imageIndex,item.youtubeId);
    item.img=result.img;
    if(result.img) resolved++; else unresolved++;
  }

  function matches(title,text) {
    const a=key(title),b=key(text);
    if(!a||!b) return false;
    if(b.includes(a)||a.includes(b)) return true;
    const tokens=a.split(' ').filter(t=>t.length>2);
    return tokens.length>1 && tokens.filter(t=>b.includes(t)).length/tokens.length>=0.75;
  }

  const buzz=[...candidates.values()].filter(item=>item.img).map(item=>{
    const newsSignals=news.filter(n=>matches(item.title,[n?.title||'',n?.summary||'',n?.dek||''].join(' '))).length;
    const buzzScore=Math.round(Math.min(100,12+Math.min(newsSignals*10,30)+Math.min(item.reviews*10,20)+Math.min(item.trailers*5,10)+Math.min(item.cinemas*3,30)+Math.min(item.shows*0.4,18)));
    return {
      id:slug(item.title),title:item.title,img:item.img,language:'Telugu',buzzScore,
      status:buzzScore>=70?'HIGH BUZZ':buzzScore>=50?'RISING':buzzScore<30?'COOLING':'STEADY',
      theatre:{cinemas:item.cinemas,shows:item.shows},
      sourceSignals:{news:newsSignals,reviews:item.reviews,trailers:item.trailers,theatreLocations:item.cinemas,theatreShows:item.shows}
    };
  }).sort((a,b)=>b.buzzScore-a.buzzScore).slice(0,24);

  const tabs=[
    {id:'buzz',name:'Buzz Now',status:'active'},
    {id:'theatres',name:'Theatres Now',status:'ok'},
    ...PLATFORMS.map(p=>({id:p.id,name:p.name,status:ottTrending[p.id].status}))
  ];

  const payload={
    updatedAt:new Date().toISOString(),
    language:'Telugu',
    tabs,
    movies:buzz,
    ottTrending,
    methodology:'OTT tabs are rebuilt independently from each platform’s current public movie/trending surface. Cineinsta does not use hard-coded OTT titles, does not invent OTT rankings or scores, and marks a platform unavailable when no reliable public movie data can be extracted.'
  };

  await fs.writeFile(OUTPUT,JSON.stringify(payload,null,2)+'\n','utf8');
  console.log(`Cineinsta Buzz written. Buzz images resolved: ${resolved}; unresolved: ${unresolved}.`);
  for(const p of PLATFORMS) console.log(`${p.name}: ${ottTrending[p.id].items.length} titles`);
}

main().catch(error=>{ console.error(error); process.exit(1); });
