import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/** Test-only adapter: a JSON-file-backed store (not pure in-memory, so it
 * survives across the separate process spawns a real end-to-end pipeline
 * run involves), used by this repo's own end-to-end smoke test
 * (scripts/__tests__/pipeline.e2e.test.mjs). Never reference this from
 * config.example.yml -- it exists so the pipeline's own correctness can be
 * proven without live credentials, not as something a real project runs. */

function storePath() {
  return process.env.FAKE_STORE_PATH || '.artifacts/fake-store.json';
}

function load() {
  const path = storePath();
  if (!existsSync(path)) return { items: {}, counter: 0 };
  return JSON.parse(readFileSync(path, 'utf8'));
}

function save(state) {
  writeFileSync(storePath(), JSON.stringify(state, null, 2));
}

export async function preflight() {}

export async function listAll() {
  return Object.values(load().items);
}

export async function getItem(config, { itemId }) {
  return load().items[itemId] ?? null;
}

export async function createItem(config, { title, body, fields }) {
  const state = load();
  state.counter += 1;
  const id = `fake-${state.counter}`;
  state.items[id] = { id, title, fields: fields ?? {} };
  save(state);
  return { id };
}

export async function updateItemFields(config, { itemId, fields }) {
  const state = load();
  const existing = state.items[itemId];
  if (!existing) {
    const err = new Error(`fake item ${itemId} not found`);
    err.notFound = true;
    throw err;
  }
  existing.fields = { ...existing.fields, ...fields };
  save(state);
}
