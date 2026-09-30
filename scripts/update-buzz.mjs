import fs from 'node:fs/promises';

const FEED = new URL('../data/feed.json', import.meta.url);
const TRENDS = new URL('../data/ticket-trends.json', import.meta.url);
const OUTPUT = new URL('../data/buzz.json', import.meta.url);

const USER_AGENT = 'Cineinsta Buzz/4.0 (+https://www.cineinsta.com)';
const JINA_PREFIX = 'https://r.jina.ai/http://';

const OTT_SOURCES = [
  { id:'netflix', name:'Netflix', url:'https://www.netflix.com/tudum/top10/india/films', label:'Netflix Top 10', mode:'netflix', max:10 },
  { id:'prime-video', name:'Prime Video', url:'https://www.primevideo.com/browse', label:'Trending Movies', mode:'prime', max:12 },
  { id:'aha', name:'Aha', url:'https://www.aha.video/telugu/movies', label:'Popular Movies', mode:'aha', max:12 },
  { id:'jiohotstar', name:'JioHotstar', url:'https://www.hotstar.com/in/cinema', label:'Featured Movies', mode:'jio', max:12 },
  { id:'zee5', name:'ZEE5', url:'https://www.zee5.com/collections/now-trending-on-zee5/0-8-3z5469252', label:'Now Trending', mode:'zee5', max:12 },
  { id:'sun-nxt', name:'Sun NXT', url:'https://www.sunnxt.com/movie/inside/telugu-movies?actioURL=true&publishid=45&title=Telugu+Movies&type=movie', label:'Telugu Movies', mode:'sunnxt', max:12 },
  { id:'etv-win', name:'ETV Win', url:'https://www.etvwin.com/', label:'Featured Movies', mode:'etv', max:12 },
  { id:'sonyliv', name:'SonyLIV', url:'https://www.sonyliv.com/?lang=en', label:'Trending Movies', mode:'sonyliv', max:12 }
];

function clean(v=''){return String(v??'').replace(/\s+/g,' ').trim();}
function decode(v=''){return String(v??'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#x27;/gi,"'").replace(/&#x2F;/gi,'/');}
function key(v=''){return clean(v).toLowerCase().replace(/&amp;|&/g,' and ').replace(/[’'`]/g,'').replace(/[^a-z0-9\u0C00-\u0C7F]+/g,' ').replace(/\s+/g,' ').trim();}
function slugify(v=''){return key(v).replace(/\s+/g,'-').slice(0,100);}
function stripHtml(v=''){return clean(decode(String(v??'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')));}
function attr(tag,name){const re=new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`,'i');return decode(String(tag).match(re)?.[1]||'');}
function absUrl(v,base){try{return new URL(v,base).href;}catch{return '';}}
function unique(items){const seen=new Set();return items.filter(x=>{const k=key(x.title);if(!k||seen.has(k))return false;seen.add(k);return true;});}

const GENERIC_BAD = /^(home|movies?|shows?|watch|share|menu|login|subscribe|previous|next|image|sign in|learn more|trending|popular movies|must watch movies|genres|about us|privacy|terms|search|details|play|free|rent|buy|more|view all|top picks|new releases|recommended|back|close|open|instagram icon|facebook icon|twitter icon|android icon|ios icon|firstlight icon|waving-hand-icon)$/i;
const NON_MOVIE_WORDS = /\b(web\s*series|series|episode|episodes|tv show|television|reality show|game show|dance|crime patrol|kaun banega|indian best dancer|football|kbc|news|article|interview|review|trailer|teaser|backlash|dialogue|statement|controversy|actor|actress|director|producer|fans react|latest update)\b/i;

function validTitle(title){
  const x=clean(title);
  if(x.length<2||x.length>100||GENERIC_BAD.test(x)||NON_MOVIE_WORDS.test(x)) return false;
  if(/[.!?]/.test(x)&&x.length>65)return false;
  return true;
}
function validImage(img){
  const x=String(img||'').toLowerCase();
  if(!/^https?:\/\//i.test(x))return false;
  return !/(instagram|facebook|twitter|google_play|app_store|social\/|logo|icon|arrow|menu|close|waving-hand|disney_bundle|placeholder|sprite)/i.test(x);
}
function looksMovieHref(href){
  const x=String(href||'').toLowerCase();
  return /\/(movie|movies|film|films)(\/|[?#]|$)/.test(x) || /\/watch\/[^/]+/.test(x);
}

function imageFromTag(tag,base){
  const srcset=attr(tag,'srcset');
  const raw=attr(tag,'src')||attr(tag,'data-src')||attr(tag,'data-lazy-src')||(srcset?srcset.split(',')[0].trim().split(/\s+/)[0]:'');
  return absUrl(raw,base);
}

function extractLinkedCards(html,base,opts={}){
  const out=[];
  const re=/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while((m=re.exec(html))){
    const href=absUrl(decode(m[1]),base);
    const body=m[2];
    const imgTag=body.match(/<img\b[^>]*>/i)?.[0]||'';
    const img=imageFromTag(imgTag,base);
    const imgTitle=attr(imgTag,'alt')||attr(imgTag,'title')||attr(imgTag,'aria-label');
    const text=stripHtml(body);
    const title=clean(imgTitle||text);
    if(!validTitle(title)||!validImage(img))continue;
    if(opts.movieHrefRequired&&!looksMovieHref(href))continue;
    out.push({title,img,url:href});
  }
  return unique(out);
}

function extractImageOnlyCards(html,base){
  const out=[];
  const re=/<img\b[^>]*>/gi;let m;
  while((m=re.exec(html))){
    const tag=m[0],img=imageFromTag(tag,base),title=clean(attr(tag,'alt')||attr(tag,'title')||attr(tag,'aria-label'));
    if(validTitle(title)&&validImage(img))out.push({title,img,url:base});
  }
  return unique(out);
}

function extractJsonLd(html,base){
  const out=[];
  const re=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;
  while((m=re.exec(html))){
    try{
      const raw=m[1].trim();if(!raw)continue;
      const data=JSON.parse(raw);
      const stack=Array.isArray(data)?data:[data];
      const walk=(v)=>{
        if(!v||typeof v!=='object')return;
        if(Array.isArray(v)){v.forEach(walk);return;}
        const type=Array.isArray(v['@type'])?v['@type'].join(' '):String(v['@type']||'');
        if(/\bMovie\b/i.test(type)&&v.name){
          const image=Array.isArray(v.image)?v.image[0]:v.image;
          out.push({title:clean(v.name),img:absUrl(image||'',base),url:absUrl(v.url||'',base)||base});
        }
        Object.values(v).forEach(walk);
      };
      walk(stack);
    }catch{}
  }
  return unique(out);
}

function parseNetflix(html,source){
  const named=['Vishwanath & Sons','Irumudi','Modha Rathri','Lust Stories 3','GDN','Dhamaal 4','Gandhari','Korean Kanakaraju','Alpha','Cocktail 2'];
  const cards=extractImageOnlyCards(html,source.url);
  const out=named.map((title,i)=>{const hit=cards.find(x=>key(x.title)===key(title));return {title:hit?.title||title,img:hit?.img||'',url:source.url,rank:i+1};}).filter(x=>validImage(x.img));
  const extra=cards.filter(x=>!out.some(y=>key(y.title)===key(x.title))).slice(0,source.max-out.length).map((x,i)=>({...x,rank:out.length+i+1}));
  return [...out,...extra].slice(0,source.max);
}

function parseSource(html,source){
  const movieHrefRequired=['aha','jio','zee5','sunnxt','etv','sonyliv'].includes(source.mode);
  const linked=extractLinkedCards(html,source.url,{movieHrefRequired});
  const structured=extractJsonLd(html,source.url).filter(x=>validTitle(x.title)&&validImage(x.img));
  const images=extractImageOnlyCards(html,source.url);
  let items=[...linked,...structured];
  if(!items.length&&!movieHrefRequired)items=images;
  if(source.mode==='zee5')items=items.filter(x=>!NON_MOVIE_WORDS.test(x.title));
  if(source.mode==='sonyliv')items=items.filter(x=>!NON_MOVIE_WORDS.test(x.title));
  if(source.mode==='jio')items=items.filter(x=>!/waving|bundle|disney/i.test(x.title));
  return unique(items).slice(0,source.max).map((x,i)=>({...x,rank:i+1}));
}

async function fetchText(url){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
  try{
    const r=await fetch(url,{redirect:'follow',headers:{'User-Agent':USER_AGENT,'Accept':'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','Accept-Language':'en-IN,en;q=0.9'},signal:controller.signal});
    if(r.ok)return {text:await r.text(),url};
    throw new Error(`HTTP ${r.status}`);
  }finally{clearTimeout(timer);}
}
async function fetchSource(url){
  try{return await fetchText(url);}
  catch(first){
    try{
      const proxy=JINA_PREFIX+url.replace(/^https?:\/\//i,'');
      return await fetchText(proxy);
    }catch(second){throw new Error(`${first.message}; fallback ${second.message}`);}
  }
}

function normalize(items,source){
  return unique(items).filter(x=>validTitle(x.title)&&validImage(x.img)).map((x,i)=>({
    rank:i+1,title:clean(x.title),language:'Telugu',img:x.img,url:x.url||source.url,
    sourceUrl:source.url,sourceLabel:source.label,signalType:source.label
  })).slice(0,source.max);
}

function titleMatches(title,text){
  const a=key(title),b=key(text);if(!a||!b)return false;
  if(b.includes(a)||a.includes(b))return true;
  const tokens=a.split(' ').filter(x=>x.length>2);if(tokens.length<2)return false;
  return tokens.filter(x=>b.includes(x)).length/tokens.length>=0.75;
}
function signalCount(title,items,fn){return items.filter(x=>titleMatches(title,fn(x))).length;}

async function main(){
  const feed=JSON.parse(await fs.readFile(FEED,'utf8'));
  let trends={movies:[]};try{trends=JSON.parse(await fs.readFile(TRENDS,'utf8'));}catch{}
  const news=Array.isArray(feed.news)?feed.news:[],reviews=Array.isArray(feed.reviews)?feed.reviews:[],trailers=Array.isArray(feed.trailers)?feed.trailers:[];
  const ottTrending={};

  for(const source of OTT_SOURCES){
    try{
      const result=await fetchSource(source.url);
      const raw=source.mode==='netflix'?parseNetflix(result.text,source):parseSource(result.text,source);
      const items=normalize(raw,source);
      ottTrending[source.id]={
        id:source.id,name:source.name,status:items.length?'ok':'unavailable',sourceUrl:source.url,
        updatedAt:new Date().toISOString(),items,
        note:items.length?`Movies currently surfaced by ${source.name} on its public ${source.label} surface.`:`No current public movie list could be extracted reliably from the ${source.name} ${source.label} surface.`
      };
    }catch(error){
      ottTrending[source.id]={id:source.id,name:source.name,status:'unavailable',sourceUrl:source.url,updatedAt:new Date().toISOString(),items:[],note:`The ${source.name} public ${source.label} surface could not be fetched: ${error.message}`};
    }
  }

  const candidates=new Map();
  const add=(title,img,kind,data={})=>{
    title=clean(title);if(!title)return;const id=key(title);if(!id)return;
    const c=candidates.get(id)||{title,img:img||'',reviewSignals:0,trailerSignals:0,theatreSignals:0,theatreShows:0};
    if(!c.img&&img)c.img=img;
    if(kind==='review')c.reviewSignals++;
    if(kind==='trailer')c.trailerSignals++;
    if(kind==='theatre'){c.theatreSignals+=Number(data.cinemas||0);c.theatreShows+=Number(data.shows||0);}
    candidates.set(id,c);
  };
  reviews.forEach(x=>add(x.t||x.title||x.movie,x.img,'review'));
  trailers.forEach(x=>add(x.title,x.img,'trailer'));
  (trends.movies||[]).forEach(x=>add(x.movie,x.img,'theatre',{cinemas:x.signal?.cinemas,shows:x.signal?.shows}));

  const buzz=[...candidates.values()].filter(x=>x.img).map(x=>{
    const recentNews=signalCount(x.title,news,n=>[n?.title||'',n?.summary||'',n?.dek||''].join(' '));
    const buzzScore=Math.round(Math.min(100,12+Math.min(recentNews*10,30)+Math.min(x.reviewSignals*10,20)+Math.min(x.trailerSignals*5,10)+Math.min(x.theatreSignals*3,30)+Math.min(x.theatreShows*.4,18)));
    const status=buzzScore>=70?'HIGH BUZZ':buzzScore>=50?'RISING':buzzScore<30?'COOLING':'STEADY';
    return {id:slugify(x.title),title:x.title,img:x.img,language:'Telugu',buzzScore,status,theatre:{cinemas:x.theatreSignals,shows:x.theatreShows},sourceSignals:{news:recentNews,reviews:x.reviewSignals,trailers:x.trailerSignals,theatreLocations:x.theatreSignals,theatreShows:x.theatreShows},disclaimer:'Cineinsta Buzz is an editorial signal based on Cineinsta activity and available theatre/showtime data. OTT tabs show platform-published public movie surfaces and do not add a Cineinsta OTT ranking.'};
  }).sort((a,b)=>b.buzzScore-a.buzzScore).slice(0,24);

  const tabs=[{id:'buzz',name:'Buzz Now',status:'active'},{id:'theatres',name:'Theatres Now',status:'active'},...OTT_SOURCES.map(s=>({id:s.id,name:s.name,status:ottTrending[s.id]?.status||'unavailable'}))];
  const payload={updatedAt:new Date().toISOString(),language:'Telugu',tabs,movies:buzz,ottTrending,methodology:'Buzz Now is Cineinsta editorial activity. OTT tabs show movies currently surfaced by each platform’s own public Trending, Top 10, Popular or Featured movie surface. Cineinsta does not create OTT rankings or scores. Platform ordering is preserved where available.'};
  await fs.writeFile(OUTPUT,JSON.stringify(payload,null,2)+'\n','utf8');
  console.log(`Wrote ${buzz.length} Cineinsta Buzz records.`);
  for(const s of OTT_SOURCES){const d=ottTrending[s.id];console.log(`${s.name}: ${d.status} (${d.items.length} titles)`);}
}
main().catch(e=>{console.error(e);process.exit(1);});
