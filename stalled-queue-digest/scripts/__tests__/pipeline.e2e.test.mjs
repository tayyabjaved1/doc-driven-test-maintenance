import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifactsDir = join(repoRoot, '.artifacts');
const fixturesDir = join(repoRoot, 'scripts/__tests__/fixtures');

const NOW_ISO = new Date().toISOString();
const DAYS_AGO = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

const FIXTURE_ITEMS = [
  // The documented "min vs max" case: Applications has a 6d item and a 69d
  // item -- the area's reported age must be 69, not 6.
  { id: 'app-1', title: 'Student can view offer', url: 'https://example.com/1', owningArea: 'Applications', pendingStatus: 'Updated (Under Review)', enteredStateAt: DAYS_AGO(6) },
  { id: 'app-2', title: 'Counselor can edit offer', url: 'https://example.com/2', owningArea: 'Applications', pendingStatus: 'Draft', enteredStateAt: DAYS_AGO(69) },
  // The documented "undated item" case: must never be reported as oldest.
  { id: 'leave-undated', title: 'Leave edge case', url: null, owningArea: 'Leave', pendingStatus: 'Draft', enteredStateAt: null },
  { id: 'leave-1', title: 'Apply for leave', url: 'https://example.com/3', owningArea: 'Leave', pendingStatus: 'Draft', enteredStateAt: DAYS_AGO(10) },
];

function writeFixture() {
  mkdirSync(fixturesDir, { recursive: true });
  writeFileSync(join(fixturesDir, 'items.json'), JSON.stringify(FIXTURE_ITEMS, null, 2));
}

const baseEnv = {
  ...process.env,
  CONFIG_PATH: join(repoRoot, 'scripts/__tests__/fixtures/config.fake.yml'),
  FAKE_ITEMS_PATH: join(fixturesDir, 'items.json'),
};

function run(script, extraEnv = {}) {
  return execFileAsync('node', [join(repoRoot, script)], { cwd: repoRoot, env: { ...baseEnv, ...extraEnv } });
}

function cleanArtifacts() {
  for (const f of ['stalled-queue.json', 'digest.json', 'digest.md']) {
    const p = join(artifactsDir, f);
    if (existsSync(p)) rmSync(p);
  }
}

let server;
let serverUrl;
let receivedPayloads = [];
let serverShouldFail = false;

before(async () => {
  writeFixture();
  cleanArtifacts();
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (serverShouldFail) {
        res.writeHead(500);
        res.end('nope');
        return;
      }
      receivedPayloads.push(JSON.parse(body));
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  cleanArtifacts();
  rmSync(join(fixturesDir, 'items.json'), { force: true });
  await new Promise((resolve) => server.close(resolve));
});

test('full chain: collector -> renderer -> notifier, correct ranking and a real webhook post', async () => {
  await run('scripts/collector.mjs');
  const collected = JSON.parse(readFileSync(join(artifactsDir, 'stalled-queue.json'), 'utf8'));
  assert.equal(collected.items.length, 4);

  await run('scripts/renderer.mjs');
  const digest = JSON.parse(readFileSync(join(artifactsDir, 'digest.json'), 'utf8'));

  // Area ranking: Applications (69d) must outrank Leave (10d) -- MAX, not MIN.
  assert.equal(digest.areas[0].area, 'Applications');
  assert.equal(digest.areas[0].maxAge, 69);
  assert.equal(digest.oldestAgeDays, 69);

  // The undated Leave item must never be reported as the oldest, and must
  // not appear in any area's detail list ahead of a dated item.
  const leaveArea = digest.areas.find((a) => a.area === 'Leave');
  assert.equal(leaveArea.maxAge, 10); // not null/undefined-derived
  assert.equal(leaveArea.detailItems[0].id, 'leave-1');

  serverShouldFail = false;
  receivedPayloads = [];
  await run('scripts/notifier.mjs', { NOTIFY_WEBHOOK_URL: serverUrl });
  assert.equal(receivedPayloads.length, 1);
  assert.match(receivedPayloads[0].text, /@qe-team/); // non-empty queue -> mentioned
  assert.match(receivedPayloads[0].text, /Oldest: 69/);
});

test('notifier: a failing webhook POST makes the whole run fail -- never silently green', async () => {
  serverShouldFail = true;
  await assert.rejects(() => run('scripts/notifier.mjs', { NOTIFY_WEBHOOK_URL: serverUrl }));
  serverShouldFail = false;
});

test('empty queue: no mention, but still reports (not silently nothing)', async () => {
  writeFileSync(join(fixturesDir, 'items.json'), JSON.stringify([]));
  cleanArtifacts();

  await run('scripts/collector.mjs');
  await run('scripts/renderer.mjs');
  const digest = JSON.parse(readFileSync(join(artifactsDir, 'digest.json'), 'utf8'));
  assert.equal(digest.isEmpty, true);

  receivedPayloads = [];
  await run('scripts/notifier.mjs', { NOTIFY_WEBHOOK_URL: serverUrl });
  assert.equal(receivedPayloads.length, 1);
  assert.equal(receivedPayloads[0].text.includes('@qe-team'), false);

  writeFixture(); // restore for any later test run
});
