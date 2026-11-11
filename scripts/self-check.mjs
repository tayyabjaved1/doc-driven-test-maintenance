#!/usr/bin/env node
/**
 * Guard #5 -- did the agent check its own work? The agent MUST run this
 * itself, as a mandatory last step, before finishing its turn. This is the
 * highest-leverage guard: it moves errors inside the agent's turn, where
 * they can still be fixed, instead of surfacing twenty minutes later in a
 * CI step the agent cannot see, after the store has already been written.
 *
 * This script invokes the REAL validators (scripts/lib/validators.mjs) --
 * never restates their rules -- and writes a fingerprint of the summary it
 * validated. validate-summary.mjs refuses to continue unless that
 * fingerprint matches the final summary file: enforced, not merely
 * requested. (Be honest about the limit: if the agent can write files, it
 * can write the fingerprint too. This catches *skipping* the check, which is
 * the realistic failure -- the validators themselves remain the actual
 * backstop, run again independently in validate-summary.mjs.)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadConfig, artifactsDir } from './lib/config.mjs';
import { runAllValidators } from './lib/validators.mjs';

function fingerprint(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function main() {
  const summaryPath = `${artifactsDir()}/summary.json`;
  if (!existsSync(summaryPath)) {
    console.error(`No summary at ${summaryPath} -- write it before running self-check.`);
    process.exit(1);
  }
  const raw = readFileSync(summaryPath, 'utf8');
  const summary = JSON.parse(raw);

  const prsPath = `${artifactsDir()}/queued-prs.json`;
  const inScopePRs = existsSync(prsPath) ? JSON.parse(readFileSync(prsPath, 'utf8')) : [];

  const config = loadConfig();
  const { ok, results } = await runAllValidators(config, summary, { inScopePRs });

  for (const [name, result] of Object.entries(results)) {
    const mark = result.ok ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${name}`);
    for (const err of result.errors ?? []) console.log(`       ${err}`);
  }

  const record = { fingerprint: fingerprint(raw), passed: ok, checkedAt: new Date().toISOString() };
  writeFileSync(`${artifactsDir()}/self-check.json`, JSON.stringify(record, null, 2));

  if (!ok) {
    console.error('\nSelf-check failed. Fix the summary and run this again before finishing -- do not finish with a failing self-check.');
    process.exit(1);
  }
  console.log('\nSelf-check passed.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
