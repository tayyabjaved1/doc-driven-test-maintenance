#!/usr/bin/env node
/**
 * Groups by owning area worst-first, oldest-first within each. Writes
 * digest.json (structured, read by notifier.mjs -- so the message it sends
 * can never disagree with what was actually computed) and digest.md (human
 * review). Caps detail (top N areas, top M oldest items overall) without
 * silently dropping the rest -- a "+N more" note instead.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, artifactsDir } from './lib/config.mjs';
import { summarizeByArea, applyCaps, oldestAge } from './lib/digest.mjs';

function formatItem(item) {
  const age = item.ageDays == null ? 'unknown age' : `${item.ageDays}d`;
  const link = item.url ? ` — ${item.url}` : '';
  return `- **${age}** ${item.title} (${item.pendingStatus})${link}`;
}

function renderMarkdown(digest) {
  if (digest.isEmpty) {
    return '## Stalled-queue digest\n\nNothing is currently pending. Queue is clear.';
  }

  const lines = [
    '## Stalled-queue digest',
    '',
    `**Oldest: ${digest.oldestAgeDays} day(s)** — ${digest.totalCount} item(s) pending across ${digest.areas.length + digest.hiddenAreaCount} area(s).`,
    '',
  ];

  for (const area of digest.areas) {
    const ageLabel = area.maxAge == null ? 'unknown age' : `oldest ${area.maxAge}d`;
    lines.push(`### ${area.area} (${area.count}, ${ageLabel})`);
    for (const item of area.detailItems) lines.push(formatItem(item));
    lines.push('');
  }

  if (digest.hiddenAreaCount > 0) lines.push(`_+${digest.hiddenAreaCount} more area(s) not shown._`);
  if (digest.hiddenDetailCount > 0) lines.push(`_+${digest.hiddenDetailCount} more item(s) not shown._`);

  return lines.join('\n');
}

function main() {
  const config = loadConfig();
  const inPath = `${artifactsDir()}/stalled-queue.json`;
  if (!existsSync(inPath)) {
    throw new Error(`${inPath} not found -- collector.mjs must succeed before rendering.`);
  }
  const { items } = JSON.parse(readFileSync(inPath, 'utf8'));

  const { max_areas: maxAreas, max_detail_items: maxDetailItems } = config.caps;

  let digest;
  if (items.length === 0) {
    digest = { isEmpty: true, totalCount: 0, oldestAgeDays: null, areas: [], hiddenAreaCount: 0, hiddenDetailCount: 0, generatedAt: new Date().toISOString() };
  } else {
    const areas = summarizeByArea(items);
    const { shownAreas, hiddenAreaCount, detailItems, hiddenDetailCount } = applyCaps(areas, { maxAreas, maxDetailItems });

    // Attach each shown area's own slice of the globally-capped detail list,
    // so an area doesn't get a detail section wider than the global cap allows.
    const detailIds = new Set(detailItems.map((i) => i.id));
    const areasWithDetail = shownAreas.map((a) => ({
      area: a.area,
      count: a.count,
      maxAge: a.maxAge,
      detailItems: a.items.filter((i) => detailIds.has(i.id)),
    }));

    digest = {
      isEmpty: false,
      totalCount: items.length,
      oldestAgeDays: oldestAge(items),
      areas: areasWithDetail,
      hiddenAreaCount,
      hiddenDetailCount,
      generatedAt: new Date().toISOString(),
    };
  }

  writeFileSync(`${artifactsDir()}/digest.json`, JSON.stringify(digest, null, 2));
  writeFileSync(`${artifactsDir()}/digest.md`, renderMarkdown(digest));
  console.log(digest.isEmpty ? 'Rendered digest: queue is empty.' : `Rendered digest: oldest ${digest.oldestAgeDays}d, ${digest.totalCount} item(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
