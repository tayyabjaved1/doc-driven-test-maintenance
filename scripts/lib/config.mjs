import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Loads and minimally validates config.yml (or CONFIG_PATH, for tests). Throws with
 * a specific missing-key message rather than a generic parse error, since a new
 * porter's first run is almost always a missing or misspelled config key. */
export function loadConfig() {
  const path = process.env.CONFIG_PATH || join(repoRoot, 'config.yml');
  if (!existsSync(path)) {
    throw new Error(
      `${path} not found. Copy config.example.yml to config.yml and fill in every value -- see PORTING.md Stage 1.`
    );
  }
  const config = yaml.load(readFileSync(path, 'utf8'));

  const required = [
    'detection.repo',
    'detection.docs_paths',
    'detection.labels.queued',
    'detection.labels.done',
    'store.adapter',
    'credentials.repo_ops_token_secret',
  ];
  for (const keyPath of required) {
    if (getPath(config, keyPath) === undefined) {
      throw new Error(`config.yml is missing required key: ${keyPath}`);
    }
  }
  return config;
}

function getPath(obj, keyPath) {
  return keyPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function artifactsDir() {
  return join(repoRoot, '.artifacts');
}

export { repoRoot };
