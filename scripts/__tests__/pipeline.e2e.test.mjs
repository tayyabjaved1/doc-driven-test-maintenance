import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifactsDir = join(repoRoot, '.artifacts');

const env = {
  ...process.env,
  CONFIG_PATH: join(repoRoot, 'scripts/__tests__/fixtures/config.fake.yml'),
  FAKE_STORE_PATH: join(artifactsDir, 'fake-store.e2e.json'),
};

function run(script, extraEnv = {}) {
  return execFileAsync('node', [join(repoRoot, script)], { cwd: repoRoot, env: { ...env, ...extraEnv } });
}

function writeSummary(summary) {
  writeFileSync(join(artifactsDir, 'summary.json'), JSON.stringify(summary, null, 2));
}

before(() => {
  mkdirSync(artifactsDir, { recursive: true });
  [`summary.json`, `self-check.json`, `validated-summary.json`, `issue-comment.md`, `notification.txt`, `fake-store.e2e.json`, `queued-prs.json`, `agent-ran.marker`].forEach((f) => {
    const p = join(artifactsDir, f);
    if (existsSync(p)) rmSync(p);
  });
});

after(() => {
  [`summary.json`, `self-check.json`, `validated-summary.json`, `issue-comment.md`, `notification.txt`, `fake-store.e2e.json`, `queued-prs.json`, `agent-ran.marker`].forEach((f) => {
    const p = join(artifactsDir, f);
    if (existsSync(p)) rmSync(p);
  });
});

test('full chain: broker create -> self-check -> validate -> render, all green', async () => {
  // Phase "3" (the agent), simulated: create an item through the broker --
  // the exact CLI surface the real agent is given, nothing more direct.
  const createRes = await execFileAsync(
    'node',
    [join(repoRoot, 'scripts/lib/broker.mjs'), 'create', JSON.stringify({ title: 'Student can view offer', fields: { status: 'Draft' } })],
    { cwd: repoRoot, env }
  );
  const { id: itemId } = JSON.parse(createRes.stdout.trim().split('\n').pop());
  assert.ok(itemId, 'broker create returned an item id');

  // The agent's literal first action (simulated -- PROCESS.md tells the
  // real agent to do this itself via its Write tool).
  writeFileSync(join(artifactsDir, 'agent-ran.marker'), '');
  writeFileSync(join(artifactsDir, 'queued-prs.json'), JSON.stringify([{ number: 1, title: 'docs: update offer flow', url: 'https://example.com/1' }]));

  writeSummary({
    modules: [
      {
        name: 'Applications',
        driven_by: '#1',
        created: [{ title: 'Student can view offer', item_id: itemId, priority: 'P1', role: 'Student' }],
        updated: [],
        deprecated: [],
        no_change: 0,
      },
    ],
    grounding: [
      {
        claim: 'The page has 3 visible tabs',
        file: 'scripts/__tests__/fixtures/sample-doc.md',
        line: 4,
        excerpt: 'The page has 3 visible tabs.',
      },
    ],
    conflicts: [],
    judgement_calls: [],
    notes: [],
  });

  // The agent's literal last action.
  await run('scripts/self-check.mjs');
  const selfCheck = JSON.parse(readFileSync(join(artifactsDir, 'self-check.json'), 'utf8'));
  assert.equal(selfCheck.passed, true);

  // The independent CI validation step.
  const { stdout: validateOut } = await run('scripts/validate-summary.mjs');
  assert.match(validateOut, /Validation passed/);

  // Rendering -- counts must be derived, never stated.
  await run('scripts/render-summary.mjs');
  const comment = readFileSync(join(artifactsDir, 'issue-comment.md'), 'utf8');
  assert.match(comment, /Created \(1\)/);
  assert.match(comment, /Student can view offer/);
});

test('tamper detection: editing summary.json after self-check fails validation', async () => {
  // Reuses the summary.json + self-check.json from the previous test, then
  // edits the summary afterward -- exactly the scenario the fingerprint
  // guard exists for.
  const summary = JSON.parse(readFileSync(join(artifactsDir, 'summary.json'), 'utf8'));
  summary.modules[0].created.push({ title: 'Sneaked in after self-check', item_id: 'fake-does-not-exist', priority: 'P2', role: 'Student' });
  writeSummary(summary);

  await assert.rejects(() => run('scripts/validate-summary.mjs'));
});

test('missing self-check.json fails validation outright', async () => {
  rmSync(join(artifactsDir, 'self-check.json'));
  await assert.rejects(() => run('scripts/validate-summary.mjs'));
});
