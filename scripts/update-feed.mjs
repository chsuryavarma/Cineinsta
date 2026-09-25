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
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    console.log(`Failed: ${url}`, error.message);
    return "";
  }
}

function stripHTML(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&#39;/gi, "'")
    .replace(/&#8211;/gi, "-")
    .replace(/&#8220;|&#8221;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function decode(text) {
  return stripHTML(text)
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#039;/gi, "'")
    .trim();
}

function absoluteUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return "";
  }
}

function cleanMovieTitle(title) {
  let t = decode(title);

  t = t
    .replace(/^review\s*:\s*/i, "")
    .replace(/^movie\s*review\s*:\s*/i, "")
    .replace(/^movie\s*review\s*/i, "")
    .replace(/^review\s*/i, "")
    .replace(/^telugu\s*movie\s*review\s*:\s*/i, "")
    .replace(/^the\s+/i, "The ")
    .replace(/\s*[|–—-]\s*.*$/i, "")
    .trim();

  return t;
}

function normalizeTitle(title) {
  return cleanMovieTitle(title)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(movie|review|rating|telugu|first report)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(html, baseUrl) {
  const links = [];
  const regex =
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = regex.exec(html))) {
    const href = absoluteUrl(match[1], baseUrl);
    const text = decode(match[2]);

    if (!href || !text) continue;

    links.push({
      url: href,
      text
    });
  }

  return links;
}

function looksLikeReview(title, url) {
  const value = `${title} ${url}`.toLowerCase();

  return (
    value.includes("review") ||
    value.includes("movie-review") ||
    value.includes("movie_review")
  );
}

function extractRating(text, source) {
  const clean = text.replace(/\s+/g, " ");

  const patterns = {
    GreatAndhra: [
      /rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /(\d+(?:\.\d+)?)\s*\/\s*5/i
    ],

    Gulte: [
      /(\d+(?:\.\d+)?)\s*\/\s*5/i
    ],

    "M9.news": [
      /our\s*rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i
    ],

    Telugu360: [
      /telugu360\s*rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i
    ],

    "123telugu": [
      /123telugu(?:\.com)?\s*rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i,
      /rating\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\/\s*5/i
    ]
  };

  const sourcePatterns = patterns[source] || [];

  for (const pattern of sourcePatterns) {
    const match = clean.match(pattern);

    if (match) {
      const rating = Number(match[1]);

      if (rating >= 0 && rating <= 5) {
        return rating;
      }
    }
  }

  return null;
}

function extractImage(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match && match[1]) {
      return match[1];
    }
  }

  return "";
}

function extractDescription(html) {
  const patterns = [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);

    if (match && match[1]) {
      return decode(match[1]).slice(0, 240);
    }
  }

  return "";
}

async function getReviewCandidates(source) {
  const html = await fetchHTML(source.url);

  if (!html) return [];

  const links = extractLinks(html, source.url);

  const candidates = [];

  for (const link of links) {
    if (!looksLikeReview(link.text, link.url)) continue;

    if (!link.url.includes(source.domain)) continue;

    const title = cleanMovieTitle(link.text);

    if (!title || title.length < 3) continue;

    candidates.push({
      source: source.name,
      title,
      url: link.url
    });
  }

  const unique = new Map();

  for (const item of candidates) {
    const key = `${item.source}|${item.url}`;

    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }

  return [...unique.values()].slice(0, 12);
}

async function readReview(source, candidate) {
  const html = await fetchHTML(candidate.url);

  if (!html) return null;

  const text = stripHTML(html);

  const rating = extractRating(text, source.name);

  const image = extractImage(html);

  const description = extractDescription(html);

  return {
    source: source.name,
    movie: candidate.title,
    key: normalizeTitle(candidate.title),
    rating,
    ratingText: rating === null ? "Not available" : `${rating}/5`,
    url: candidate.url,
    image,
    description
  };
}

function averageRatings(items) {
  const values = items
    .map(x => x.rating)
    .filter(x => typeof x === "number");

  if (!values.length) {
    return null;
  }

  const average =
    values.reduce((sum, value) => sum + value, 0) /
    values.length;

  return Math.round(average * 100) / 100;
}

function groupReviews(reviews) {
  const groups = new Map();

  for (const review of reviews) {
    if (!review.key) continue;

    if (!groups.has(review.key)) {
      groups.set(review.key, {
        movie: review.movie,
        image: review.image || "",
        reviews: []
      });
    }

    const group = groups.get(review.key);

    if (!group.image && review.image) {
      group.image = review.image;
    }

    const alreadyExists = group.reviews.some(
      x => x.source === review.source
    );

    if (!alreadyExists) {
      group.reviews.push(review);
    }
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      average: averageRatings(group.reviews)
    }))
    .sort((a, b) => {
      const ar = a.average ?? -1;
      const br = b.average ?? -1;

      return br - ar;
    });
}

async function buildReviewFeed() {
  console.log("=================================");
  console.log("CINEINSTA REVIEW AGGREGATOR");
  console.log("=================================");

  const allReviews = [];

  for (const source of SOURCES) {
    console.log(`\nChecking ${source.name}...`);

    const candidates =
      await getReviewCandidates(source);

    console.log(
      `${source.name}: ${candidates.length} review candidates`
    );

    /*
     * Read only a small number of the newest
     * candidates to keep GitHub Actions fast.
     */

    for (const candidate of candidates.slice(0, 8)) {
      const review =
        await readReview(source, candidate);

      if (!review) continue;

      console.log(
        `${source.name} | ${review.movie} | ${review.ratingText}`
      );

      allReviews.push(review);
    }
  }

  const grouped =
    groupReviews(allReviews);

  console.log(
    `\nMovies with aggregated reviews: ${grouped.length}`
  );

  return grouped;
}

function buildFeedReviews(groups) {
  const output = [];

  for (const group of groups) {
    const sourceRatings =
      group.reviews.map(review => ({
        source: review.source,
        rating: review.rating,
        ratingText: review.ratingText,
        url: review.url
      }));

    /*
     * The existing Cineinsta UI expects a simple review
     * object. We keep that format while adding the
     * complete source-by-source aggregation.
     */

    output.push({
      t: group.movie,
      l: "Telugu",
      rating:
        group.average === null
          ? "Not available"
          : `${group.average}/5`,
      img: group.image || "",
      source: "GreatAndhra • Gulte • M9.news • Telugu360 • 123telugu",
      u:
        group.reviews[0]?.url ||
        "",
      aggregator: {
        average:
          group.average,
        sources: sourceRatings
      }
    });
  }

  return output;
}

async function main() {
  const groups =
    await buildReviewFeed();

  const reviews =
    buildFeedReviews(groups);

  let existingFeed = {
    updatedAt: new Date().toISOString(),
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
      "Existing feed.json not found. Creating a new one."
    );
  }

  const feed = {
    updatedAt: new Date().toISOString(),
    news:
      Array.isArray(existingFeed.news)
        ? existingFeed.news
        : [],
    reviews
  };

  await fs.mkdir(
    "data",
    { recursive: true }
  );

  await fs.writeFile(
    "data/feed.json",
    JSON.stringify(feed, null, 2),
    "utf8"
  );

  console.log(
    `\nSaved ${reviews.length} aggregated movie reviews.`
  );

  console.log(
    "Feed written to data/feed.json"
  );
}

main().catch(error => {
  console.error(
    "Cineinsta review aggregator failed:",
    error
  );

  process.exit(1);
});
