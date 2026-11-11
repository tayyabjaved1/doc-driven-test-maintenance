#!/usr/bin/env node
/**
 * Phase 2b -- fetch the whole catalogue to a file, one record per line, so
 * the agent can grep it. The agent must never paginate the store itself --
 * that burns its context on retrieval instead of analysis (see
 * docs/ARCHITECTURE.md's "2. Prepare").
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadConfig, artifactsDir } from './lib/config.mjs';
import { loadAdapter } from './lib/store.mjs';

async function main() {
  const config = loadConfig();
  const adapter = await loadAdapter(config);
  const items = await adapter.listAll(config);

  mkdirSync(artifactsDir(), { recursive: true });
  const outPath = `${artifactsDir()}/catalogue.jsonl`;
  const lines = items.map((item) => JSON.stringify(item)).join('\n') + '\n';
  writeFileSync(outPath, lines);
  console.log(`Wrote ${items.length} catalogue record(s) to ${outPath}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
