# Store adapter interface

A store adapter is a plain ES module exporting one async function.
`github-projects.adapter.mjs` is the reference implementation.

```ts
listPendingItems(config): Promise<Array<{
  id: string,
  title: string,
  url: string,
  owningArea: string,       // the configured grouping key's value, or "Unassigned"
  pendingStatus: string,    // which configured pending_statuses value this item currently holds
  enteredStateAt: string | null, // ISO timestamp the item ENTERED this status -- null if genuinely unavailable
}>>
```

Only ONE function, deliberately narrower than the sibling test-case-maintenance
tool's four-function interface: this tool never writes to the store, so
`preflight`/`createItem`/`updateItemFields` have no reason to exist here. A
read-only credential is a real safety property, not an implementation detail
-- see README.md's "fail closed" note.

**The hard part an adapter must get right: `enteredStateAt` is a
state-level timestamp, not the item's generic last-modified time.** GitHub
Projects v2 exposes this on the field value itself
(`ProjectV2ItemFieldSingleSelectValue.updatedAt`), not on the item --
reusing the item's own `updatedAt` instead silently understates age for any
item that was touched for an unrelated reason while still pending (the
exact bug this tool's README documents hitting). If your store's API truly
has no state-level timestamp, return `null` for `enteredStateAt` rather than
substituting the item's own last-modified time — a known-unavailable age is
honest; a wrong one is not, and the renderer handles `null` explicitly (see
`scripts/renderer.mjs`'s known-age vs unknown-age split).

**Pagination must be bounded by both time and page count** (`config.collector`),
and the whole call must throw -- never return a partial list silently -- on
any GraphQL `errors` entry, even alongside non-empty `data` (see
`scripts/lib/gh.mjs`'s comment on this).
