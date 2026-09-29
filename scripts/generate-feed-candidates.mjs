import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LIVE = "data/feed.json";
const SOURCE = "data/feed-source.json";
const CANDIDATES = "data/feed-candidates.json";
const BACKUP = "data/.feed-live-backup.json";

const MIN_STORIES = 20;
const MAX_STORIES = 30;
const MIN_SUMMARY = 180;
const MAX_SUMMARY = 650;

async function copyJson(from, to) {
  const value = JSON.parse(await fs.readFile(from, "utf8"));
  await fs.writeFile(to, JSON.stringify(value, null, 2) + "\n", "utf8");
  return value;
}

async function runScript(script) {
  console.log("");
  console.log(`Running ${script}...`);
  await execFileAsync("node", [script], {
    env: process.env,
    maxBuffer: 20 * 1024 * 1024
  });
}

function validateCandidates(news) {
  const now = Date.now();
  const seenIds = new Set();
  const seenUrls = new Set();
  const seenImages = new Set();
  const seenTitles = new Set();
  const errors = [];

  for (let index = 0; index < news.length; index += 1) {
    const story = news[index];
    const label = `Story ${index + 1}`;

    if (!story || typeof story !== "object") {
      errors.push(`${label}: invalid story object`);
      continue;
    }

    if (!story.title || typeof story.title !== "string") {
      errors.push(`${label}: missing title`);
    }

    if (!story.summary || typeof story.summary !== "string") {
      errors.push(`${label}: missing summary`);
    } else if (
      story.summary.length < MIN_SUMMARY ||
      story.summary.length > MAX_SUMMARY
    ) {
      errors.push(
        `${label}: summary length ${story.summary.length}; expected ${MIN_SUMMARY}-${MAX_SUMMARY}`
      );
    }

    if (!story.url || typeof story.url !== "string") {
      errors.push(`${label}: missing source URL`);
    }

    if (!story.img || typeof story.img !== "string") {
      errors.push(`${label}: missing image`);
    }

    if (!story.id || typeof story.id !== "string") {
      errors.push(`${label}: missing id`);
    }

    if (story.publishedAt) {
      const publishedTime = Date.parse(story.publishedAt);

      if (Number.isNaN(publishedTime)) {
        errors.push(`${label}: invalid publishedAt`);
      } else if (publishedTime > now + 5 * 60 * 1000) {
        errors.push(`${label}: future publishedAt`);
      }
    }

    const normalizedTitle = String(story.title || "")
      .trim()
      .toLowerCase();

    if (story.id && seenIds.has(story.id)) errors.push(`${label}: duplicate id`);
    if (story.url && seenUrls.has(story.url)) errors.push(`${label}: duplicate URL`);
    if (story.img && seenImages.has(story.img)) errors.push(`${label}: duplicate image`);
    if (normalizedTitle && seenTitles.has(normalizedTitle)) {
      errors.push(`${label}: duplicate title`);
    }

    if (story.id) seenIds.add(story.id);
    if (story.url) seenUrls.add(story.url);
    if (story.img) seenImages.add(story.img);
    if (normalizedTitle) seenTitles.add(normalizedTitle);
  }

  if (errors.length) {
    throw new Error(
      ["Candidate validation failed.", ...errors.slice(0, 25),
       errors.length > 25 ? `...and ${errors.length - 25} more errors.` : ""]
        .filter(Boolean).join("\n")
    );
  }
}

async function main() {
  let backupCreated = false;

  try {
    await fs.mkdir("data", { recursive: true });

    await copyJson(LIVE, BACKUP);
    backupCreated = true;

    await runScript("scripts/update-feed.mjs");
    await copyJson(LIVE, SOURCE);
    await runScript("scripts/editorial-rewrite.mjs");

    const candidate = await copyJson(LIVE, CANDIDATES);

    if (!Array.isArray(candidate.news)) {
      throw new Error("Editorial output contains no news array.");
    }

    if (candidate.news.length < MIN_STORIES) {
      throw new Error(
        `Only ${candidate.news.length} editorial candidates found. At least ${MIN_STORIES} are required. Live feed was not changed.`
      );
    }

    validateCandidates(candidate.news);

    const approvedNews = candidate.news
      .slice(0, MAX_STORIES)
      .map(story => ({ ...story, reviewStatus: "approved" }));

    const publishedCandidate = {
      ...candidate,
      generatedAt: new Date().toISOString(),
      reviewStatus: "auto-approved",
      news: approvedNews
    };

    await fs.writeFile(
      CANDIDATES,
      JSON.stringify(publishedCandidate, null, 2) + "\n",
      "utf8"
    );

    console.log("");
    console.log("======================================");
    console.log("CINEINSTA AUTO-PUBLISH QUEUE READY");
    console.log("======================================");
    console.log(`Collected source stories: ${candidate.news.length}`);
    console.log(`Approved for automatic publishing: ${approvedNews.length}`);
    console.log("Safety validation: PASSED");
    console.log("Live feed will be published by the workflow.");
  } finally {
    if (backupCreated) {
      await fs.copyFile(BACKUP, LIVE);
      await fs.unlink(BACKUP).catch(() => {});
      console.log("Restored live data/feed.json.");
    }
  }
}

main().catch(error => {
  console.error("");
  console.error("Cineinsta automatic feed generation failed:");
  console.error(error);
  process.exit(1);
});
