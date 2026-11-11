#!/usr/bin/env node
/**
 * Phase 4 -- Validate, before anything is published. Runs independently of
 * the agent, in its own job, after the agent step has finished. This is
 * where most of the engineering goes (see docs/ARCHITECTURE.md).
 *
 * Two layers, deliberately not collapsed into one:
 * 1. The self-check fingerprint must exist and match this exact summary
 *    file -- enforces that the agent actually ran its own self-check against
 *    THIS content, not skipped it or changed the file afterward.
 * 2. The same validators run again, independently, here. self-check.json's
 *    "passed" flag is never trusted alone -- the validators are the actual
 *    backstop; self-check only catches skipping.
 *
 * If this script exits non-zero, publish.mjs must not run: the issue stays
 * open, the PRs stay queued, and the next run retries them. A failure must
 * never be able to close a cycle.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadConfig, artifactsDir } from './lib/config.mjs';
import { runAllValidators } from './lib/validators.mjs';

function fingerprint(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function main() {
  const summaryPath = `${artifactsDir()}/summary.json`;
  const selfCheckPath = `${artifactsDir()}/self-check.json`;

  if (!existsSync(summaryPath)) {
    fail('No summary.json produced by the agent step.');
    return;
  }
  const raw = readFileSync(summaryPath, 'utf8');
  const summary = JSON.parse(raw);

  if (!existsSync(selfCheckPath)) {
    fail('No self-check.json found -- the agent did not run (or skipped) its mandatory self-check. Refusing to publish.');
    return;
  }
  const selfCheck = JSON.parse(readFileSync(selfCheckPath, 'utf8'));
  const actualFingerprint = fingerprint(raw);
  if (selfCheck.fingerprint !== actualFingerprint) {
    fail('self-check.json\'s fingerprint does not match the final summary.json -- the summary changed after self-check ran, or self-check ran against a different file. Refusing to publish.');
    return;
  }
  if (!selfCheck.passed) {
    fail('self-check.json records passed:false -- the agent\'s own self-check failed and it finished anyway. Refusing to publish.');
    return;
  }

  const prsPath = `${artifactsDir()}/queued-prs.json`;
  const inScopePRs = existsSync(prsPath) ? JSON.parse(readFileSync(prsPath, 'utf8')) : [];
  const config = loadConfig();
  const { ok, results, normalized } = await runAllValidators(config, summary, { inScopePRs });

  for (const [name, result] of Object.entries(results)) {
    const mark = result.ok ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${name}`);
    for (const err of result.errors ?? []) console.log(`       ${err}`);
  }

  if (!ok) {
    fail('Independent validation failed (see above). Refusing to publish.');
    return;
  }

  writeFileSync(`${artifactsDir()}/validated-summary.json`, JSON.stringify(normalized, null, 2));
  console.log('\nValidation passed.');
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, 'passed=true\n', { flag: 'a' });
  }
}

function fail(message) {
  console.error(message);
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, 'passed=false\n', { flag: 'a' });
  }
  process.exitCode = 1;
}

main().catch((err) => {
  fail(err.message);
});
