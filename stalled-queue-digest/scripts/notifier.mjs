#!/usr/bin/env node
/**
 * One message, leading with the oldest age. Mentions people only when the
 * queue is non-empty -- pinging the team to say it's clear teaches them the
 * card is noise.
 *
 * The single most important property of this script: if the POST itself
 * fails, THIS SCRIPT MUST EXIT NON-ZERO. A failed notification that still
 * returns success is the one failure mode that defeats this entire tool's
 * purpose -- the job goes green having delivered nothing, in the one job
 * whose purpose is breaking a silence. Never wrap the fetch in a try/catch
 * that swallows the error.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, artifactsDir } from './lib/config.mjs';

/** @param digest the rendered digest.json object
 * @param text the rendered digest.md content
 * @param mention the configured mention string (e.g. "@qe-team") */
export function buildPayload(digest, text, mention) {
  const shouldMention = !digest.isEmpty;
  return {
    text: shouldMention ? `${mention} ${text}` : text,
  };
}

async function main() {
  const config = loadConfig();
  const digestPath = `${artifactsDir()}/digest.json`;
  const mdPath = `${artifactsDir()}/digest.md`;
  if (!existsSync(digestPath) || !existsSync(mdPath)) {
    throw new Error('digest.json/digest.md not found -- renderer.mjs must succeed before notifying.');
  }
  const digest = JSON.parse(readFileSync(digestPath, 'utf8'));
  const text = readFileSync(mdPath, 'utf8');

  const webhookEnvVar = config.notify.webhook_secret;
  const url = process.env[webhookEnvVar];
  if (!url) throw new Error(`${webhookEnvVar} is not set -- refusing to run without a configured webhook.`);

  const payload = buildPayload(digest, text, config.notify.mention);

  // No try/catch here on purpose -- see the header comment. A thrown error
  // (network failure, non-2xx) propagates to main()'s own catch below,
  // which exits non-zero.
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Notification webhook returned ${res.status}`);
  }

  console.log(digest.isEmpty ? 'Notified: queue is clear (no mention).' : `Notified: oldest ${digest.oldestAgeDays}d (mentioned ${config.notify.mention}).`);
}

// Only run as a CLI entrypoint -- importing this module (e.g. to unit-test
// buildPayload) must not also execute main(), which would read config/files
// that don't exist in a test context and kill the test process via
// process.exit(1).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Notification failed: ${err.message}`);
    process.exit(1);
  });
}
