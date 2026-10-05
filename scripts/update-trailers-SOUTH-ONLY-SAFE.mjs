import fs from "node:fs/promises";

const FEED_FILE = new URL("../data/feed.json", import.meta.url);
const API_KEY = process.env.YOUTUBE_API_KEY || "";

const QUERIES = [
  "Telugu official trailer",
  "Telugu official teaser",
  "Telugu movie trailer",
  "Telugu movie teaser",
  "Telugu movie glimpse",
  "తెలుగు ట్రైలర్",
  "తెలుగు టీజర్",
  "తెలుగు గ్లింప్స్"
];

const DAYS_BACK = 14;
const MAX_RESULTS = 25;
const FINAL_LIMIT = 10;

const BLOCKED = [
  "song","lyric","lyrical","video song","music video","jukebox",
  "full movie","full video","interview","review","reaction","shorts",
  "short","reel","making","behind the scenes","bts","promo song",
  "audio launch","press meet","media meet","first look poster",
  "motion poster","title announcement"
];

const NON_TELUGU = [
  "tamil trailer","malayalam trailer","kannada trailer","hindi trailer",
  "bollywood trailer","marathi trailer","bengali trailer","punjabi trailer",
  "gujarati trailer","tamil teaser","malayalam teaser","kannada teaser","hindi teaser"
];

function clean(v=""){
  return String(v)
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/\s+/g," ")
    .trim();
}

function lower(v=""){ return clean(v).toLowerCase(); }

function hasAny(v, terms){
  const s = lower(v);
  return terms.some(t => s.includes(t));
}

function classify(title, description){
  const s = lower(title + " " + description);
  if (hasAny(s, BLOCKED) || hasAny(s, NON_TELUGU)) return "";
  if (s.includes("trailer")) return "Trailer";
  if (s.includes("teaser")) return "Teaser";
  if (s.includes("glimpse")) return "Glimpse";
  return "";
}

function normalize(v=""){
  return clean(v)
    .toLowerCase()
    .replace(/[|–—:()[\]{}]/g," ")
    .replace(/\b(official|full|telugu|movie|film|trailer|teaser|glimpse)\b/g," ")
    .replace(/[^a-z0-9\u0C00-\u0C7F]+/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function similar(a,b){
  const aa = new Set(normalize(a).split(" ").filter(x => x.length > 2));
  const bb = new Set(normalize(b).split(" ").filter(x => x.length > 2));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const x of aa) if (bb.has(x)) common++;
  return common / Math.max(1, Math.min(aa.size, bb.size));
}

function isTelugu(title, description, tags=[]){
  const s = lower(title + " " + description + " " + tags.join(" "));
  if (hasAny(s, NON_TELUGU)) return false;

  return /[\u0C00-\u0C7F]/.test(title + " " + description) ||
    /\btelugu\b|\btollywood\b/.test(s) ||
    s.includes("తెలుగు");
}

async function youtube(path, params){
  if (!API_KEY) throw new Error("YOUTUBE_API_KEY GitHub Actions secret is missing.");

  const url = new URL("https://www.googleapis.com/youtube/v3/" + path);

  for (const [key,value] of Object.entries({...params,key:API_KEY})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key,String(value));
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "CineinstaTrailerFeed/1.0"
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      "YouTube API " + response.status + ": " +
      (data?.error?.message || "request failed")
    );
  }

  return data;
}

async function searchYouTube(query, publishedAfter){
  return youtube("search", {
    part: "snippet",
    q: query,
    type: "video",
    order: "date",
    publishedAfter,
    regionCode: "IN",
    relevanceLanguage: "te",
    videoEmbeddable: "true",
    maxResults: MAX_RESULTS
  });
}

async function getDetails(ids){
  if (!ids.length) return [];

  const data = await youtube("videos", {
    part: "snippet,status,contentDetails",
    id: ids.join(","),
    maxResults: 50
  });

  return Array.isArray(data.items) ? data.items : [];
}

async function main(){
  const cutoff = Date.now() - DAYS_BACK * 86400000;
  const publishedAfter = new Date(cutoff).toISOString();
  const candidates = new Map();

  for (const query of QUERIES) {
    try {
      const data = await searchYouTube(query, publishedAfter);

      for (const item of data.items || []) {
        const id = item?.id?.videoId;
        if (!id) continue;

        const s = item.snippet || {};

        candidates.set(id, {
          id,
          title: clean(s.title || ""),
          description: clean(s.description || ""),
          channelTitle: clean(s.channelTitle || ""),
          channelId: s.channelId || "",
          publishedAt: s.publishedAt || "",
          thumbnails: s.thumbnails || {}
        });
      }
    } catch (error) {
      console.log("Search failed for " + query + ": " + error.message);
    }
  }

  console.log("YouTube candidates: " + candidates.size);

  const videos = await getDetails([...candidates.keys()]);
  const byId = new Map(videos.map(v => [v.id,v]));
  const accepted = [];

  for (const candidate of candidates.values()) {
    const video = byId.get(candidate.id);
    if (!video) continue;

    const s = video.snippet || {};
    const status = video.status || {};

    const title = clean(s.title || candidate.title);
    const description = clean(s.description || candidate.description);
    const publishedAt = s.publishedAt || candidate.publishedAt;
    const videoType = classify(title, description);

    if (!videoType) continue;
    if (status.privacyStatus !== "public") continue;
    if (status.embeddable !== true) continue;

    if (!publishedAt || new Date(publishedAt).getTime() < cutoff) continue;

    const tags = Array.isArray(s.tags) ? s.tags : [];
    if (!isTelugu(title, description, tags)) continue;

    if (accepted.some(x => similar(x.title,title) >= 0.82)) continue;

    accepted.push({
      id: "youtube:" + candidate.id,
      title,
      source: candidate.channelTitle || "YouTube",
      channelId: candidate.channelId || s.channelId || "",
      url: "https://www.youtube.com/watch?v=" + candidate.id,
      img:
        s.thumbnails?.high?.url ||
        s.thumbnails?.medium?.url ||
        "https://i.ytimg.com/vi/" + candidate.id + "/hqdefault.jpg",
      youtubeId: candidate.id,
      publishedAt,
      language: "Telugu",
      videoType
    });
  }

  accepted.sort(
    (a,b) => new Date(b.publishedAt).getTime() -
             new Date(a.publishedAt).getTime()
  );

  const trailers = accepted.slice(0,FINAL_LIMIT);

  if (trailers.length < 5) {
    throw new Error(
      "Only " + trailers.length +
      " valid Telugu trailer/teaser videos found; existing feed preserved."
    );
  }

  const feed = JSON.parse(await fs.readFile(FEED_FILE,"utf8"));
  feed.trailers = trailers;
  feed.updatedAt = new Date().toISOString();

  await fs.writeFile(
    FEED_FILE,
    JSON.stringify(feed,null,2) + "\n",
    "utf8"
  );

  trailers.forEach((item,index) => {
    console.log(
      (index + 1) + ". " +
      item.videoType + " | " +
      item.title + " | " +
      item.publishedAt
    );
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
