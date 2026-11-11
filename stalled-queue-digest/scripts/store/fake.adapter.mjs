import { readFileSync, existsSync } from 'node:fs';

/** Test-only adapter: reads a fixed JSON array from FAKE_ITEMS_PATH. Never
 * reference this from config.example.yml. */
export async function listPendingItems() {
  const path = process.env.FAKE_ITEMS_PATH;
  if (!path || !existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf8'));
}
