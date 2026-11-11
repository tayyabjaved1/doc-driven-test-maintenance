#!/usr/bin/env node
/**
 * The broker -- the ONLY interface the agent is given to the test-case
 * store. Be honest about what this is: a narrowing, not a sandbox. A broker
 * that permits store writes still reaches anything the store token can see.
 * It exists to shrink the blast radius of the agent misreading untrusted PR
 * content, not to make misuse impossible.
 *
 * Exactly three verbs exist. There is no raw-query passthrough, deliberately
 * stricter than giving the agent a GraphQL string -- see
 * scripts/store/adapter.interface.md's note on this tradeoff. Anything else
 * is refused before the adapter is even loaded.
 *
 * The agent's tool allowlist (agent/PROCESS.md, and the `allowed_tools` on
 * the workflow's agent step) must name this script and nothing else for
 * store access -- never `gh` directly, never the adapter module directly.
 *
 * Usage: node scripts/lib/broker.mjs <create|update|get> '<json payload>'
 */
import { loadConfig } from './config.mjs';
import { loadAdapter } from './store.mjs';

const ALLOWED_VERBS = new Set(['create', 'update', 'get']);

async function main() {
  const [verb, payloadJson] = process.argv.slice(2);
  if (!ALLOWED_VERBS.has(verb)) {
    console.error(`Refused: "${verb}" is not a permitted broker verb. Allowed: ${[...ALLOWED_VERBS].join(', ')}`);
    process.exit(1);
  }
  let payload;
  try {
    payload = JSON.parse(payloadJson ?? '{}');
  } catch {
    console.error('Refused: payload must be valid JSON.');
    process.exit(1);
  }

  const config = loadConfig();
  const adapter = await loadAdapter(config);

  try {
    let result;
    if (verb === 'create') {
      const { title, body, fields } = payload;
      if (!title) throw new Error('create requires "title"');
      result = await adapter.createItem(config, { title, body, fields });
    } else if (verb === 'update') {
      const { itemId, fields } = payload;
      if (!itemId || !fields) throw new Error('update requires "itemId" and "fields"');
      await adapter.updateItemFields(config, { itemId, fields });
      result = { ok: true };
    } else if (verb === 'get') {
      const { itemId } = payload;
      if (!itemId) throw new Error('get requires "itemId"');
      result = await adapter.getItem(config, { itemId });
    }
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(JSON.stringify({ error: err.message, notFound: err.notFound ?? false }));
    process.exit(1);
  }
}

main();
