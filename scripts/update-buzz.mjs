import fs from 'node:fs/promises';

const FEED = new URL('../data/feed.json', import.meta.url);
const TRENDS = new URL('../data/ticket-trends.json', import.meta.url);
const OUTPUT = new URL('../data/buzz.json', import.meta.url);

const USER_AGENT = 'Cineinsta Buzz/3.0 (+https://www.cineinsta.com)';

const OTT_SOURCES = [
  { id:'netflix', name:'Netflix', url:'https://www.netflix.com/tudum/top10/india/films', label:'Netflix Top 10', mode:'netflix', max:10 },
  { id:'prime-video', name:'Prime Video', url:'https://www.primevideo.com/browse', label:'Trending Movies', mode:'prime', max:12 },
  { id:'aha', name:'Aha', url:'https://www.aha.video/telugu/movies', label:'Popular Movies', mode:'aha', max:12 },
  { id:'jiohotstar', name:'JioHotstar', url:'https://www.hotstar.com/in/cinema', label:'Featured Movies', mode:'generic', max:12 },
  { id:'zee5', name:'ZEE5', url:'https://www.zee5.com/collections/now-trending-on-zee5/0-8-3z5469252', label:'Now Trending', mode:'zee5', max:12 },
  { id:'sun-nxt', name:'Sun NXT', url:'https://www.sunnxt.com/movie/inside/telugu-movies?actioURL=true&publishid=45&title=Telugu+Movies&type=movie', label:'Telugu Movies', mode:'generic', max:12 },
  { id:'etv-win', name:'ETV Win', url:'https://www.etvwin.com/', label:'Featured Movies', mode:'generic', max:12 },
  { id:'sonyliv', name:'SonyLIV', url:'https://www.sonyliv.com/?lang=en', label:'Trending Movies', mode:'generic', max:12 }
];

function clean(v='') { return String(v ?? '').replace(/\s+/g,' ').trim(); }
function key(v='') { return clean(v).toLowerCase().replace(/&amp;|&/g,' and ').replace(/[’'`]/g,'').replace(/[^a-z0-9\u0C00-\u0C7F]+/g,' ').replace(/\s+/g,' ').trim(); }
function slugify(v='') { return key(v).replace(/\s+/g,'-').slice(0,100); }
function decode(v='') {
  return String(v ?? '').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#x27;/gi,"'").replace(/&#x2F;/gi,'/');
}
function stripHtml(v='') { return clean(decode(String(v ?? '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' '))); }
function attr(tag,name) { const re = new RegExp(`\\b${name}\\s*=\\s*[\"']([^\"']+)[\"']`,'i'); const m=String(tag).match(re); return decode(m?.[1]||''); }
function absUrl(value,base) { try { return new URL(value,base).href; } catch { return ''; } }

function badTitle(t) {
  const x=clean(t);
  if(x.length<2 || x.length>120) return true;
  return /^(home|movies?|shows?|watch|share|menu|login|subscribe|previous|next|image|sign in|learn more|trending|popular movies|must watch movies|genres|about us|privacy|terms|search|details|play|free|rent|buy|more|view all|top picks|new releases|recommended|web series|series|episodes?)$/i.test(x);
}

function looksLikeArticle(t) {
  const x=clean(t);
  if(badTitle(x)) return true;
  if(/^(director|producer|actor|actress|star|stars|makers|team|fans|buzz|report|reports|exclusive|update|updates|first look|trailer|teaser|poster|shooting|joins|reveals|confirms|announces|suggests|might|could|set to|gears up|gets|gives|opens|addresses|talks|shares|spotted|appears|begins|wraps|launches|unveils|dismisses|clears|misses|eyes)\\b/i.test(x)) return true;
  if(/\b(address|backlash|dialogue|statement|controversy|interview|review|news|latest|release date|makers|team|fans react)\b/i.test(x) && x.split(' ').length>5) return true;
  return /[.!?]/.test(x) && x.length>70;
}

function isMovieTitle(t) { return !looksLikeArticle(t); }

function imageFromTag(tag,base) {
  const srcset=attr(tag,'srcset');
  const raw=attr(tag,'src') || attr(tag,'data-src') || attr(tag,'data-lazy-src') || (srcset ? srcset.split(',')[0].trim().split(/\s+/)[0] : '');
  return absUrl(raw,base);
}

function extractImageCards(html,base) {
  const out=[]; const re=/<img\b[^>]*>/gi; let m;
  while((m=re.exec(html))) {
    const tag=m[0];
    const title=clean(attr(tag,'alt') || attr(tag,'title') || attr(tag,'aria-label'));
    const img=imageFromTag(tag,base);
    if(isMovieTitle(title) && /^https?:/i.test(img)) out.push({title,img});
  }
  return unique(out);
}

function extractAnchors(html,base) {
  const out=[]; const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while((m=re.exec(html))) {
    const title=stripHtml(m[2]); const href=absUrl(decode(m[1]),base);
    if(isMovieTitle(title) && href) out.push({title,url:href,img:''});
  }
  return unique(out);
}

function unique(items) {
  const seen=new Set();
  return items.filter(x=>{const k=key(x.title); if(!k||seen.has(k)) return false; seen.add(k); return true;});
}

function parseNetflix(html,source) {
  const cards=extractImageCards(html,source.url);
  const names=['Vishwanath & Sons','Irumudi','Modha Rathri','Lust Stories 3','GDN','Dhamaal 4','Gandhari','Korean Kanakaraju','Alpha','Cocktail 2'];
  const out=[];
  for(const title of names) {
    const match=cards.find(x=>key(x.title)===key(title)) || {title,img:''};
    out.push({title:match.title||title,img:match.img,rank:out.length+1});
  }
  const generic=cards.filter(x=>!out.some(y=>key(y.title)===key(x.title))).slice(0,source.max-out.length);
  return [...out.filter(x=>x.img),...generic].slice(0,source.max).map((x,i)=>({...x,rank:i+1}));
}

function parsePrime(html,source) {
  const cards=extractImageCards(html,source.url);
  const anchors=extractAnchors(html,source.url);
  return unique([...cards,...anchors]).slice(0,source.max).map((x,i)=>({...x,rank:i+1}));
}

function parseZee5(html,source) {
  const cards=extractImageCards(html,source.url);
  const anchors=extractAnchors(html,source.url);
  return unique([...cards,...anchors]).filter(x=>isMovieTitle(x.title)).slice(0,source.max).map((x,i)=>({...x,rank:i+1}));
}

function parseGeneric(html,source) {
  const cards=extractImageCards(html,source.url);
  const anchors=extractAnchors(html,source.url);
  return unique([...cards,...anchors]).slice(0,source.max).map((x,i)=>({...x,rank:i+1}));
}

function parseAha(html,source) {
  return parseGeneric(html,source);
}

async function fetchSource(url) {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),20000);
  try {
    const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':USER_AGENT,'Accept':'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','Accept-Language':'en-IN,en;q=0.9'},signal:controller.signal});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(timer); }
}

function normalize(items,source) {
  return unique(items)
    .filter(x=>isMovieTitle(x.title))
    .filter(x=>x.img && /^https?:/i.test(x.img))
    .map((x,i)=>({rank:x.rank||i+1,title:clean(x.title),language:'Telugu',img:x.img,sourceUrl:source.url,sourceLabel:source.label,signalType:source.label}))
    .slice(0,source.max);
}

function titleMatches(movieTitle,text) {
  const a=key(movieTitle),b=key(text); if(!a||!b)return false;
  if(b.includes(a)||a.includes(b))return true;
  const tokens=a.split(' ').filter(x=>x.length>2); if(tokens.length<2)return false;
  return tokens.filter(x=>b.includes(x)).length/tokens.length>=0.75;
}

function signalCount(title,items,fn) { return items.filter(x=>titleMatches(title,fn(x))).length; }

async function main() {
  const feed=JSON.parse(await fs.readFile(FEED,'utf8'));
  let trends={movies:[]}; try { trends=JSON.parse(await fs.readFile(TRENDS,'utf8')); } catch {}
  const news=Array.isArray(feed.news)?feed.news:[];
  const reviews=Array.isArray(feed.reviews)?feed.reviews:[];
  const trailers=Array.isArray(feed.trailers)?feed.trailers:[];
  const ottTrending={};

  for(const source of OTT_SOURCES) {
    try {
      const html=await fetchSource(source.url);
      let raw=[];
      if(source.mode==='netflix') raw=parseNetflix(html,source);
      else if(source.mode==='prime') raw=parsePrime(html,source);
      else if(source.mode==='zee5') raw=parseZee5(html,source);
      else if(source.mode==='aha') raw=parseAha(html,source);
      else raw=parseGeneric(html,source);
      const items=normalize(raw,source);
      ottTrending[source.id]={id:source.id,name:source.name,status:items.length?'ok':'unavailable',sourceUrl:source.url,updatedAt:new Date().toISOString(),items,note:items.length?`Movies currently surfaced by ${source.name} on its public ${source.label} surface.`:`No current public movie list could be extracted reliably from the ${source.name} ${source.label} surface.`};
    } catch(error) {
      ottTrending[source.id]={id:source.id,name:source.name,status:'unavailable',sourceUrl:source.url,updatedAt:new Date().toISOString(),items:[],note:`The ${source.name} public ${source.label} surface could not be fetched: ${error.message}`};
    }
  }

  const candidates=new Map();
  function addMovie(title,img,kind,data={}) {
    title=clean(title); if(!title)return; const id=key(title); if(!id)return;
    const c=candidates.get(id)||{title,img:img||'',reviewSignals:0,trailerSignals:0,theatreSignals:0,theatreShows:0};
    if(!c.img&&img)c.img=img;
    if(kind==='review')c.reviewSignals++;
    if(kind==='trailer')c.trailerSignals++;
    if(kind==='theatre'){c.theatreSignals+=Number(data.cinemas||0);c.theatreShows+=Number(data.shows||0);}
    candidates.set(id,c);
  }
  for(const x of reviews)addMovie(x.t||x.title||x.movie,x.img,'review');
  for(const x of trailers)addMovie(x.title,x.img,'trailer');
  for(const x of trends.movies||[])addMovie(x.movie,x.img,'theatre',{cinemas:x.signal?.cinemas,shows:x.signal?.shows});

  const buzz=[...candidates.values()].filter(x=>x.img).map(x=>{
    const recentNews=signalCount(x.title,news,n=>[n?.title||'',n?.summary||'',n?.dek||''].join(' '));
    const buzzScore=Math.round(Math.min(100,12+Math.min(recentNews*10,30)+Math.min(x.reviewSignals*10,20)+Math.min(x.trailerSignals*5,10)+Math.min(x.theatreSignals*3,30)+Math.min(x.theatreShows*.4,18)));
    const status=buzzScore>=70?'HIGH BUZZ':buzzScore>=50?'RISING':buzzScore<30?'COOLING':'STEADY';
    return {id:slugify(x.title),title:x.title,img:x.img,language:'Telugu',buzzScore,status,theatre:{cinemas:x.theatreSignals,shows:x.theatreShows},sourceSignals:{news:recentNews,reviews:x.reviewSignals,trailers:x.trailerSignals,theatreLocations:x.theatreSignals,theatreShows:x.theatreShows},disclaimer:'Cineinsta Buzz is an editorial signal based on Cineinsta activity and available theatre/showtime data. OTT tabs show platform-published public movie surfaces and do not add a Cineinsta OTT ranking.'};
  }).sort((a,b)=>b.buzzScore-a.buzzScore).slice(0,24);

  const tabs=[{id:'buzz',name:'Buzz Now',status:'active'},{id:'theatres',name:'Theatres Now',status:'active'},...OTT_SOURCES.map(s=>({id:s.id,name:s.name,status:ottTrending[s.id]?.status||'unavailable'}))];
  const payload={updatedAt:new Date().toISOString(),language:'Telugu',tabs,movies:buzz,ottTrending,methodology:'Buzz Now is Cineinsta editorial activity. OTT tabs simply show movies currently surfaced by each platform’s own public Trending, Top 10, Popular or Featured movie surface. Cineinsta does not create OTT rankings or scores. Platform ordering is preserved where available.'};
  await fs.writeFile(OUTPUT,JSON.stringify(payload,null,2)+'\n','utf8');
  console.log(`Wrote ${buzz.length} Cineinsta Buzz records.`);
  for(const s of OTT_SOURCES){const d=ottTrending[s.id];console.log(`${s.name}: ${d.status} (${d.items.length} titles)`);}
}
main().catch(e=>{console.error(e);process.exit(1);});
