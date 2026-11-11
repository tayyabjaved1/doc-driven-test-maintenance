#!/usr/bin/env node
/**
 * Pages the store, keeps items in the pending states, records when each
 * entered that state. Writes .artifacts/stalled-queue.json ONLY on full
 * success -- any error (including a partial GraphQL response; see
 * lib/gh.mjs) writes nothing and exits non-zero. "Nothing is waiting" and
 * "I could not look" must never be the same output file.
 */
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, artifactsDir } from './lib/config.mjs';
import { loadAdapter } from './lib/store.mjs';
import { ageDays } from './lib/digest.mjs';

async function main() {
  const config = loadConfig();
  const adapter = await loadAdapter(config);

  const outPath = `${artifactsDir()}/stalled-queue.json`;
  // A stale file from a previous failed run must never be mistaken for this
  // run's output -- remove it before attempting collection, not after.
  if (existsSync(outPath)) unlinkSync(outPath);

  const rawItems = await adapter.listPendingItems(config);
  const now = new Date();
  const items = rawItems.map((item) => ({ ...item, ageDays: ageDays(item.enteredStateAt, now) }));

  mkdirSync(artifactsDir(), { recursive: true });
  writeFileSync(outPath, JSON.stringify({ collectedAt: now.toISOString(), items }, null, 2));
  console.log(`Collected ${items.length} pending item(s). Wrote ${outPath}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Collection failed -- writing nothing: ${err.message}`);
    process.exit(1);
  });
}
