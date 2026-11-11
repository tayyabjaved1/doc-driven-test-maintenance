# Porting checklist

- [ ] **Identify the pending states** — the ones only a person clears.
- [ ] **Find the state-level timestamp**, not the item's generic
      last-modified. If your store genuinely has no such timestamp, the
      adapter must return `null` for `enteredStateAt` — never substitute the
      item's own `updatedAt` as a stand-in (see `scripts/store/adapter.interface.md`).
- [ ] **Decide the grouping key** (module, team, service, owner) —
      `config.yml`'s `store.*.owning_area_field`.
- [ ] **Collector**: page with a pause, retry transient failures, bound it
      by time **and** page count (`config.yml`'s `collector.max_pages` /
      `retry_budget_seconds`) — already implemented for GitHub Projects;
      follow the same shape for another store.
- [ ] **Renderer**: worst-first by area, oldest-first within — already
      implemented in `scripts/lib/digest.mjs`, store-agnostic.
- [ ] **Notifier**: age in the first line, mentions only when non-empty —
      already implemented; point `config.yml`'s `notify.webhook_secret` at
      your own Slack-compatible incoming webhook's env var name.
- [ ] **Give it a read-only credential**, and fail closed if it's missing —
      see README.md's "Credentials" section.
- [ ] **Schedule it where people will act** — Monday morning, not Friday
      evening (`config.yml`'s `schedule.cron`, and the GitHub Actions
      workflow at `../.github/workflows/stalled-queue-digest.yml`).

## Verify before trusting it unattended

```bash
npm install
cp config.example.yml config.yml   # fill in every value
STORE_TOKEN=<read-only token> npm run collect
npm run render
cat .artifacts/digest.md            # read it before wiring the real webhook
NOTIFY_WEBHOOK_URL=<your webhook> npm run notify
```

Then deliberately break something — point `STORE_TOKEN` at an invalid
token, or `NOTIFY_WEBHOOK_URL` at an address that 404s — and confirm the
script that fails **exits non-zero and posts nothing**, rather than quietly
reporting an empty queue. That's the one property this whole tool exists
to guarantee.
