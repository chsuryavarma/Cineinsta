import fs from "node:fs/promises";

const FILES = [
  "data/feed.json",
  "data/feed-candidates.json",
  "data/buzz.json",
  "data/ticket-trends.json"
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36";

const cache = new Map();

async function imageIsValid(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  if (cache.has(url)) return cache.get(url);

  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        },
        signal: controller.signal
      });

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      return response.ok && contentType.startsWith("image/");
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  })();

  cache.set(url, promise);
  return promise;
}

async function validateArray(items, label) {
  if (!Array.isArray(items)) return [];

  const valid = [];

  for (const item of items) {
    if (!item || !item.img) continue;

    if (await imageIsValid(item.img)) {
      valid.push(item);
    } else {
      console.log(`Removed unusable image from ${label}: ${item.title || item.movie || "untitled"}`);
    }
  }

  return valid;
}

async function main() {
  for (const file of FILES) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const data = JSON.parse(raw);
      let changed = false;

      if (Array.isArray(data.news)) {
        const before = data.news.length;
        data.news = await validateArray(data.news, `${file} news`);
        changed ||= before !== data.news.length;
      }

      if (Array.isArray(data.reviews)) {
        const before = data.reviews.length;
        data.reviews = await validateArray(data.reviews, `${file} reviews`);
        changed ||= before !== data.reviews.length;
      }

      if (Array.isArray(data.trailers)) {
        const before = data.trailers.length;
        data.trailers = await validateArray(data.trailers, `${file} trailers`);
        changed ||= before !== data.trailers.length;
      }

      if (Array.isArray(data.buzz)) {
        const before = data.buzz.length;
        data.buzz = await validateArray(data.buzz, `${file} buzz`);
        changed ||= before !== data.buzz.length;
      }

      if (Array.isArray(data.movies)) {
        const before = data.movies.length;
        data.movies = await validateArray(data.movies, `${file} movies`);
        changed ||= before !== data.movies.length;
      }

      if (changed) {
        await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        console.log(`Skipping missing optional file: ${file}`);
      } else {
        throw error;
      }
    }
  }

  console.log("Cineinsta image validation completed.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
