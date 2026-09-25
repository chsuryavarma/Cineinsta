import fs from "node:fs/promises";

const SOURCES = [
  {
    name: "GreatAndhra",
    archive: "https://www.greatandhra.com/movies/reviews/",
    domain: "greatandhra.com"
  },
  {
    name: "Gulte",
    archive: "https://www.gulte.com/moviereviews",
    domain: "gulte.com"
  },
  {
    name: "M9.news",
    archive: "https://www.m9.news/reviews/",
    domain: "m9.news"
  },
  {
    name: "Telugu360",
    archive:
      "https://www.telugu360.com/category/movies/telugu-movies-reviews/",
    domain: "telugu360.com"
  },
  {
    name: "123telugu",
    archive: "https://www.123telugu.com/category/reviews/",
    domain: "123telugu.com"
  }
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";

async function fetchHTML(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      console.log(`FAILED ${response.status}: ${url}`);
      return "";
    }

    return await response.text();
  } catch (error) {
    console.log(`FAILED ${url}`);
    console.log(error.message);
    return "";
  }
}

function decodeEntities(text = "") {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#8217;/gi, "'")
    .replace(/&#8216;/gi, "'")
    .replace(/&#8220;/gi, '"')
    .replace(/&#8221;/gi, '"')
    .replace(/&#8211;/gi, "-")
    .replace(/&#8212;/gi, "-")
    .replace(/&#8230;/gi, "...")
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCharCode(Number(n));
      } catch {
        return "";
      }
    });
}

function stripHTML(html = "") {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function absoluteUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return "";
  }
}

function extractLinks(html, baseUrl) {
  const links = [];

  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = regex.exec(html))) {
    const url = absoluteUrl(match[1], baseUrl);
    const text = stripHTML(match[2]);

    if (!url || !text) continue;

    links.push({
      url,
      text
    });
  }

  return links;
}

function uniqueLinks(links) {
  const map = new Map();

  for (const link of links) {
    if (!map.has(link.url)) {
      map.set(link.url, link);
    }
  }

  return [...map.values()];
}

function extractMeta(html, property) {
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

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match?.[1]) {
      return decodeEntities(match[1]).trim();
    }
  }

  return "";
}

function extractHeadline(html, fallback = "") {
  const h1 = html.match(
    /<h1[^>]*>([\s\S]*?)<\/h1>/i
  );

  if (h1?.[1]) {
    return stripHTML(h1[1]);
  }

  const ogTitle = extractMeta(html, "og:title");

  if (ogTitle) {
    return ogTitle;
  }

  const title = html.match(
    /<title[^>]*>([\s\S]*?)<\/title>/i
  );

  if (title?.[1]) {
    return stripHTML(title[1]);
  }

  return fallback;
}

function isBadLink(text) {
  const value = text.trim().toLowerCase();

  const bad = [
    "skip to main content",
    "view all",
    "read more",
    "more",
    "menu",
    "home",
    "contact",
    "advertise",
    "privacy",
    "terms",
    "movie reviews",
    "reviews"
  ];

  return bad.includes(value);
}

function isReviewLink(source, link) {
  const url = link.url.toLowerCase();
  const text = link.text.toLowerCase();

  if (!url.includes(source.domain)) {
    return false;
  }

  if (isBadLink(link.text)) {
    return false;
  }

  if (link.text.length < 4 || link.text.length > 250) {
    return false;
  }

  if (source.name === "GreatAndhra") {
    return (
      url.includes("/movies/reviews/") &&
      url !== source.archive
    );
  }

  if (source.name === "Gulte") {
    return url.includes("/moviereviews/");
  }

  if (source.name === "M9.news") {
    return (
      url.includes("m9.news/reviews/") &&
      url !== "https://www.m9.news/reviews/"
    );
  }

  if (source.name === "Telugu360") {
    return (
      url.includes("telugu360.com/") &&
      (
        url.includes("-movie-review") ||
        url.includes("-review/")
      )
    );
  }

  if (source.name === "123telugu") {
    return (
      url.includes("123telugu.com/reviews/") ||
      (
        url.includes("123telugu.com/telugu/") &&
        text.includes("review")
      )
    );
  }

  return false;
}

function cleanTitle(title = "") {
  let t = decodeEntities(title)
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  t = t
    .replace(/^['"“”‘’]+/, "")
    .replace(/['"“”‘’]+$/, "")
    .trim();

  /*
   * 123telugu
   */
  t = t.replace(
    /^movie\s*name\s*:\s*/i,
    ""
  );

  t = t.replace(
    /\s+release\s+date\s*:.*$/i,
    ""
  );

  t = t.replace(
    /\s+123telugu\.com\s+rating\s*:.*$/i,
    ""
  );

  /*
   * Generic review prefixes.
   */
  t = t
    .replace(/^review\s*:\s*/i, "")
    .replace(/^movie\s+review\s*:\s*/i, "")
    .replace(/^telugu\s+movie\s+review\s*:\s*/i, "")
    .replace(/^ott\s+review\s*:\s*/i, "");

  /*
   * Remove common suffixes.
   */
  t = t
    .replace(/\s*[-|]\s*gulte\s*$/i, "")
    .replace(/\s*[-|]\s*123telugu.*$/i, "")
    .replace(/\s*[-|]\s*m9\.news.*$/i, "")
    .replace(/\s*[-|]\s*telugu360.*$/i, "");

  /*
   * GreatAndhra / Telugu360 headlines.
   */
  t = t.replace(
    /\s+(?:movie\s+)?review\s*[:\-–—].*$/i,
    ""
  );

  /*
   * Gulte / M9 headlines.
   */
  t = t.replace(
    /\s+review\s*[:\-–—].*$/i,
    ""
  );

  /*
   * If "Movie Review" appears at the end.
   */
  t = t.replace(
    /\s+movie\s+review\s*$/i,
    ""
  );

  t = t.replace(
    /\s+review\s*$/i,
    ""
  );

  /*
   * Known titles.
   */
  const lower = t.toLowerCase();

  if (lower.includes("the paradise")) {
    return "The Paradise";
  }

  if (lower.includes("mahendragiri varahi")) {
    return "Mahendragiri Varahi";
  }

  if (
    lower.includes("epic first semester") ||
    lower === "epic"
  ) {
    return "Epic First Semester";
  }

  if (
    lower.includes("ramba oorvasi menaka") ||
    lower.includes("ramba oorvashi menaka")
  ) {
    return "Ramba Oorvasi Menaka";
  }

  if (
    lower.includes("sardar 2") ||
    lower.includes("sardaar 2")
  ) {
    return "Sardar 2";
  }

  return t.trim();
}

function extractMovieTitle(source, html, candidateText, pageText) {
  /*
   * 123telugu has a very reliable Movie Name field.
   */
  if (source.name === "123telugu") {
    const match = pageText.match(
      /Movie\s*Name\s*:\s*(.+?)(?:\s+Release\s+Date\s*:|\s+123telugu\.com\s+Rating\s*:)/i
    );

    if (match?.[1]) {
      return cleanTitle(match[1]);
    }
  }

  /*
   * GreatAndhra has:
   * Movie: The Paradise Rating: 2/5
   */
  if (source.name === "GreatAndhra") {
    const match = pageText.match(
      /Movie\s*:\s*(.+?)\s+Rating\s*:/i
    );

    if (match?.[1]) {
      return cleanTitle(match[1]);
    }
  }

  /*
   * Page headline is best for M9, Gulte and Telugu360.
   */
  const headline = extractHeadline(
    html,
    candidateText
  );

  return cleanTitle(headline || candidateText);
}

function extractRating(text, source) {
  const clean = text.replace(/\s+/g, " ");

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
      /RATING\s+(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /M9\s*Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i
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

  for (const pattern of patterns[source] || []) {
    const match = clean.match(pattern);

    if (!match) continue;

    const rating = Number(match[1]);

    if (
      Number.isFinite(rating) &&
      rating >= 0 &&
      rating <= 5
    ) {
      return rating;
    }
  }

  return null;
}

function extractImage(html) {
  return (
    extractMeta(html, "og:image") ||
    extractMeta(html, "twitter:image") ||
    ""
  );
}

async function getCandidates(source) {
  console.log(
    `Loading ${source.name}: ${source.archive}`
  );

  const html = await fetchHTML(source.archive);

  if (!html) {
    return [];
  }

  const links = extractLinks(
    html,
    source.archive
  );

  const candidates = uniqueLinks(
    links.filter(link =>
      isReviewLink(source, link)
    )
  );

  console.log(
    `${source.name}: found ${candidates.length} review links`
  );

  return candidates.slice(0, 20);
}

async function readReview(source, candidate) {
  const html = await fetchHTML(candidate.url);

  if (!html) {
    return null;
  }

  const pageText = stripHTML(html);

  const movie = extractMovieTitle(
    source,
    html,
    candidate.text,
    pageText
  );

  if (
    !movie ||
    movie.length < 2 ||
    movie.length > 100
  ) {
    return null;
  }

  const rating = extractRating(
    pageText,
    source.name
  );

  const image = extractImage(html);

  return {
    source: source.name,
    movie,
    rating,
    ratingText:
      rating === null
        ? "Not available"
        : `${rating}/5`,
    url: candidate.url,
    image
  };
}

function titleTokens(title) {
  return new Set(
    cleanTitle(title)
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
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
          ].includes(word)
      )
  );
}

function titlesMatch(a, b) {
  const aa = titleTokens(a);
  const bb = titleTokens(b);

  if (!aa.size || !bb.size) {
    return false;
  }

  /*
   * Exact token match.
   */
  if (
    aa.size === bb.size &&
    [...aa].every(x => bb.has(x))
  ) {
    return true;
  }

  /*
   * One title is a shortened version of the other.
   * Example:
   * Epic
   * Epic First Semester
   */
  const smaller =
    aa.size <= bb.size ? aa : bb;

  const larger =
    aa.size <= bb.size ? bb : aa;

  if (
    smaller.size >= 1 &&
    [...smaller].every(x => larger.has(x))
  ) {
    return true;
  }

  /*
   * Token overlap.
   */
  let common = 0;

  for (const token of aa) {
    if (bb.has(token)) {
      common++;
    }
  }

  const overlap =
    common / Math.max(aa.size, bb.size);

  return overlap >= 0.7;
}

function groupReviews(reviews) {
  const groups = [];

  for (const review of reviews) {
    let group = groups.find(
      item =>
        titlesMatch(
          item.movie,
          review.movie
        )
    );

    if (!group) {
      group = {
        movie: review.movie,
        image: review.image || "",
        reviews: []
      };

      groups.push(group);
    }

    /*
     * Never duplicate the same source
     * inside one movie.
     */
    const existing =
      group.reviews.find(
        item =>
          item.source ===
          review.source
      );

    if (existing) {
      return;
    }

    group.reviews.push(review);

    if (
      !group.image &&
      review.image
    ) {
      group.image = review.image;
    }
  }

  return groups;
}

function calculateAverage(reviews) {
  const ratings = reviews
    .map(x => x.rating)
    .filter(
      x =>
        typeof x === "number" &&
        Number.isFinite(x)
    );

  if (!ratings.length) {
    return null;
  }

  const average =
    ratings.reduce(
      (sum, value) =>
        sum + value,
      0
    ) / ratings.length;

  return Math.round(
    average * 100
  ) / 100;
}

function buildReviews(groups) {
  const SOURCE_NAMES = [
    "GreatAndhra",
    "Gulte",
    "M9.news",
    "Telugu360",
    "123telugu"
  ];

  return groups
    .map(group => {
      const average =
        calculateAverage(
          group.reviews
        );

      const sources =
        SOURCE_NAMES.map(
          name => {
            const found =
              group.reviews.find(
                review =>
                  review.source ===
                  name
              );

            if (!found) {
              return {
                source: name,
                rating: null,
                ratingText:
                  "Not available",
                url: ""
              };
            }

            return {
              source: name,
              rating: found.rating,
              ratingText:
                found.ratingText,
              url: found.url
            };
          }
        );

      return {
        t: group.movie,
        l: "Telugu",

        rating:
          average === null
            ? "Not available"
            : `${average}/5`,

        img:
          group.image || "",

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
    })
    .sort((a, b) => {
      const ar =
        a.aggregator.average ?? -1;

      const br =
        b.aggregator.average ?? -1;

      return br - ar;
    });
}

async function main() {
  console.log("");
  console.log("======================================");
  console.log("CINEINSTA REVIEW AGGREGATOR");
  console.log("======================================");
  console.log("");

  const allReviews = [];

  for (const source of SOURCES) {
    console.log("");
    console.log(
      `========== ${source.name} ==========`
    );

    const candidates =
      await getCandidates(source);

    for (const candidate of candidates) {
      const review =
        await readReview(
          source,
          candidate
        );

      if (!review) {
        continue;
      }

      console.log(
        `${source.name} | ${review.movie} | ${review.ratingText}`
      );

      allReviews.push(review);
    }
  }

  console.log("");
  console.log(
    `Raw reviews collected: ${allReviews.length}`
  );

  const groups =
    groupReviews(allReviews);

  console.log(
    `Movies after grouping: ${groups.length}`
  );

  console.log("");

  for (const group of groups) {
    const average =
      calculateAverage(
        group.reviews
      );

    console.log(
      `${group.movie} | Average: ${
        average === null
          ? "Not available"
          : average
      }`
    );

    for (const review of group.reviews) {
      console.log(
        `   ${review.source}: ${review.ratingText}`
      );
    }
  }

  const reviews =
    buildReviews(groups);

  let existingFeed = {
    news: []
  };

  try {
    const existing =
      await fs.readFile(
        "data/feed.json",
        "utf8"
      );

    existingFeed =
      JSON.parse(existing);
  } catch {
    console.log(
      "Existing feed.json not found. Creating new feed."
    );
  }

  const feed = {
    updatedAt:
      new Date().toISOString(),

    news:
      Array.isArray(
        existingFeed.news
      )
        ? existingFeed.news
        : [],

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
    `Saved ${reviews.length} aggregated movies.`
  );

  console.log(
    "feed.json updated successfully."
  );
}

main().catch(error => {
  console.error("");
  console.error(
    "Cineinsta review aggregator failed:"
  );
  console.error(error);
  process.exit(1);
});
