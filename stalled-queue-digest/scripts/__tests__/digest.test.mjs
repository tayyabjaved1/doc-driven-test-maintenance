import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageDays, compareAgeDesc, summarizeByArea, applyCaps, oldestAge } from '../lib/digest.mjs';

const NOW = new Date('2026-11-12T00:00:00Z');

test('ageDays: a null timestamp is null, never a substituted fallback', () => {
  assert.equal(ageDays(null, NOW), null);
  assert.equal(ageDays(undefined, NOW), null);
});

test('ageDays: computes whole days from a real timestamp', () => {
  assert.equal(ageDays('2026-11-09T00:00:00Z', NOW), 3);
  assert.equal(ageDays('2026-08-01T00:00:00Z', NOW), 103); // the documented "oldest: 103 days" case
});

test('compareAgeDesc: null always sorts last, regardless of which side it is on', () => {
  const items = [{ a: 5 }, { a: null }, { a: 30 }, { a: null }, { a: 1 }];
  items.sort((x, y) => compareAgeDesc(x.a, y.a));
  assert.deepEqual(items.map((i) => i.a), [30, 5, 1, null, null]);
});

test('compareAgeDesc: reproduces the documented bug scenario correctly -- an undated item never displaces a genuinely old one from the front', () => {
  // The real bug: an empty-string timestamp sorted BEFORE every ISO string,
  // so an undated item appeared "oldest". This must never happen.
  const items = [{ id: 'old', a: 103 }, { id: 'undated', a: null }, { id: 'mid', a: 14 }];
  items.sort((x, y) => compareAgeDesc(x.a, y.a));
  assert.equal(items[0].id, 'old');
  assert.equal(items.at(-1).id, 'undated');
});

test('summarizeByArea: area ranking uses MAX age, not MIN (the documented min/max bug)', () => {
  const items = [
    { owningArea: 'Applications', ageDays: 6, id: 'a1' },
    { owningArea: 'Applications', ageDays: 69, id: 'a2' }, // the documented "69d" item
    { owningArea: 'Leave', ageDays: 10, id: 'l1' },
  ];
  const areas = summarizeByArea(items);
  const applications = areas.find((a) => a.area === 'Applications');
  // A min() bug would report 6 here ("Oldest: 6 days") -- must be 69.
  assert.equal(applications.maxAge, 69);
});

test('summarizeByArea: worst-first ordering, areas with only undated items sort last', () => {
  const items = [
    { owningArea: 'Quiet', ageDays: null, id: 'q1' },
    { owningArea: 'Urgent', ageDays: 50, id: 'u1' },
    { owningArea: 'Medium', ageDays: 10, id: 'm1' },
  ];
  const areas = summarizeByArea(items);
  assert.deepEqual(areas.map((a) => a.area), ['Urgent', 'Medium', 'Quiet']);
});

test('applyCaps: caps areas and detail items without silently losing the rest -- hidden counts are exact', () => {
  const areas = summarizeByArea(
    Array.from({ length: 10 }, (_, i) => ({ owningArea: `Area${i}`, ageDays: i, id: `i${i}` }))
  );
  const { shownAreas, hiddenAreaCount, detailItems, hiddenDetailCount } = applyCaps(areas, { maxAreas: 3, maxDetailItems: 4 });
  assert.equal(shownAreas.length, 3);
  assert.equal(hiddenAreaCount, 7);
  assert.equal(detailItems.length, 4);
  assert.equal(hiddenDetailCount, 6);
  // The 4 shown detail items must be the 4 globally oldest, not just the
  // first area's items.
  assert.deepEqual(detailItems.map((i) => i.id), ['i9', 'i8', 'i7', 'i6']);
});

test('applyCaps: undated items are never counted among capped detail items', () => {
  const items = [
    { owningArea: 'A', ageDays: 5, id: 'dated' },
    { owningArea: 'A', ageDays: null, id: 'undated' },
  ];
  const areas = summarizeByArea(items);
  const { detailItems } = applyCaps(areas, { maxAreas: 5, maxDetailItems: 5 });
  assert.equal(detailItems.some((i) => i.id === 'undated'), false);
});

test('oldestAge: returns null only when nothing has a known age', () => {
  assert.equal(oldestAge([{ ageDays: null }, { ageDays: null }]), null);
  assert.equal(oldestAge([{ ageDays: null }, { ageDays: 42 }]), 42);
});
