/**
 * Pure logic shared by renderer.mjs -- no I/O, so every rule documented in
 * README.md's "four decisions" and "bugs we hit" sections is directly
 * unit-testable here, not just exercised incidentally through a CLI run.
 */

/** @param enteredStateAt ISO timestamp or null; @param now a Date (injected for testability) */
export function ageDays(enteredStateAt, now = new Date()) {
  if (!enteredStateAt) return null; // unknown age is null, never a substituted fallback -- see adapter.interface.md
  const ms = now.getTime() - new Date(enteredStateAt).getTime();
  return Math.floor(ms / 86_400_000);
}

/**
 * Null-safe age comparator for a "worst/oldest first" (descending) sort.
 * An unknown age (null) must NEVER sort ahead of a real number in either
 * direction -- this is the general form of the documented bug where an
 * empty-string timestamp sorted before every real ISO string and displaced
 * genuinely old items from the detail list. Always push null to the end.
 */
export function compareAgeDesc(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

/**
 * Groups items by owningArea, computes each area's worst (MAX, not MIN --
 * the documented min/max bug) age among its dated items, and returns areas
 * sorted worst-first. An area with no dated items at all gets `maxAge:
 * null` and sorts last (compareAgeDesc), never first.
 * @param items the adapter's listPendingItems() output, each with an `ageDays` already attached
 */
export function summarizeByArea(items) {
  const byArea = new Map();
  for (const item of items) {
    if (!byArea.has(item.owningArea)) byArea.set(item.owningArea, []);
    byArea.get(item.owningArea).push(item);
  }

  const areas = [...byArea.entries()].map(([area, areaItems]) => {
    const datedAges = areaItems.map((i) => i.ageDays).filter((a) => a != null);
    const maxAge = datedAges.length > 0 ? Math.max(...datedAges) : null; // MAX, not MIN
    const sortedItems = [...areaItems].sort((a, b) => compareAgeDesc(a.ageDays, b.ageDays));
    return { area, count: areaItems.length, maxAge, items: sortedItems };
  });

  areas.sort((a, b) => compareAgeDesc(a.maxAge, b.maxAge));
  return areas;
}

/**
 * Applies the configured caps without silently losing information: areas
 * beyond `maxAreas` are still counted in a "+N more areas" note, and
 * detail items beyond `maxDetailItems` (taken globally oldest-first across
 * all areas, undated items never counted among them) are noted as
 * "+N more items" rather than just vanishing.
 */
export function applyCaps(areas, { maxAreas, maxDetailItems }) {
  const shownAreas = areas.slice(0, maxAreas);
  const hiddenAreaCount = Math.max(0, areas.length - maxAreas);

  const allItemsOldestFirst = areas
    .flatMap((a) => a.items)
    .sort((a, b) => compareAgeDesc(a.ageDays, b.ageDays));
  const datedOnly = allItemsOldestFirst.filter((i) => i.ageDays != null);
  const detailItems = datedOnly.slice(0, maxDetailItems);
  const hiddenDetailCount = Math.max(0, datedOnly.length - maxDetailItems);

  return { shownAreas, hiddenAreaCount, detailItems, hiddenDetailCount };
}

/** @returns the single oldest ageDays across every item, or null if nothing has a known age */
export function oldestAge(items) {
  const dated = items.map((i) => i.ageDays).filter((a) => a != null);
  return dated.length > 0 ? Math.max(...dated) : null;
}
