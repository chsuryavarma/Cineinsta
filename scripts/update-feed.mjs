import fs from "node:fs/promises";

/* =========================================================
   CINEINSTA FEED UPDATER
   Telugu News + Telugu Trailers + Reviews

   NEWS SOURCES:
   - 123telugu
   - TeluguCinema
   - Telugu360
   - Gulte
   - GreatAndhra
   - CineJosh
   - IndiaGlitz Telugu

   REVIEW SOURCES:
   - GreatAndhra
   - Gulte
   - M9.news
   - Telugu360
   - 123telugu

   TRAILER SOURCE:
   - Times of India / ETimes Telugu video section

   Reviews are sorted by actual release/streaming date.
   News and trailers are sorted newest first.
   ========================================================= */


const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";


/* =========================================================
   NEWS SOURCES
   ========================================================= */

const NEWS_SOURCES = [
  {
    name: "123telugu",
    url:
      "https://www.123telugu.com/category/mnews/",
    domain:
      "123telugu.com"
  },

  {
    name: "TeluguCinema",
    url:
      "https://telugucinema.com/news",
    domain:
      "telugucinema.com"
  },

  {
    name: "Telugu360",
    url:
      "https://www.telugu360.com/category/movies/",
    domain:
      "telugu360.com"
  },

  {
    name: "Gulte",
    url:
      "https://www.gulte.com/movienews",
    domain:
      "gulte.com"
  },

  {
    name: "GreatAndhra",
    url:
      "https://www.greatandhra.com/movies/news",
    domain:
      "greatandhra.com"
  },

  {
    name: "CineJosh",
    url:
      "https://www.cinejosh.com/news",
    domain:
      "cinejosh.com"
  },

  {
    name: "IndiaGlitz Telugu",
    url:
      "https://indiaglitz.com/telugu/movie-news",
    domain:
      "indiaglitz.com"
  }
];


/* =========================================================
   TRAILER SOURCES
   ========================================================= */

const TRAILER_SOURCES = [
  {
    name:
      "ETimes Telugu",
    url:
      "https://timesofindia.indiatimes.com/entertainment/telugu/movies",
    domain:
      "timesofindia.indiatimes.com"
  },

  {
    name:
      "IndiaGlitz Telugu",
    url:
      "https://indiaglitz.com/telugu",
    domain:
      "indiaglitz.com"
  }
];


/* =========================================================
   REVIEW SOURCES
   ========================================================= */

const REVIEW_SOURCES = [
  {
    name:
      "GreatAndhra",

    archive:
      "https://www.greatandhra.com/movies/reviews/",

    domain:
      "greatandhra.com"
  },

  {
    name:
      "Gulte",

    archive:
      "https://www.gulte.com/moviereviews",

    domain:
      "gulte.com"
  },

  {
    name:
      "M9.news",

    archive:
      "https://www.m9.news/reviews/",

    domain:
      "m9.news"
  },

  {
    name:
      "Telugu360",

    archive:
      "https://www.telugu360.com/category/movies/telugu-movies-reviews/",

    domain:
      "telugu360.com"
  },

  {
    name:
      "123telugu",

    archive:
      "https://www.123telugu.com/category/reviews/",

    domain:
      "123telugu.com"
  }
];


const REVIEW_SOURCE_NAMES = [
  "GreatAndhra",
  "Gulte",
  "M9.news",
  "Telugu360",
  "123telugu"
];


/* =========================================================
   FETCH
   ========================================================= */

async function fetchHTML(url) {

  try {

    /*
     * M9.news blocks GitHub Actions.
     * Jina Reader is used only for M9.
     */
    const requestUrl =
      url.includes(
        "m9.news"
      )
        ? `https://r.jina.ai/${url}`
        : url;

    const response =
      await fetch(
        requestUrl,
        {
          headers: {
            "User-Agent":
              USER_AGENT,

            "Accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          }
        }
      );

    if (
      !response.ok
    ) {

      console.log(
        `FAILED ${response.status}: ${url}`
      );

      return "";
    }

    return await response.text();

  } catch (
    error
  ) {

    console.log(
      `FAILED: ${url}`
    );

    console.log(
      error.message
    );

    return "";
  }
}


/* =========================================================
   TEXT HELPERS
   ========================================================= */

function decodeEntities(
  text = ""
) {

  return text
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&#x27;/gi,
      "'"
    )
    .replace(
      /&#8217;/gi,
      "'"
    )
    .replace(
      /&#8216;/gi,
      "'"
    )
    .replace(
      /&#8220;/gi,
      '"'
    )
    .replace(
      /&#8221;/gi,
      '"'
    )
    .replace(
      /&#8211;/gi,
      "-"
    )
    .replace(
      /&#8212;/gi,
      "-"
    )
    .replace(
      /&#8230;/gi,
      "..."
    )
    .replace(
      /&#(\d+);/g,
      (_, n) => {

        try {
          return String.fromCharCode(
            Number(n)
          );
        } catch {
          return "";
        }

      }
    );
}


function stripHTML(
  html = ""
) {

  return decodeEntities(
    html

      .replace(
        /<script[\s\S]*?<\/script>/gi,
        " "
      )

      .replace(
        /<style[\s\S]*?<\/style>/gi,
        " "
      )

      .replace(
        /<noscript[\s\S]*?<\/noscript>/gi,
        " "
      )

      .replace(
        /<svg[\s\S]*?<\/svg>/gi,
        " "
      )

      .replace(
        /<[^>]+>/g,
        " "
      )

      .replace(
        /\s+/g,
        " "
      )

      .trim()
  );
}


function absoluteUrl(
  url,
  base
) {

  try {

    return new URL(
      url,
      base
    ).href;

  } catch {

    return "";
  }
}


/* =========================================================
   META
   ========================================================= */

function extractMeta(
  html,
  property
) {

  const patterns = [

    new RegExp(
      `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,
      "i"
    ),

    new RegExp(
      `<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),

    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`,
      "i"
    )
  ];


  for (
    const pattern of patterns
  ) {

    const match =
      html.match(
        pattern
      );

    if (
      match?.[1]
    ) {

      return decodeEntities(
        match[1]
      ).trim();
    }
  }


  return "";
}


/* =========================================================
   HEADLINE
   ========================================================= */

function extractHeadline(
  html,
  fallback = ""
) {

  const h1 =
    html.match(
      /<h1[^>]*>([\s\S]*?)<\/h1>/i
    );

  if (
    h1?.[1]
  ) {

    return stripHTML(
      h1[1]
    );
  }


  const ogTitle =
    extractMeta(
      html,
      "og:title"
    );

  if (
    ogTitle
  ) {

    return ogTitle;
  }


  const title =
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    );

  if (
    title?.[1]
  ) {

    return stripHTML(
      title[1]
    );
  }


  return fallback;
}


/* =========================================================
   IMAGE
   ========================================================= */

function extractImage(
  html
) {

  return (
    extractMeta(
      html,
      "og:image"
    ) ||

    extractMeta(
      html,
      "twitter:image"
    ) ||

    ""
  );
}


/* =========================================================
   DATE
   ========================================================= */

function extractDate(
  html
) {

  const candidates = [

    extractMeta(
      html,
      "article:published_time"
    ),

    extractMeta(
      html,
      "datePublished"
    ),

    extractMeta(
      html,
      "publish_date"
    ),

    extractMeta(
      html,
      "date"
    )
  ];


  for (
    const value of candidates
  ) {

    if (
      value &&
      !Number.isNaN(
        new Date(
          value
        ).getTime()
      )
    ) {

      return new Date(
        value
      ).toISOString();
    }
  }


  const text =
    stripHTML(
      html
    );


  const match =
    text.match(
      /\b(?:Sep|September|Aug|August|Jul|July|Oct|October|Nov|November|Dec|December|Jan|January|Feb|February|Mar|March|Apr|April|May|Jun|June)\s+\d{1,2},\s+\d{4}\b/i
    );


  if (
    match
  ) {

    const date =
      new Date(
        match[0]
      );

    if (
      !Number.isNaN(
        date.getTime()
      )
    ) {

      return date.toISOString();
    }
  }


  return null;
}


/* =========================================================
   LINKS
   ========================================================= */

function extractLinks(
  html,
  baseUrl
) {

  const links = [];


  /*
   * HTML links
   */
  const htmlRegex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;


  while (
    (match =
      htmlRegex.exec(
        html
      ))
  ) {

    const url =
      absoluteUrl(
        match[1],
        baseUrl
      );

    const text =
      stripHTML(
        match[2]
      );


    if (
      !url ||
      !text
    ) {
      continue;
    }


    links.push({
      url,
      text
    });
  }


  /*
   * Markdown links from Jina
   */
  const markdownRegex =
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;


  while (
    (match =
      markdownRegex.exec(
        html
      ))
  ) {

    const text =
      stripHTML(
        match[1]
      );

    const url =
      absoluteUrl(
        match[2],
        baseUrl
      );


    if (
      !url ||
      !text
    ) {
      continue;
    }


    links.push({
      url,
      text
    });
  }


  return uniqueLinks(
    links
  );
}


function uniqueLinks(
  links
) {

  const map =
    new Map();


  for (
    const link of links
  ) {

    if (
      !map.has(
        link.url
      )
    ) {

      map.set(
        link.url,
        link
      );
    }
  }


  return [
    ...map.values()
  ];
}


/* =========================================================
   BAD TITLES
   ========================================================= */

function isBadTitle(
  title
) {

  const value =
    title
      .trim()
      .toLowerCase();


  const bad = [

    "home",

    "menu",

    "read more",

    "view all",

    "more",

    "latest news",

    "movie news",

    "news",

    "movie reviews",

    "reviews",

    "photos",

    "gallery",

    "videos",

    "video",

    "advertisement",

    "subscribe"
  ];


  if (
    bad.includes(
      value
    )
  ) {
    return true;
  }


  if (
    value.length < 10
  ) {
    return true;
  }


  return false;
}


/* =========================================================
   NEWS LINK FILTER
   ========================================================= */

function isNewsLink(
  source,
  link
) {

  const url =
    link.url.toLowerCase();

  const text =
    link.text.trim();


  if (
    !url.includes(
      source.domain
    )
  ) {
    return false;
  }


  if (
    isBadTitle(
      text
    )
  ) {
    return false;
  }


  if (
    text.length < 15 ||
    text.length > 220
  ) {
    return false;
  }


  /*
   * Remove obvious navigation.
   */
  const blocked =
    [
      "/category/",
      "/tag/",
      "/author/",
      "/page/",
      "/search",
      "/contact",
      "/about",
      "/privacy",
      "/terms"
    ];


  /*
   * Keep category landing pages
   * only as source archives.
   */
  if (
    blocked.some(
      part =>
        url.includes(
          part
        )
    )
  ) {

    return false;
  }


  /*
   * News keywords.
   */
  const newsWords =
    [
      "movie",
      "film",
      "hero",
      "actress",
      "actor",
      "director",
      "trailer",
      "teaser",
      "song",
      "release",
      "ott",
      "box office",
      "shooting",
      "first look",
      "poster",
      "glimpse",
      "update",
      "nani",
      "prabhas",
      "allu",
      "mahesh",
      "ntr",
      "ram charan",
      "vijay",
      "rashmika",
      "samantha",
      "chiranjeevi",
      "pawan kalyan",
      "deverakonda"
    ];


  const combined =
    (
      text +
      " " +
      url
    ).toLowerCase();


  return newsWords.some(
    word =>
      combined.includes(
        word
      )
  );
}


/* =========================================================
   NEWS SUMMARY
   ========================================================= */

function makeSummary(
  text,
  title
) {

  let clean =
    text
      .replace(
        /\s+/g,
        " "
      )
      .trim();


  /*
   * Remove title if repeated
   * at beginning of article.
   */
  if (
    clean
      .toLowerCase()
      .startsWith(
        title
          .toLowerCase()
      )
  ) {

    clean =
      clean
        .slice(
          title.length
        )
        .trim();
  }


  if (
    clean.length < 60
  ) {

    return `Latest Telugu cinema update: ${title}.`;
  }


  /*
   * Take first useful sentence.
   */
  const sentence =
    clean.match(
      /^(.{60,260}?[.!?])\s/
    );


  let summary =
    sentence
      ? sentence[1]
      : clean.slice(
          0,
          220
        );


  /*
   * Don't leave an incomplete
   * word at the end.
   */
  if (
    summary.length >= 220
  ) {

    summary =
      summary.replace(
        /\s+\S*$/,
        "..."
      );
  }


  return summary;
}


/* =========================================================
   READ NEWS ARTICLE
   ========================================================= */

async function readNewsArticle(
  source,
  candidate
) {

  const html =
    await fetchHTML(
      candidate.url
    );


  if (
    !html
  ) {
    return null;
  }


  const title =
    extractHeadline(
      html,
      candidate.text
    );


  if (
    !title ||
    isBadTitle(
      title
    )
  ) {
    return null;
  }


  const image =
    extractImage(
      html
    );


  const publishedAt =
    extractDate(
      html
    );


  const text =
    stripHTML(
      html
    );


  const summary =
    makeSummary(
      text,
      title
    );


  return {

    id:
      candidate.url,

    title,

    summary,

    source:
      source.name,

    url:
      candidate.url,

    img:
      image,

    publishedAt,

    language:
      "Telugu",

    category:
      "Telugu Cinema"
  };
}


/* =========================================================
   COLLECT NEWS
   ========================================================= */

async function collectNews() {

  /*
     IMPORTANT: news is screened BEFORE it enters the accepted list.

     We do not collect a large batch and clean it afterward. Each article
     must pass the duplicate-event gate against the stories already accepted.
  */
  const acceptedNews = [];


  console.log("");
  console.log("======================================");
  console.log("TELUGU NEWS");
  console.log("======================================");


  for (const source of NEWS_SOURCES) {

    console.log("");
    console.log(`Loading ${source.name}: ${source.url}`);


    const html = await fetchHTML(source.url);

    if (!html) {
      continue;
    }


    const links = extractLinks(html, source.url);


    const candidates = links
      .filter(link => isNewsLink(source, link))
      .slice(0, 15);


    console.log(`${source.name}: ${candidates.length} candidates`);


    for (const candidate of candidates) {

      const article = await readNewsArticle(source, candidate);

      if (!article) {
        continue;
      }


      console.log(`${source.name} | ${article.title}`);


      /*
         DUPLICATE GATE — BEFORE ADDING

         The candidate is compared only with stories that have already
         passed the gate. If it represents the same event, it is rejected
         immediately and never enters acceptedNews.
      */
      const duplicateOf = findDuplicateAcceptedNews(article, acceptedNews);

      if (duplicateOf) {
        console.log(
          `SKIP DUPLICATE | ${source.name} | ${article.title} | already covered by: ${duplicateOf.title}`
        );
        continue;
      }


      acceptedNews.push(article);
      console.log(`ACCEPT NEWS | ${source.name} | ${article.title}`);

      /*
         Keep the candidate pool bounded while still allowing every source
         to contribute fresh events. The final published feed is sorted and
         limited below.
      */
      if (acceptedNews.length >= 60) {
        break;
      }
    }


    if (acceptedNews.length >= 60) {
      break;
    }
  }


  return acceptedNews
    .sort((a, b) => {
      const ad = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const bd = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return bd - ad;
    })
    .slice(0, 30);
}


/* =========================================================
   NEWS DEDUPLICATION — EVENT LEVEL
   =========================================================

   Headlines from different publishers are often rewritten so heavily
   that headline similarity alone cannot recognise the same story.

   Cineinsta therefore deduplicates on:
     ENTITY / MOVIE + EVENT TYPE

   Examples:
     Bhogi + teaser       -> ONE story
     Bhogi + song         -> separate story
     Bhogi + release date -> separate story
     Bhogi + review       -> separate story
     Bhogi + box office  -> separate story

   The original URL is still retained on the selected primary story.
   ========================================================= */

function normalizeTitle(title = "") {
  return String(title || "")
    .toLowerCase()
    .replace(/&amp;|&/g, " and ")
    .replace(/[^a-z0-9\u0C00-\u0C7F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NEWS_EVENT_STOP_WORDS = new Set([
  "the","a","an","and","or","but","for","from","with","into",
  "after","before","over","under","about","this","that","these",
  "those","his","her","their","its","has","have","had","is",
  "are","was","were","will","can","could","would","should","may",
  "might","here","how","why","what","when","where","who","which",
  "latest","breaking","exclusive","official","update","updates","news","mnews","movienews","featured",
  "report","reports","reveals","reveal","revealed","opens","open","up",
  "says","said","shares","share","speaks","speak","talks","talk",
  "displays","unveils","unveiled","introduces","introduced","gets","get",
  "takes","take","dominates","delivers","delivered","stuns","stun",
  "captivates","captivate","showcases","showcase","presents","presented",
  "gives","give","offers","offer","brings","bring","sets","set",
  "defines","define","highlights","highlight","look","first","new",
  "now","today","day","days","movie","movies","film","films","cinema",
  "telugu","tollywood","actor","actress","hero","heroine","star","stars",
  "director","filmmaker","producer","team","makers","maker","fans",
  "audiences","audience","people","industry","period","world","avatar",
  "intense","intensity","raw","gritty","fierce","bloody","rage","action",
  "drama","dramatic","powerful","upcoming","project","venture","cinematic",
  "teaser","trailer","first","look","poster","song","single","lyrical",
  "track","audio","release","released","date","streaming","digital","ott",
  "box","office","collection","collections","gross","opening","weekend",
  "review","reviews","rating","verdict","interview","conversation",
  "casting","cast","shooting","filming","announcement","announced",
  "controversy","controversial","award","awards","nomination","nominated"
]);

const NEWS_EVENT_PATTERNS = [
  { type: "box-office", terms: ["box office", "boxoffice", "collections", "collection", "gross", "grosses", "opening", "day 1", "first day", "weekend", "worldwide", "india net", "india gross", "record collection"] },
  { type: "release-date", terms: ["release date", "release-date", "releasing on", "releases on", "release on", "theatrical release", "locks release", "release plans"] },
  { type: "ott", terms: ["ott", "streaming date", "streams on", "streaming on", "digital premiere", "digital release", "netflix", "prime video", "aha", "hotstar", "jiohotstar", "zee5", "sonyliv"] },
  { type: "trailer", terms: ["official trailer", "trailer", "trailer launch", "trailer released"] },
  { type: "teaser", terms: ["official teaser", "teaser", "teaser launch", "teaser released"] },
  { type: "first-look", terms: ["first look", "first-look", "firstlook", "character poster"] },
  { type: "poster", terms: ["poster", "poster released", "poster launch"] },
  { type: "song", terms: ["song", "single", "lyrical", "lyric video", "music video", "track", "audio", "song release", "single release"] },
  { type: "casting", terms: ["casting", "joins cast", "joins the cast", "roped in", "signed for", "on board", "onboard", "replaces", "replacement"] },
  { type: "announcement", terms: ["announced", "announcement", "officially announced", "title announcement", "title revealed"] },
  { type: "shooting", terms: ["shooting", "filming", "wrap", "wrapped", "production begins", "production starts"] },
  { type: "review", terms: ["review", "reviews", "rating", "verdict", "movie review", "film review"] },
  { type: "interview", terms: ["interview", "conversation", "talks about", "speaks about", "opens up", "interaction", "media meet", "press meet"] },
  { type: "death-tribute", terms: ["passes away", "passed away", "dies", "died", "death", "final respects", "tributes", "tribute", "demise", "condolences", "mourns", "mourn", "farewell", "last rites"] },
  { type: "controversy", terms: ["controversy", "controversial", "row", "legal", "lawsuit", "notice", "ban", "boycott"] },
  { type: "award", terms: ["award", "awards", "wins", "won", "nomination", "nominated"] }
];

function detectNewsEventType(item) {
  const titleUrl = normalizeTitle(
    String(item?.title || "") + " " +
    String(item?.url || "")
  );

  // Strong title/URL signals always win. Summary is only a fallback.
  const priority = [
    "death-tribute","box-office","release-date","ott","trailer","teaser",
    "first-look","poster","song","casting","announcement","shooting",
    "review","controversy","award","interview"
  ];

  for (const type of priority) {
    const pattern = NEWS_EVENT_PATTERNS.find(p => p.type === type);
    if (pattern && pattern.terms.some(term => titleUrl.includes(normalizeTitle(term)))) {
      return type;
    }
  }

  const summary = normalizeTitle(String(item?.summary || ""));
  for (const pattern of NEWS_EVENT_PATTERNS) {
    if (pattern.terms.some(term => summary.includes(normalizeTitle(term)))) {
      return pattern.type;
    }
  }

  return "general";
}

function newsEntityTokens(item) {
  const title = normalizeTitle(item?.title || "");
  let urlPath = "";
  try {
    urlPath = new URL(item?.url || "").pathname || "";
  } catch {
    urlPath = String(item?.url || "");
  }

  return new Set(
    (title + " " + normalizeTitle(urlPath))
      .split(/\s+/)
      .filter(Boolean)
      .filter(token => token.length >= 4)
      .filter(token => !NEWS_EVENT_STOP_WORDS.has(token))
      .filter(token => !/^\d+$/.test(token))
  );
}

function strongUrlEntityTokens(item) {
  let urlPath = "";
  try {
    urlPath = new URL(item?.url || "").pathname || "";
  } catch {
    urlPath = String(item?.url || "");
  }

  return new Set(
    normalizeTitle(urlPath)
      .split(/\s+/)
      .filter(Boolean)
      .filter(token => token.length >= 4)
      .filter(token => !NEWS_EVENT_STOP_WORDS.has(token))
      .filter(token => !/^\d+$/.test(token))
  );
}

function normalizeUrl(url = "") {
  try {
    const value = new URL(url);
    value.search = "";
    value.hash = "";
    return value.href.replace(/\/$/, "").toLowerCase();
  } catch {
    return String(url).toLowerCase().split("?")[0].split("#")[0].replace(/\/$/, "");
  }
}

function imageKey(url = "") {
  try {
    const value = new URL(url);
    value.search = "";
    value.hash = "";
    return (value.hostname + value.pathname).toLowerCase();
  } catch {
    return String(url).toLowerCase().split("?")[0].split("#")[0];
  }
}

function tokenOverlap(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) {
    if (b.has(token)) common++;
  }
  return common / Math.max(1, Math.min(a.size, b.size));
}

function headlineSimilarity(a, b) {
  const aa = new Set(normalizeTitle(a).split(/\s+/).filter(w => w.length > 2));
  const bb = new Set(normalizeTitle(b).split(/\s+/).filter(w => w.length > 2));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const word of aa) if (bb.has(word)) common++;
  return common / Math.max(aa.size, bb.size);
}

function sharedStrongUrlEntities(a, b) {
  const aa = strongUrlEntityTokens(a);
  const bb = strongUrlEntityTokens(b);
  return [...aa].filter(token => bb.has(token));
}

function newsTitleTokens(item) {
  return new Set(
    normalizeTitle(item?.title || "")
      .split(/\s+/)
      .filter(Boolean)
      .filter(token => token.length >= 4)
      .filter(token => !NEWS_EVENT_STOP_WORDS.has(token))
  );
}

function sameNewsEvent(a, b) {
  if (normalizeUrl(a.url) === normalizeUrl(b.url)) return true;

  const eventA = detectNewsEventType(a);
  const eventB = detectNewsEventType(b);

  if (eventA !== eventB) return false;

  const urlA = strongUrlEntityTokens(a);
  const urlB = strongUrlEntityTokens(b);
  const sharedUrl = sharedStrongUrlEntities(a, b);
  const titleA = newsTitleTokens(a);
  const titleB = newsTitleTokens(b);
  const sharedTitle = [...titleA].filter(token => titleB.has(token));

  const specificEvents = [
    "teaser","trailer","first-look","poster","song",
    "release-date","ott","box-office","death-tribute"
  ];

  if (specificEvents.includes(eventA)) {
    // Two or more shared URL entities = same underlying event.
    if (sharedUrl.length >= 2) return true;

    // One shared URL entity is enough when that entity appears in both titles.
    // This catches Bhogi teaser variants while avoiding actor-only matches.
    if (
      sharedUrl.length >= 1 &&
      sharedUrl.some(token => titleA.has(token) && titleB.has(token))
    ) {
      // Death/tribute stories are name-centric; one shared person/entity
      // token is sufficient to group the same death coverage.
      if (eventA === "death-tribute") return true;

      // For other events require another shared meaningful title entity,
      // unless both URLs are very short/focused slugs.
      if (sharedTitle.length >= 2) return true;
      if (urlA.size <= 2 && urlB.size <= 2) return true;
    }

    if (tokenOverlap(urlA, urlB) >= 0.50) return true;

    // Death/tribute safety net for abbreviated name slugs.
    if (
      eventA === "death-tribute" &&
      sharedUrl.length >= 1 &&
      (sharedTitle.length >= 1 || tokenOverlap(titleA, titleB) >= 0.12)
    ) return true;
  }

  // General events remain deliberately strict.
  if (
    tokenOverlap(newsEntityTokens(a), newsEntityTokens(b)) >= 0.80 &&
    sharedUrl.length >= 3
  ) {
    return true;
  }

  return false;
}

function findDuplicateAcceptedNews(candidate, acceptedNews) {
  for (const existing of acceptedNews) {
    if (sameNewsEvent(existing, candidate)) return existing;
  }

  const candidateImage = imageKey(candidate?.img || "");
  if (candidateImage) {
    for (const existing of acceptedNews) {
      if (
        candidateImage === imageKey(existing?.img || "") &&
        detectNewsEventType(existing) === detectNewsEventType(candidate)
      ) {
        return existing;
      }
    }
  }

  return null;
}

function choosePrimaryNewsStory(a, b) {
  const aImage = /^https?:\/\//i.test(a?.img || "") ? 1 : 0;
  const bImage = /^https?:\/\//i.test(b?.img || "") ? 1 : 0;

  if (bImage > aImage) return b;
  if (aImage > bImage) return a;

  const aSummary = String(a?.summary || "").length;
  const bSummary = String(b?.summary || "").length;

  if (bSummary > aSummary + 30) return b;
  if (aSummary > bSummary + 30) return a;

  const at = a?.publishedAt ? new Date(a.publishedAt).getTime() : 0;
  const bt = b?.publishedAt ? new Date(b.publishedAt).getTime() : 0;

  return bt > at ? b : a;
}

function dedupeNews(items) {
  /*
     Legacy safety wrapper retained for compatibility. The primary duplicate
     prevention now happens inside collectNews(), BEFORE each story is added.
  */
  const accepted = [];

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item.url || !item.img) continue;
    if (!findDuplicateAcceptedNews(item, accepted)) {
      accepted.push(item);
    }
  }

  return accepted;
}


/* =========================================================
   TRAILERS
   ========================================================= */

function isTrailerLink(
  link
) {

  const text =
    link.text
      .toLowerCase();


  const url =
    link.url
      .toLowerCase();


  if (
    text.length < 8
  ) {
    return false;
  }


  const keywords =
    [
      "official trailer",
      "trailer",
      "official teaser",
      "teaser",
      "glimpse"
    ];


  return keywords.some(
    keyword =>
      text.includes(
        keyword
      ) ||
      url.includes(
        keyword.replace(
          /\s+/g,
          "-"
        )
      )
  );
}


/* =========================================================
   YOUTUBE ID
   ========================================================= */

function extractYouTubeId(
  html
) {

  const patterns = [

    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/i,

    /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/i,

    /youtu\.be\/([A-Za-z0-9_-]{11})/i,

    /youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})/i
  ];


  for (
    const pattern of patterns
  ) {

    const match =
      html.match(
        pattern
      );


    if (
      match?.[1]
    ) {

      return match[1];
    }
  }


  return "";
}


/* =========================================================
   READ TRAILER
   ========================================================= */

async function readTrailer(
  source,
  candidate
) {

  const html =
    await fetchHTML(
      candidate.url
    );


  if (
    !html
  ) {
    return null;
  }


  const title =
    extractHeadline(
      html,
      candidate.text
    );


  if (
    !title ||
    !isTrailerLink(
      {
        text:
          title,

        url:
          candidate.url
      }
    )
  ) {

    return null;
  }


  /*
   * We only want Telugu trailers.
   */
  const combined =
    (
      title +
      " " +
      stripHTML(
        html
      )
    ).toLowerCase();


  const trailerWords =
    [
      "telugu",
      "tollywood",
      "telugu movie",
      "telugu film"
    ];


  const appearsTelugu =
    trailerWords.some(
      word =>
        combined.includes(
          word
        )
    );


  /*
   * IndiaGlitz Telugu is already
   * a Telugu section, so it does
   * not need the keyword check.
   */
  if (
    source.name !==
      "IndiaGlitz Telugu" &&
    !appearsTelugu
  ) {

    return null;
  }


  const image =
    extractImage(
      html
    );


  const youtubeId =
    extractYouTubeId(
      html
    );


  const thumbnail =
    youtubeId
      ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
      : image;


  const publishedAt =
    extractDate(
      html
    );


  return {

    id:
      candidate.url,

    title,

    source:
      source.name,

    url:
      candidate.url,

    img:
      thumbnail,

    youtubeId,

    publishedAt,

    language:
      "Telugu"
  };
}


/* =========================================================
   COLLECT TRAILERS
   ========================================================= */

async function collectTrailers() {

  const all = [];


  console.log("");
  console.log(
    "======================================"
  );
  console.log(
    "TELUGU TRAILERS"
  );
  console.log(
    "======================================"
  );


  for (
    const source of TRAILER_SOURCES
  ) {

    console.log("");
    console.log(
      `Loading ${source.name}: ${source.url}`
    );


    const html =
      await fetchHTML(
        source.url
      );


    if (
      !html
    ) {
      continue;
    }


    const links =
      extractLinks(
        html,
        source.url
      );


    const candidates =
      links
        .filter(
          isTrailerLink
        )
        .slice(
          0,
          15
        );


    console.log(
      `${source.name}: ${candidates.length} trailer candidates`
    );


    for (
      const candidate of
        candidates
    ) {

      const trailer =
        await readTrailer(
          source,
          candidate
        );


      if (
        trailer
      ) {

        console.log(
          `${source.name} | ${trailer.title}`
        );


        all.push(
          trailer
        );
      }
    }
  }


  return dedupeTrailers(
    all
  )
    .sort(
      (a, b) => {

        const ad =
          a.publishedAt
            ? new Date(
                a.publishedAt
              ).getTime()
            : 0;

        const bd =
          b.publishedAt
            ? new Date(
                b.publishedAt
              ).getTime()
            : 0;

        return bd - ad;
      }
    )
    .slice(
      0,
      12
    );
}


function dedupeTrailers(
  items
) {

  const output = [];


  for (
    const item of items
  ) {

    const duplicate =
      output.some(
        existing => {

          if (
            existing.url ===
            item.url
          ) {
            return true;
          }


          return (
            headlineSimilarity(
              existing.title,
              item.title
            ) >= 0.75
          );
        }
      );


    if (
      !duplicate
    ) {

      output.push(
        item
      );
    }
  }


  return output;
}


/* =========================================================
   REVIEW DATE
   ========================================================= */

function extractReleaseDate(
  text
) {

  const clean =
    text.replace(
      /\s+/g,
      " "
    );


  const patterns = [

    /Release\s*Date\s*:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i,

    /Release\s*Date\s*:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,

    /Streaming\s*Date\s*:\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i,

    /Streaming\s*Date\s*:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,

    /Release\s*Date\s*[-–—]\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i,

    /Streaming\s*Date\s*[-–—]\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/i
  ];


  for (
    const pattern of patterns
  ) {

    const match =
      clean.match(
        pattern
      );


    if (
      match?.[1]
    ) {

      const date =
        new Date(
          match[1]
        );


      if (
        !Number.isNaN(
          date.getTime()
        )
      ) {

        return date
          .toISOString()
          .slice(
            0,
            10
          );
      }
    }
  }


  return null;
}


/* =========================================================
   REVIEW TITLE
   ========================================================= */

function cleanTitle(
  title = ""
) {

  let t =
    decodeEntities(
      title
    )
      .replace(
        /\u200b/g,
        ""
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();


  t = t
    .replace(
      /^['"“”‘’]+/,
      ""
    )
    .replace(
      /['"“”‘’]+$/,
      ""
    )
    .trim();


  t = t.replace(
    /^movie\s*name\s*:\s*/i,
    ""
  );


  t = t.replace(
    /\s+(?:release|streaming)\s+date\s*:.*$/i,
    ""
  );


  t = t.replace(
    /\s+123telugu\.com\s+rating\s*:.*$/i,
    ""
  );


  t = t
    .replace(
      /^review\s*:\s*/i,
      ""
    )
    .replace(
      /^movie\s+review\s*:\s*/i,
      ""
    )
    .replace(
      /^telugu\s+movie\s+review\s*:\s*/i,
      ""
    )
    .replace(
      /^ott\s+review\s*:\s*/i,
      ""
    );


  t = t.replace(
    /\s+(?:movie\s+)?review\s*[:\-–—].*$/i,
    ""
  );


  t = t.replace(
    /\s+movie\s+review\s*$/i,
    ""
  );


  t = t.replace(
    /\s+review\s*$/i,
    ""
  );


  const lower =
    t.toLowerCase();


  if (
    lower.includes(
      "the paradise"
    )
  ) {
    return "The Paradise";
  }


  if (
    lower.includes(
      "mahendragiri varahi"
    )
  ) {
    return "Mahendragiri Varahi";
  }


  if (
    lower.includes(
      "epic first semester"
    ) ||
    lower === "epic"
  ) {
    return "Epic First Semester";
  }


  if (
    lower.includes(
      "ramba oorvasi menaka"
    ) ||
    lower.includes(
      "ramba oorvashi menaka"
    )
  ) {
    return "Ramba Oorvasi Menaka";
  }


  if (
    lower.includes(
      "sardar 2"
    ) ||
    lower.includes(
      "sardaar 2"
    )
  ) {
    return "Sardar 2";
  }


  if (
    lower.includes(
      "bethlehem kudumba unit"
    )
  ) {
    return "Bethlehem Kudumba Unit";
  }


  if (
    lower.includes(
      "i'm game"
    ) ||
    lower.includes(
      "im game"
    )
  ) {
    return "I'm Game";
  }


  if (
    lower.includes(
      "romanchakam"
    )
  ) {
    return "Romanchakam";
  }


  if (
    lower.includes(
      "irumudi"
    )
  ) {
    return "Irumudi";
  }


  if (
    lower.includes(
      "pallaburusu"
    )
  ) {
    return "Pallaburusu";
  }


  if (
    lower.includes(
      "toxic"
    ) &&
    lower.length < 30
  ) {
    return "Toxic";
  }


  return t;
}


/* =========================================================
   REVIEW TITLE EXTRACTION
   ========================================================= */

function extractMovieTitle(
  source,
  html,
  candidateText,
  pageText
) {

  if (
    source.name ===
    "123telugu"
  ) {

    const match =
      pageText.match(
        /Movie\s*Name\s*:\s*(.+?)(?:\s+(?:Release|Streaming)\s+Date\s*:|\s+123telugu\.com\s+Rating\s*:)/i
      );


    if (
      match?.[1]
    ) {

      return cleanTitle(
        match[1]
      );
    }
  }


  if (
    source.name ===
    "GreatAndhra"
  ) {

    const match =
      pageText.match(
        /Movie\s*:\s*(.+?)\s+Rating\s*:/i
      );


    if (
      match?.[1]
    ) {

      return cleanTitle(
        match[1]
      );
    }
  }


  return cleanTitle(
    extractHeadline(
      html,
      candidateText
    )
  );
}


/* =========================================================
   REVIEW RATING
   ========================================================= */

function extractRating(
  text,
  source
) {

  const clean =
    text.replace(
      /\s+/g,
      " "
    );


  const patterns = {

    GreatAndhra: [
      /Movie\s*:\s*.*?Rating\s*:\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /Rating\s*:\s*(\d+(?:\.\d+)?)\s*\/\s*5/i
    ],

    Gulte: [
      /Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /(?:^|\s)(\d+(?:\.\d+)?)\s*\/\s*5/i
    ],

    "M9.news": [
      /(?:OUR\s+)?RATING\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /M9\s*Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i
    ],

    Telugu360: [
      /Telugu360\s*Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i
    ],

    "123telugu": [
      /123telugu(?:\.com)?\s*Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i
    ]
  };


  for (
    const pattern of
      patterns[source] || []
  ) {

    const match =
      clean.match(
        pattern
      );


    if (
      !match
    ) {
      continue;
    }


    const rating =
      Number(
        match[1]
      );


    if (
      Number.isFinite(
        rating
      ) &&
      rating >= 0 &&
      rating <= 5
    ) {

      return rating;
    }
  }


  return null;
}


/* =========================================================
   REVIEW CANDIDATES
   ========================================================= */

function isReviewLink(
  source,
  link
) {

  const url =
    link.url.toLowerCase();

  const text =
    link.text.toLowerCase();


  if (
    !url.includes(
      source.domain
    )
  ) {
    return false;
  }


  if (
    isBadTitle(
      link.text
    )
  ) {
    return false;
  }


  if (
    link.text.length < 4 ||
    link.text.length > 250
  ) {
    return false;
  }


  if (
    source.name ===
    "GreatAndhra"
  ) {

    return (
      url.includes(
        "/movies/reviews/"
      ) &&
      url !==
        source.archive
    );
  }


  if (
    source.name ===
    "Gulte"
  ) {

    return url.includes(
      "/moviereviews/"
    );
  }


  if (
    source.name ===
    "M9.news"
  ) {

    return (
      url.includes(
        "m9.news/reviews/"
      ) &&
      url !==
        source.archive
    );
  }


  if (
    source.name ===
    "Telugu360"
  ) {

    return (
      url.includes(
        "-movie-review"
      ) ||
      url.includes(
        "-review/"
      )
    );
  }


  if (
    source.name ===
    "123telugu"
  ) {

    return (
      url.includes(
        "123telugu.com/reviews/"
      ) ||
      (
        url.includes(
          "123telugu.com/telugu/"
        ) &&
        text.includes(
          "review"
        )
      )
    );
  }


  return false;
}


/* =========================================================
   REVIEW CANDIDATES
   ========================================================= */

async function getReviewCandidates(
  source
) {

  console.log(
    `Loading ${source.name}: ${source.archive}`
  );


  const html =
    await fetchHTML(
      source.archive
    );


  if (
    !html
  ) {
    return [];
  }


  const links =
    extractLinks(
      html,
      source.archive
    );


  const candidates =
    uniqueLinks(
      links.filter(
        link =>
          isReviewLink(
            source,
            link
          )
      )
    );


  console.log(
    `${source.name}: found ${candidates.length} review links`
  );


  return candidates.slice(
    0,
    20
  );
}


/* =========================================================
   READ REVIEW
   ========================================================= */

async function readReview(
  source,
  candidate
) {

  const html =
    await fetchHTML(
      candidate.url
    );


  if (
    !html
  ) {
    return null;
  }


  const pageText =
    stripHTML(
      html
    );


  const movie =
    extractMovieTitle(
      source,
      html,
      candidate.text,
      pageText
    );


  const lowerMovie =
    (
      movie ||
      ""
    )
      .trim()
      .toLowerCase();


  if (
    !movie ||
    movie.length < 2 ||
    movie.length > 100 ||
    [
      "movie reviews",
      "reviews",
      "review",
      "movie review",
      "latest reviews",
      "review archives"
    ].includes(
      lowerMovie
    )
  ) {

    return null;
  }


  const rating =
    extractRating(
      pageText,
      source.name
    );


  const releaseDate =
    extractReleaseDate(
      pageText
    );


  const image =
    extractImage(
      html
    );


  return {

    source:
      source.name,

    movie,

    releaseDate,

    rating,

    ratingText:
      rating === null
        ? "Not available"
        : `${rating}/5`,

    url:
      candidate.url,

    image
  };
}


/* =========================================================
   REVIEW TITLE MATCHING
   ========================================================= */

function titleTokens(
  title
) {

  return new Set(
    cleanTitle(
      title
    )
      .toLowerCase()
      .replace(
        /&/g,
        " and "
      )
      .replace(
        /['’]/g,
        ""
      )
      .replace(
        /[^a-z0-9]+/g,
        " "
      )
      .split(
        /\s+/
      )
      .filter(Boolean)
      .filter(
        word =>
          ![
            "movie",
            "review",
            "rating",
            "film",
            "telugu",
            "ott",
            "the"
          ].includes(
            word
          )
      )
  );
}


function titlesMatch(
  a,
  b
) {

  const aa =
    titleTokens(
      a
    );

  const bb =
    titleTokens(
      b
    );


  if (
    !aa.size ||
    !bb.size
  ) {
    return false;
  }


  if (
    aa.size ===
      bb.size &&
    [...aa].every(
      token =>
        bb.has(
          token
        )
    )
  ) {

    return true;
  }


  const smaller =
    aa.size <=
      bb.size
      ? aa
      : bb;


  const larger =
    aa.size <=
      bb.size
      ? bb
      : aa;


  if (
    smaller.size >= 1 &&
    [...smaller].every(
      token =>
        larger.has(
          token
        )
    )
  ) {

    return true;
  }


  let common = 0;


  for (
    const token of aa
  ) {

    if (
      bb.has(
        token
      )
    ) {

      common++;
    }
  }


  return (
    common /
    Math.max(
      aa.size,
      bb.size
    )
  ) >= 0.7;
}


/* =========================================================
   GROUP REVIEWS
   ========================================================= */

function groupReviews(
  reviews
) {

  const groups = [];


  for (
    const review of reviews
  ) {

    let group =
      groups.find(
        item =>
          titlesMatch(
            item.movie,
            review.movie
          )
      );


    if (
      !group
    ) {

      group = {

        movie:
          review.movie,

        releaseDate:
          review.releaseDate ||
          null,

        image:
          review.image ||
          "",

        reviews:
          []
      };


      groups.push(
        group
      );

    } else {

      if (
        review.releaseDate &&
        (
          !group.releaseDate ||
          review.releaseDate >
            group.releaseDate
        )
      ) {

        group.releaseDate =
          review.releaseDate;
      }
    }


    const existing =
      group.reviews.find(
        item =>
          item.source ===
          review.source
      );


    if (
      existing
    ) {

      continue;
    }


    group.reviews.push(
      review
    );


    if (
      !group.image &&
      review.image
    ) {

      group.image =
        review.image;
    }
  }


  return groups;
}


/* =========================================================
   REVIEW AVERAGE
   ========================================================= */

function calculateAverage(
  reviews
) {

  const ratings =
    reviews
      .map(
        item =>
          item.rating
      )
      .filter(
        value =>
          typeof value ===
            "number" &&
          Number.isFinite(
            value
          )
      );


  if (
    !ratings.length
  ) {

    return null;
  }


  const average =
    ratings.reduce(
      (
        sum,
        value
      ) =>
        sum + value,
      0
    ) /
    ratings.length;


  return Math.round(
    average * 100
  ) / 100;
}


/* =========================================================
   BUILD REVIEWS
   ========================================================= */

function buildReviews(
  groups
) {

  return groups

    .map(
      group => {

        const average =
          calculateAverage(
            group.reviews
          );


        const sources =
          REVIEW_SOURCE_NAMES.map(
            name => {

              const found =
                group.reviews.find(
                  review =>
                    review.source ===
                    name
                );


              if (
                !found
              ) {

                return {

                  source:
                    name,

                  rating:
                    null,

                  ratingText:
                    "Not available",

                  url:
                    ""
                };
              }


              return {

                source:
                  name,

                rating:
                  found.rating,

                ratingText:
                  found.ratingText,

                url:
                  found.url
              };
            }
          );


        return {

          t:
            group.movie,

          l:
            "Telugu",

          releaseDate:
            group.releaseDate ||
            null,

          rating:
            average === null
              ? "Not available"
              : `${average}/5`,

          img:
            group.image ||
            "",

          source:
            "GreatAndhra • Gulte • M9.news • Telugu360 • 123telugu",

          u:
            group.reviews[0]?.url ||
            "",

          aggregator: {

            average,

            sources
          }
        };
      }
    )

    /*
     * NEWEST RELEASE FIRST
     */
    .sort(
      (
        a,
        b
      ) => {

        const ad =
          a.releaseDate
            ? new Date(
                a.releaseDate
              ).getTime()
            : 0;


        const bd =
          b.releaseDate
            ? new Date(
                b.releaseDate
              ).getTime()
            : 0;


        return bd - ad;
      }
    );
}


/* =========================================================
   MAIN
   ========================================================= */

async function main() {

  console.log("");
  console.log(
    "======================================"
  );
  console.log(
    "CINEINSTA FEED UPDATE"
  );
  console.log(
    "======================================"
  );


  /* -------------------------------------------------------
     NEWS
     ------------------------------------------------------- */

  const news =
    await collectNews();


  console.log("");
  console.log(
    `Final Telugu news: ${news.length}`
  );


  /* -------------------------------------------------------
     TRAILERS
     ------------------------------------------------------- */

  const trailers =
    await collectTrailers();


  console.log("");
  console.log(
    `Final Telugu trailers: ${trailers.length}`
  );


  /* -------------------------------------------------------
     REVIEWS
     ------------------------------------------------------- */

  const allReviews = [];


  console.log("");
  console.log(
    "======================================"
  );
  console.log(
    "TELUGU REVIEWS"
  );
  console.log(
    "======================================"
  );


  for (
    const source of REVIEW_SOURCES
  ) {

    console.log("");
    console.log(
      `========== ${source.name} ==========`
    );


    const candidates =
      await getReviewCandidates(
        source
      );


    for (
      const candidate of
        candidates
    ) {

      const review =
        await readReview(
          source,
          candidate
        );


      if (
        !review
      ) {
        continue;
      }


      console.log(
        `${source.name} | ${review.movie} | ${review.releaseDate || "No release date"} | ${review.ratingText}`
      );


      allReviews.push(
        review
      );
    }
  }


  console.log("");
  console.log(
    `Raw reviews collected: ${allReviews.length}`
  );


  const groups =
    groupReviews(
      allReviews
    );


  console.log(
    `Movies after grouping: ${groups.length}`
  );


  const reviews =
    buildReviews(
      groups
    );


  /* -------------------------------------------------------
     EXISTING FEED
     ------------------------------------------------------- */

  let existingFeed = {
    news: [],
    trailers: [],
    reviews: []
  };


  try {

    const existing =
      await fs.readFile(
        "data/feed.json",
        "utf8"
      );


    existingFeed =
      JSON.parse(
        existing
      );

  } catch {

    console.log(
      "Existing feed.json not found."
    );
  }


  /* -------------------------------------------------------
     FINAL FEED
     ------------------------------------------------------- */

  const feed = {

    updatedAt:
      new Date().toISOString(),

    language:
      "Telugu",

    news,

    trailers,

    reviews
  };


  await fs.mkdir(
    "data",
    {
      recursive: true
    }
  );


  await fs.writeFile(
    "data/feed.json",
    JSON.stringify(
      feed,
      null,
      2
    ),
    "utf8"
  );


  console.log("");
  console.log(
    "======================================"
  );
  console.log(
    "FEED COMPLETE"
  );
  console.log(
    "======================================"
  );


  console.log(
    `News: ${news.length}`
  );

  console.log(
    `Trailers: ${trailers.length}`
  );

  console.log(
    `Reviews: ${reviews.length}`
  );

  console.log(
    "feed.json updated successfully."
  );
}


/* =========================================================
   RUN
   ========================================================= */

main().catch(
  error => {

    console.error("");
    console.error(
      "Cineinsta feed updater failed:"
    );

    console.error(
      error
    );

    process.exit(
      1
    );
  }
);
