import fs from "node:fs/promises";

const ALL_FILES = [
  "data/feed.json",
  "data/feed-candidates.json",
  "data/buzz.json",
  "data/ticket-trends.json"
];

const FEED_FILES = [
  "data/feed.json",
  "data/feed-candidates.json"
];

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36 Cineinsta/1.0";

const cache = new Map();

function isCineinstaSvg(url) {
  return (
    typeof url === "string" &&
    /^data:image\/svg\+xml;base64,/i.test(url)
  );
}

async function imageIsValid(url) {
  if (!url || typeof url !== "string") return false;

  if (isCineinstaSvg(url)) return true;

  if (!/^https?:\/\//i.test(url)) return false;
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
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        },
        signal: controller.signal
      });

      const contentType = (
        response.headers.get("content-type") || ""
      ).toLowerCase();

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

function imageFields(item) {
  if (!item || typeof item !== "object") return [];

  return ["img", "image", "thumbnail"]
    .filter(key => typeof item[key] === "string" && item[key].trim())
    .map(key => ({ key, url: item[key].trim() }));
}

async function validateArrayImages(label, items, errors) {
  if (!Array.isArray(items)) return;

  for (let index = 0; index < items.length; index += 1) {
    for (const field of imageFields(items[index])) {
      if (!(await imageIsValid(field.url))) {
        errors.push(
          `${label}[${index + 1}].${field.key}: image is not reachable/usable`
        );
      }
    }
  }
}

async function validateFile(file, errors) {
  let data;

  try {
    data = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    errors.push(`${file}: invalid JSON (${error.message})`);
    return;
  }

  if (!data || typeof data !== "object") {
    errors.push(`${file}: root value is not an object`);
    return;
  }

  await validateArrayImages(`${file}:news`, data.news, errors);
  await validateArrayImages(`${file}:trailers`, data.trailers, errors);
  await validateArrayImages(`${file}:interviews`, data.interviews, errors);
  await validateArrayImages(`${file}:reviews`, data.reviews, errors);
  await validateArrayImages(`${file}:movies`, data.movies, errors);

  if (data.ottTrending && typeof data.ottTrending === "object") {
    for (const [platform, payload] of Object.entries(data.ottTrending)) {
      await validateArrayImages(
        `${file}:ottTrending.${platform}.items`,
        payload?.items,
        errors
      );
    }
  }
}

async function main() {
  const mode = process.argv.includes("--all") ? "all" : "feed";
  const files = mode === "all" ? ALL_FILES : FEED_FILES;
  const errors = [];

  for (const file of files) {
    await validateFile(file, errors);
  }

  if (errors.length) {
    console.error("");
    console.error(`Cineinsta ${mode} image validation failed.`);
    console.error("");

    for (const error of errors.slice(0, 50)) {
      console.error(`- ${error}`);
    }

    if (errors.length > 50) {
      console.error(`...and ${errors.length - 50} more errors.`);
    }

    process.exit(1);
  }

  console.log(`Cineinsta ${mode} image validation completed successfully.`);
  console.log(
    "Accepted image types: HTTPS image URLs and Cineinsta-generated SVG data images."
  );
}

main().catch(error => {
  console.error("");
  console.error("Cineinsta image validation failed unexpectedly:");
  console.error(error);
  process.exit(1);
});
