#!/usr/bin/env node
/**
 * Phase 2c -- label the in-scope PRs `queued` and open a tracking issue.
 * This, not the agent, is what makes a PR's work "claimed" -- the agent is
 * never allowed to label PRs itself (see docs/ARCHITECTURE.md's "three
 * things the agent must never do").
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadConfig, artifactsDir } from './lib/config.mjs';
import { ghRest } from './lib/gh.mjs';

function repoToken() {
  const token = process.env.REPO_OPS_TOKEN;
  if (!token) throw new Error('REPO_OPS_TOKEN is not set');
  return token;
}

async function main() {
  const config = loadConfig();
  const { repo, labels } = config.detection;
  const token = repoToken();

  const prs = JSON.parse(readFileSync(`${artifactsDir()}/queued-prs.json`, 'utf8'));
  if (prs.length === 0) {
    console.log('No in-scope PRs -- nothing to label or track.');
    return;
  }

  for (const pr of prs) {
    await ghRest(token, [
      `repos/${repo}/issues/${pr.number}/labels`,
      '-X', 'POST',
      '-f', `labels[]=${labels.queued}`,
    ]);
  }

  const body = [
    `Tracking test-case maintenance for ${prs.length} PR(s):`,
    '',
    ...prs.map((pr) => `- #${pr.number} ${pr.title}`),
    '',
    '_This issue is closed automatically once the audit publishes successfully. It stays open if validation fails -- see docs/ARCHITECTURE.md\'s guards._',
  ].join('\n');

  const issue = await ghRest(token, [
    `repos/${repo}/issues`,
    '-X', 'POST',
    '-f', 'title=Test-case maintenance cycle',
    '-f', `body=${body}`,
  ]);

  mkdirSync(artifactsDir(), { recursive: true });
  writeFileSync(`${artifactsDir()}/tracking-issue.json`, JSON.stringify({ number: issue.number, url: issue.html_url }, null, 2));
  console.log(`Labelled ${prs.length} PR(s) and opened tracking issue #${issue.number}.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
