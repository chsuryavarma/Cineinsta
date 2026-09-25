import fs from "node:fs/promises";

const SOURCES = [
  {
    name: "GreatAndhra",
    url: "https://www.greatandhra.com/",
    domain: "greatandhra.com"
  },
  {
    name: "Gulte",
    url: "https://www.gulte.com/moviereviews",
    domain: "gulte.com"
  },
  {
    name: "M9.news",
    url: "https://www.m9.news/",
    domain: "m9.news"
  },
  {
    name: "Telugu360",
    url: "https://www.telugu360.com/category/movies/telugu-movies-reviews/",
    domain: "telugu360.com"
  },
  {
    name: "123telugu",
    url: "https://www.123telugu.com/category/reviews/",
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
    console.log(`FAILED: ${url}`);
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

function looksLikeReview(source, link) {
  const value =
    `${link.text} ${link.url}`.toLowerCase();

  if (!value.includes(source.domain)) {
    return false;
  }

  if (
    link.text.length < 5 ||
    link.text.length > 250
  ) {
    return false;
  }

  const badWords = [
    "skip to main",
    "view all",
    "read more",
    "more",
    "menu",
    "home",
    "contact",
    "advertise",
    "privacy",
    "terms"
  ];

  if (
    badWords.some(word =>
      link.text.trim().toLowerCase() === word
    )
  ) {
    return false;
  }

  return (
    value.includes("review") ||
    value.includes("movie-review") ||
    value.includes("moviereview") ||
    value.includes("/reviews/")
  );
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

function extractTitleFromPage(html, fallback) {
  const ogTitle = extractMeta(html, "og:title");

  if (ogTitle) {
    return cleanMovieTitle(ogTitle);
  }

  const titleMatch =
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  if (titleMatch?.[1]) {
    return cleanMovieTitle(titleMatch[1]);
  }

  return cleanMovieTitle(fallback);
}

function extractMovieNameFromText(text) {
  const patterns = [
    /Movie\s*:\s*([^|]{2,100}?)(?:\s+Rating\s*:|\s+Banner\s*:)/i,
    /Movie\s*Name\s*:\s*([^|]{2,100}?)(?:\s+Rating\s*:)/i,
    /Film\s*:\s*([^|]{2,100}?)(?:\s+Rating\s*:)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return cleanMovieTitle(match[1]);
    }
  }

  return "";
}

function cleanMovieTitle(title = "") {
  let t = decodeEntities(title)
    .replace(/\s+/g, " ")
    .trim();

  t = t
    .replace(/^\s*['"“”‘’]+/, "")
    .replace(/['"“”‘’]+\s*$/g, "");

  const removePatterns = [
    /^movie review\s*:\s*/i,
    /^movie review\s+/i,
    /^telugu movie review\s*:\s*/i,
    /^telugu movie review\s+/i,
    /^movie review and rating\s*:\s*/i,
    /^review and rating\s*:\s*/i,
    /^review\s*:\s*/i,
    /^review\s+/i
  ];

  for (const pattern of removePatterns) {
    t = t.replace(pattern, "");
  }

  /*
   * Remove common review-site headline suffixes.
   */
  t = t
    .replace(/\s*[-|:]\s*(movie review|review).*$/i, "")
    .replace(/\s*\|\s*.*$/i, "")
    .trim();

  /*
   * Specific headline cleanups.
   */
  t = t
    .replace(/^the\s+paradise\s+movie\s+review.*$/i, "The Paradise")
    .replace(/^the\s+paradise\s+review.*$/i, "The Paradise")
    .replace(/^nani['’]s\s+the\s+paradise.*$/i, "The Paradise")
    .replace(/^the\s+paradise.*$/i, "The Paradise");

  return t.trim();
}

function normalizeTitle(title = "") {
  let t = cleanMovieTitle(title).toLowerCase();

  /*
   * Known aliases / titles.
   */
  if (
    t.includes("the paradise") ||
    t.includes("nani's the paradise") ||
    t.includes("nani the paradise")
  ) {
    return "the paradise";
  }

  if (
    t.includes("mahendragiri varahi")
  ) {
    return "mahendragiri varahi";
  }

  if (
    t.includes("epic first semester") ||
    t === "epic"
  ) {
    return "epic first semester";
  }

  if (
    t.includes("ramba oorvasi menaka") ||
    t.includes("ramba oorvashi menaka")
  ) {
    return "ramba oorvasi menaka";
  }

  if (
    t.includes("sardar 2") ||
    t.includes("sardaar 2")
  ) {
    return "sardar 2";
  }

  return t
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(movie|review|rating|telugu|film|first report)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
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
      /(\d+(?:\.\d+)?)\s*\/\s*5/i
    ],

    "M9.news": [
      /Our\s*Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /M9(?:\.news)?\s*Rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
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

  for (const pattern of patterns[source] || []) {
    const match = clean.match(pattern);

    if (match) {
      const rating = Number(match[1]);

      if (
        Number.isFinite(rating) &&
        rating >= 0 &&
        rating <= 5
      ) {
        return rating;
      }
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

function extractDescription(html) {
  return (
    extractMeta(html, "og:description") ||
    extractMeta(html, "description") ||
    ""
  ).slice(0, 240);
}

async function getCandidates(source) {
  const html = await fetchHTML(source.url);

  if (!html) {
    return [];
  }

  const links = extractLinks(
    html,
    source.url
  );

  const candidates = links
    .filter(link =>
      looksLikeReview(source, link)
    );

  const unique = uniqueLinks(candidates);

  /*
   * Don't take random old pages.
   * The review archive pages put newest reviews first,
   * so we take the first 15 unique candidates.
   */
  return unique.slice(0, 15);
}

async function readReview(source, candidate) {
  const html = await fetchHTML(candidate.url);

  if (!html) {
    return null;
  }

  const text = stripHTML(html);

  /*
   * First try to get the actual movie name from
   * the review page itself.
   */
  let movie =
    extractMovieNameFromText(text);

  /*
   * If that fails, use page title / headline.
   */
  if (!movie) {
    movie =
      extractTitleFromPage(
        html,
        candidate.text
      );
  }

  movie = cleanMovieTitle(movie);

  if (
    !movie ||
    movie.length < 2 ||
    movie.length > 120
  ) {
    return null;
  }

  /*
   * Reject obvious navigation garbage.
   */
  const badTitles = [
    "skip to main content",
    "movie reviews",
    "reviews",
    "more",
    "ott reviews"
  ];

  if (
    badTitles.includes(
      movie.toLowerCase()
    )
  ) {
    return null;
  }

  const rating =
    extractRating(
      text,
      source.name
    );

  const image =
    extractImage(html);

  const description =
    extractDescription(html);

  return {
    source: source.name,
    movie,
    key: normalizeTitle(movie),
    rating,
    ratingText:
      rating === null
        ? "Not available"
        : `${rating}/5`,
    url: candidate.url,
    image,
    description
  };
}

function calculateAverage(reviews) {
  const ratings = reviews
    .map(item => item.rating)
    .filter(
      rating =>
        typeof rating === "number" &&
        Number.isFinite(rating)
    );

  if (!ratings.length) {
    return null;
  }

  const average =
    ratings.reduce(
      (sum, rating) =>
        sum + rating,
      0
    ) / ratings.length;

  return Math.round(
    average * 100
  ) / 100;
}

function groupReviews(reviews) {
  const groups = new Map();

  for (const review of reviews) {
    if (!review.key) {
      continue;
    }

    if (!groups.has(review.key)) {
      groups.set(review.key, {
        movie: review.movie,
        image: review.image || "",
        reviews: []
      });
    }

    const group =
      groups.get(review.key);

    /*
     * Prefer a proper movie title.
     */
    if (
      group.movie.length < review.movie.length &&
      !review.movie.toLowerCase().includes("review")
    ) {
      group.movie = review.movie;
    }

    if (
      !group.image &&
      review.image
    ) {
      group.image = review.image;
    }

    /*
     * Only one review per source per movie.
     */
    const existing =
      group.reviews.find(
        item =>
          item.source ===
          review.source
      );

    if (!existing) {
      group.reviews.push(review);
    }
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      average:
        calculateAverage(
          group.reviews
        )
    }))
    .sort((a, b) => {
      const ad =
        a.average === null
          ? -1
          : a.average;

      const bd =
        b.average === null
          ? -1
          : b.average;

      return bd - ad;
    });
}

function buildFeedReviews(groups) {
  const output = [];

  for (const group of groups) {
    const sourceRatings =
      group.reviews.map(
        review => ({
          source: review.source,
          rating: review.rating,
          ratingText:
            review.ratingText,
          url: review.url
        })
      );

    output.push({
      t: group.movie,
      l: "Telugu",

      rating:
        group.average === null
          ? "Not available"
          : `${group.average}/5`,

      img:
        group.image || "",

      source:
        "GreatAndhra • Gulte • M9.news • Telugu360 • 123telugu",

      u:
        group.reviews[0]?.url ||
        "",

      aggregator: {
        average:
          group.average,

        sources:
          sourceRatings
      }
    });
  }

  return output;
}

async function main() {
  console.log("");
  console.log("=================================");
  console.log("CINEINSTA REVIEW AGGREGATOR");
  console.log("=================================");
  console.log("");

  const allReviews = [];

  for (const source of SOURCES) {
    console.log(
      `\nChecking ${source.name}...`
    );

    const candidates =
      await getCandidates(source);

    console.log(
      `${source.name}: ${candidates.length} candidates`
    );

    /*
     * Read the newest candidates.
     */
    for (
      const candidate of candidates.slice(0, 10)
    ) {
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

  const groups =
    groupReviews(
      allReviews
    );

  console.log("");
  console.log(
    `Movies after grouping: ${groups.length}`
  );

  for (const group of groups) {
    console.log(
      `\n${group.movie} | Average: ${
        group.average === null
          ? "Not available"
          : group.average
      }`
    );

    for (const source of group.reviews) {
      console.log(
        `  ${source.source}: ${source.ratingText}`
      );
    }
  }

  const reviews =
    buildFeedReviews(
      groups
    );

  let existingFeed = {
    updatedAt:
      new Date().toISOString(),
    news: [],
    reviews: []
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
      "Could not read existing feed.json."
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
    `Saved ${reviews.length} aggregated reviews.`
  );

  console.log(
    "data/feed.json updated successfully."
  );
}

main().catch(error => {
  console.error(
    "Cineinsta review aggregator failed:"
  );

  console.error(error);

  process.exit(1);
});
