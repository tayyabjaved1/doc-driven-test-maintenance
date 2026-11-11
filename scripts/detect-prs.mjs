#!/usr/bin/env node
/**
 * Phase 1 -- Detect: which merged PRs touched documented behaviour.
 *
 * Three passes, each excluding anything already labelled `done` (see
 * config.yml's detection.labels): fresh (last N hours), catch-up (last M
 * hours, for anything an earlier run missed), and "any age, if still queued"
 * -- that third pass is what makes a crashed cycle recoverable: a cycle that
 * dies partway leaves its PRs labelled `queued`, and they come back however
 * old they get. No qualifying PRs across all three passes = exit cleanly, no
 * issue, no notification, no store access. An idle night must not look like
 * a failure. See docs/ARCHITECTURE.md's "1. Detect" section.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadConfig, artifactsDir } from './lib/config.mjs';
import { ghRest } from './lib/gh.mjs';
import { matchesAny } from './lib/glob.mjs';

function repoToken() {
  const token = process.env.REPO_OPS_TOKEN;
  if (!token) throw new Error('REPO_OPS_TOKEN is not set -- see .env.example / docs/CREDENTIALS.md');
  return token;
}

async function searchMergedPRs(repo, token, sinceIso, excludeLabel) {
  const q = encodeURIComponent(
    `repo:${repo} is:pr is:merged merged:>=${sinceIso} -label:"${excludeLabel}"`
  );
  const res = await ghRest(token, [`search/issues?q=${q}&per_page=100`]);
  return res?.items ?? [];
}

async function searchLabelledQueued(repo, token, queuedLabel) {
  const q = encodeURIComponent(`repo:${repo} is:pr is:merged label:"${queuedLabel}"`);
  const res = await ghRest(token, [`search/issues?q=${q}&per_page=100`]);
  return res?.items ?? [];
}

async function prTouchesDocs(repo, token, prNumber, docsPaths) {
  const files = await ghRest(token, [`repos/${repo}/pulls/${prNumber}/files?per_page=100`]);
  return (files ?? []).some((f) => matchesAny(f.filename, docsPaths));
}

async function main() {
  const config = loadConfig();
  const { repo, docs_paths: docsPaths, labels, passes } = config.detection;
  const token = repoToken();

  const now = Date.now();
  const freshSince = new Date(now - passes.fresh_hours * 3600_000).toISOString();
  const catchUpSince = new Date(now - passes.catch_up_hours * 3600_000).toISOString();

  const candidatesByNumber = new Map();
  const addCandidates = (items) => {
    for (const item of items) candidatesByNumber.set(item.number, item);
  };

  // Pass 1: fresh. Pass 2: catch-up window. Pass 3: any age, still labelled queued.
  addCandidates(await searchMergedPRs(repo, token, freshSince, labels.done));
  addCandidates(await searchMergedPRs(repo, token, catchUpSince, labels.done));
  addCandidates(await searchLabelledQueued(repo, token, labels.queued));

  const inScope = [];
  for (const pr of candidatesByNumber.values()) {
    if (await prTouchesDocs(repo, token, pr.number, docsPaths)) {
      inScope.push({ number: pr.number, title: pr.title, url: pr.html_url });
    }
  }

  mkdirSync(artifactsDir(), { recursive: true });
  const outPath = `${artifactsDir()}/queued-prs.json`;
  writeFileSync(outPath, JSON.stringify(inScope, null, 2));

  const hasWork = inScope.length > 0;
  console.log(`Detected ${inScope.length} in-scope PR(s). Wrote ${outPath}.`);
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `has_work=${hasWork}\n`, { flag: 'a' });
  }
  if (!hasWork) {
    console.log('No qualifying PRs -- exiting cleanly. No issue, no notification, no store access.');
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
