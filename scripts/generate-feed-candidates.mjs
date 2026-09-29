import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LIVE = "data/feed.json";
const SOURCE = "data/feed-source.json";
const CANDIDATES = "data/feed-candidates.json";
const BACKUP = "data/.feed-live-backup.json";

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

async function main() {
  let backupCreated = false;

  try {
    await fs.mkdir("data", { recursive: true });

    // Protect the currently published feed before the existing collector runs.
    await copyJson(LIVE, BACKUP);
    backupCreated = true;

    // Existing collector writes to data/feed.json.
    await runScript("scripts/update-feed.mjs");

    // Preserve the freshly collected, pre-editorial source feed.
    await copyJson(LIVE, SOURCE);

    // Existing editorial script reads/writes data/feed.json.
    await runScript("scripts/editorial-rewrite.mjs");

    // Convert its result into a review queue. Nothing is published yet.
    const candidate = await copyJson(LIVE, CANDIDATES);

    if (!Array.isArray(candidate.news) || candidate.news.length === 0) {
      throw new Error("No candidate news stories were produced.");
    }

    candidate.reviewStatus = "pending";
    candidate.generatedAt = new Date().toISOString();

    candidate.news = candidate.news.map(story => ({
      ...story,
      reviewStatus: "pending"
    }));

    await fs.writeFile(
      CANDIDATES,
      JSON.stringify(candidate, null, 2) + "\n",
      "utf8"
    );

    console.log("");
    console.log("======================================");
    console.log("CINEINSTA REVIEW QUEUE READY");
    console.log("======================================");
    console.log(`Candidate news stories: ${candidate.news.length}`);
    console.log("Live feed has NOT been changed.");
  } finally {
    // Always restore the previously published feed, even if a later step fails.
    if (backupCreated) {
      await fs.copyFile(BACKUP, LIVE);
      await fs.unlink(BACKUP).catch(() => {});
      console.log("Restored live data/feed.json.");
    }
  }
}

main().catch(error => {
  console.error("");
  console.error("Cineinsta candidate generation failed:");
  console.error(error);
  process.exit(1);
});
