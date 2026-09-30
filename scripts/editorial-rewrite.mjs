CINEINSTA — EDITORIAL FILTER FIX
File: scripts/editorial-rewrite.mjs

IMPORTANT:
Do NOT replace index.html.
Do NOT change generate-feed-candidates.mjs.
Make the following 3 targeted edits in editorial-rewrite.mjs.

1) FIND:

  const news = feed.news;
  let updated = 0;
  let skipped = 0;
  let batchNumber = 0;

REPLACE WITH:

  const news = feed.news;
  const approvedNews = [];
  let updated = 0;
  let skipped = 0;
  let batchNumber = 0;


2) FIND THIS BLOCK:

      const item = news[preparedItem.absoluteIndex];
      item.title = validation.title;
      item.summary = validation.summary;
      item.body = validation.body;
      item.editorial = "Cineinsta";
      item.keyFacts = [];
      item.cineinstaContext = "";

      updated += 1;

      const words = validation.body.join(" ").split(/\s+/).filter(Boolean).length;
      console.log(`UPDATED ${preparedItem.absoluteIndex + 1}: ${validation.title} (${words} words, ${validation.body.length} paragraphs, ${validation.summary.length} summary chars)`);

REPLACE WITH:

      const item = {
        ...news[preparedItem.absoluteIndex],
        title: validation.title,
        summary: validation.summary,
        body: validation.body,
        editorial: "Cineinsta",
        keyFacts: [],
        cineinstaContext: ""
      };

      approvedNews.push(item);
      updated += 1;

      const words = validation.body.join(" ").split(/\s+/).filter(Boolean).length;
      console.log(`APPROVED ${preparedItem.absoluteIndex + 1}: ${validation.title} (${words} words, ${validation.body.length} paragraphs, ${validation.summary.length} summary chars)`);


3) FIND:

  if (updated === 0) {
    throw new Error("No complete articles were generated. Existing feed was not changed.");
  }

  feed.updatedAt = new Date().toISOString();
  await fs.writeFile(path, JSON.stringify(feed, null, 2) + "\n", "utf8");

REPLACE WITH:

  if (approvedNews.length < 20) {
    throw new Error(
      `Only ${approvedNews.length} complete editorial stories passed validation; at least 20 are required. Existing feed was not changed.`
    );
  }

  feed.news = approvedNews;
  feed.updatedAt = new Date().toISOString();
  await fs.writeFile(path, JSON.stringify(feed, null, 2) + "\n", "utf8");


OPTIONAL LOG CLEANUP:
Find:
  console.log(`Articles updated: ${updated}`);

Replace with:
  console.log(`Articles approved: ${approvedNews.length}`);

WHY THIS FIX:
Rejected Gemini stories will no longer leave their old 80-character summaries inside
the candidate feed. Only stories that pass the 4–7 paragraph / 150–500 word /
180–650 character summary validation are retained.

The script will fail safely if fewer than 20 approved stories are produced.
The existing live feed remains protected because generate-feed-candidates.mjs
restores data/feed.json after the candidate-generation step.

AFTER COMMIT:
1. Commit only scripts/editorial-rewrite.mjs.
2. Run Actions → Update Cineinsta Feed manually.
3. Do not run repeatedly if it fails; send the failed log first.
