#!/usr/bin/env node
/**
 * Phase 5 -- Publish, only if validation passed. Summary comment on the
 * tracking issue -> notification -> label PRs done -> close the issue. If
 * any validation step failed, this script is never invoked (gated by the
 * workflow on validate-summary.mjs's output, and double-checked here by
 * requiring validated-summary.json to exist). These three actions --
 * labelling PRs done, closing the tracking issue, sending the notification
 * -- are also the three things the agent itself must never do (see
 * docs/ARCHITECTURE.md): they are claims that the cycle finished, and only
 * this script, running after validation, is allowed to make that claim.
 */
import { readFileSync, existsSync } from 'node:fs';
import { loadConfig, artifactsDir } from './lib/config.mjs';
import { ghRest } from './lib/gh.mjs';

function repoToken() {
  const token = process.env.REPO_OPS_TOKEN;
  if (!token) throw new Error('REPO_OPS_TOKEN is not set');
  return token;
}

async function notify(text) {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) {
    console.log('NOTIFY_WEBHOOK_URL not set -- skipping notification. Set it (Slack-compatible incoming webhook) to enable.');
    return;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`Notification webhook returned ${res.status}`);
}

async function main() {
  const validatedPath = `${artifactsDir()}/validated-summary.json`;
  if (!existsSync(validatedPath)) {
    throw new Error('No validated-summary.json -- validation did not pass (or did not run). Refusing to publish.');
  }

  const config = loadConfig();
  const { repo, labels } = config.detection;
  const token = repoToken();

  const comment = readFileSync(`${artifactsDir()}/issue-comment.md`, 'utf8');
  const notification = readFileSync(`${artifactsDir()}/notification.txt`, 'utf8');
  const prs = existsSync(`${artifactsDir()}/queued-prs.json`) ? JSON.parse(readFileSync(`${artifactsDir()}/queued-prs.json`, 'utf8')) : [];
  const tracking = existsSync(`${artifactsDir()}/tracking-issue.json`) ? JSON.parse(readFileSync(`${artifactsDir()}/tracking-issue.json`, 'utf8')) : null;

  if (!tracking) {
    console.log('No tracking issue on record -- nothing to comment on or close (an idle cycle with no in-scope PRs).');
    return;
  }

  // 1. Summary comment on the issue.
  await ghRest(token, [`repos/${repo}/issues/${tracking.number}/comments`, '-X', 'POST', '-f', `body=${comment}`]);

  // 2. Notification.
  await notify(notification);

  // 3. Label PRs done.
  for (const pr of prs) {
    await ghRest(token, [
      `repos/${repo}/issues/${pr.number}/labels/${encodeURIComponent(labels.queued)}`,
      '-X', 'DELETE',
    ]).catch(() => {}); // label may already be gone; not a failure
    await ghRest(token, [
      `repos/${repo}/issues/${pr.number}/labels`,
      '-X', 'POST',
      '-f', `labels[]=${labels.done}`,
    ]);
  }

  // 4. Close the tracking issue.
  await ghRest(token, [`repos/${repo}/issues/${tracking.number}`, '-X', 'PATCH', '-f', 'state=closed']);

  console.log(`Published: commented on #${tracking.number}, notified, labelled ${prs.length} PR(s) done, closed the issue.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
