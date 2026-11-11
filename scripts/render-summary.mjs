#!/usr/bin/env node
/**
 * Renders the human-readable issue comment AND the notification text FROM
 * validated-summary.json -- never authored separately, so the two can never
 * disagree with each other or with the JSON. Every count below is
 * `array.length`, never a value the agent stated -- that mismatch (e.g.
 * `"created": 3` beside a list of two items) is exactly the inconsistency
 * this shape removes.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { artifactsDir } from './lib/config.mjs';

function renderModule(m) {
  const lines = [`### ${m.name}`, `_Driven by ${m.driven_by}_`, ''];
  if (m.created?.length) {
    lines.push(`**Created (${m.created.length})**`);
    for (const i of m.created) lines.push(`- ${i.title} (\`${i.item_id}\`, ${i.priority}, ${i.role})`);
    lines.push('');
  }
  if (m.updated?.length) {
    lines.push(`**Updated (${m.updated.length})**`);
    for (const i of m.updated) lines.push(`- ${i.title} (\`${i.item_id}\`) -- ${i.reason}`);
    lines.push('');
  }
  if (m.deprecated?.length) {
    lines.push(`**Deprecated (${m.deprecated.length})**`);
    for (const i of m.deprecated) lines.push(`- ${i.title} (\`${i.item_id}\`) -- ${i.reason}`);
    lines.push('');
  }
  lines.push(`_${m.no_change} existing case(s) audited, no change needed._`);
  return lines.join('\n');
}

function main() {
  const path = `${artifactsDir()}/validated-summary.json`;
  if (!existsSync(path)) {
    console.error(`${path} not found -- run validate-summary.mjs first.`);
    process.exit(1);
  }
  const summary = JSON.parse(readFileSync(path, 'utf8'));

  const totalCreated = summary.modules.reduce((n, m) => n + (m.created?.length ?? 0), 0);
  const totalUpdated = summary.modules.reduce((n, m) => n + (m.updated?.length ?? 0), 0);
  const totalDeprecated = summary.modules.reduce((n, m) => n + (m.deprecated?.length ?? 0), 0);

  const headline = summary.no_action_reason
    ? `No changes needed (${summary.no_action_reason.kind}): ${summary.no_action_reason.detail}`
    : `${totalCreated} created, ${totalUpdated} updated, ${totalDeprecated} deprecated across ${summary.modules.length} module(s).`;

  const comment = [
    `## Test-case maintenance cycle`,
    '',
    headline,
    '',
    ...summary.modules.map(renderModule),
    summary.conflicts.length ? `### Conflicts found\n${summary.conflicts.map((c) => `- ${c}`).join('\n')}` : '',
    summary.judgement_calls.length ? `### Judgement calls for review\n${summary.judgement_calls.map((c) => `- ${c}`).join('\n')}` : '',
    summary.notes.length ? `### Notes\n${summary.notes.map((n) => `- ${n}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const notification = headline;

  writeFileSync(`${artifactsDir()}/issue-comment.md`, comment);
  writeFileSync(`${artifactsDir()}/notification.txt`, notification);
  console.log('Rendered issue-comment.md and notification.txt from the validated summary.');
}

main();
