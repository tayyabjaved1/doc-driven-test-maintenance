#!/usr/bin/env node
/**
 * Phase 2a -- verify store access before writing anything. Probes the store
 * with exactly the call the agent will make (the adapter's own preflight()),
 * not a cheaper proxy -- a preflight that tests a different call than the
 * agent makes will pass while the agent fails. Aborts here, before any
 * mutation, so a run that cannot reach the store touches nothing on its way out.
 */
import { loadConfig } from './lib/config.mjs';
import { loadAdapter } from './lib/store.mjs';

async function main() {
  const config = loadConfig();
  const adapter = await loadAdapter(config);
  await adapter.preflight(config);
  console.log('Store access verified.');
}

main().catch((err) => {
  console.error(`Preflight failed -- aborting before any write: ${err.message}`);
  process.exit(1);
});
