# Stalled-queue digest

A companion to [the test-case maintenance pipeline](../README.md), and the
simplest thing in this repo to build. **Nothing about it is specific to test
cases** — it's a small, portable, domain-agnostic scheduled job for any
project with a queue a human has to clear.

## The problem

Any pipeline that proposes changes for a human to approve creates a queue.
Nobody watches it, because the pipeline reports on its own runs — not on
what its output is waiting for. A real instance of this reached **330
items, 307 over two weeks old, the oldest 103 days** before anything
surfaced it, while the board itself looked healthy (thousands of approved
items). While an item is pending, neither the old nor the new version is
fully trusted — the catalogue develops a region that can't be trusted, and
its size is invisible.

This shape appears wherever a pipeline proposes and a human disposes:

| Pipeline proposes | Human disposes | The queue nobody watches |
|---|---|---|
| Doc-driven test-case updates | Lead promotes | Items `Under Review` |
| Dependency bumps | Engineer merges | Open Dependabot PRs |
| Triaged alerts | On-call confirms | Alerts marked `needs-triage` |
| Flagged content | Moderator decides | Items in the moderation queue |
| Drafted schema changes | DBA approves | Migrations pending sign-off |

If your system has a state that only a person can clear, it has this
problem, and almost certainly does not know its size.

## What it is

Three small scripts, **no agent**. About a day of work including the guards.

| Script | Does |
|---|---|
| `collector.mjs` | Pages the store, keeps items in the pending states, records when each **entered** that state |
| `renderer.mjs` | Groups by owning area worst-first, oldest-first within each |
| `notifier.mjs` | One message, leading with the oldest age |

## Four decisions that matter more than the code

1. **Lead with age, not count.** "330 again this week" normalises and stops
   being read. "Oldest: 103 days" does not, and it's the number that
   separates a *stalled* queue from a *busy* one.
2. **Measure from when the item entered the pending state — not when it
   last changed.** The one that will bite you: a pipeline that rewrites an
   item's reason while it's still pending touches its generic
   `updatedAt` and makes a long-waiting item look fresh. A real run showed
   299 items over 14 days by generic timestamp, 307 by the state-transition
   timestamp — 8 items hidden, and the bias always runs one way (the
   most-churned items look the freshest). Find the **state-level**
   timestamp — GitHub Projects exposes it on the field value itself
   (`ProjectV2ItemFieldSingleSelectValue.updatedAt`), not the item.
3. **Mention people only when there's something to do.** Pinging the team
   to say the queue is clear teaches them the card is noise.
4. **A failed collection must report nothing at all.** "Nothing is waiting"
   and "I could not look" are opposite messages, and the first reads as
   all-clear. Exit non-zero and post nothing — then make sure a failed
   *notification* also fails the run, or the job goes green having told
   nobody anything.

**Cap the detail**: name the top 5–6 areas and the ~20 oldest items — a
digest listing 330 rows is one nobody opens.

## Bugs found while building this — and fixed

| Bug | Effect | Guarded by |
|---|---|---|
| `min()` where `max()` was meant | Headline read "Oldest: 6 days" beside a table showing 69d — understates the problem on every card | `summarizeByArea` uses `Math.max`, tested explicitly |
| Undated items sorted first | Empty/null timestamps sorting ahead of real ones displaced genuine old cases from the detail list | `compareAgeDesc` always pushes `null` last, in either sort direction |
| Partial GraphQL responses accepted | The API returns `data` *alongside* `errors`; a page missing one field silently dropped items and published an undercount as complete | `assertNoGraphqlErrors` throws on any `errors` entry, even with `data` present |
| Notification failure returned success | The run went green having delivered nothing — in the one job whose purpose is breaking a silence | `notifier.mjs` never catches a failed POST; it propagates and exits non-zero |

The last two share the shape that dominates this whole repo: **a failure
path that reports success.** When reviewing a change here, the question is
never "did it pass?" but **"what would this look like if it had failed?"**
If the answer is "the same," a guard is missing.

## What it does not fix

Visibility is not capacity. A digest nobody owns is another weekly message
to ignore — assign a name before you ship it. And watch the *trend*, not
the number: if it falls, review capacity was the constraint and the digest
did its job; if it holds or climbs, the upstream pipeline produces faster
than anyone can review, and the real fix is slowing production — a
different decision, now backed by evidence instead of a guess.

## Quick start

```bash
cd stalled-queue-digest   # this folder is self-contained -- copy it out on its own if you like
npm install
cp config.example.yml config.yml   # fill in every value -- see PORTING.md
```

See [PORTING.md](PORTING.md) for the adoption checklist, and
[scripts/store/adapter.interface.md](scripts/store/adapter.interface.md) to
add a store other than GitHub Projects.

## Credentials

**Use a dedicated read-only token even though a broader one would work.** A
real review caught a PR that claimed "no write credential" while handing a
scheduled job exactly that (an inherited cross-repo PAT with write scope).
This tool only ever reads — give it a token that can't do anything else, and
fail closed (`STORE_TOKEN is not set`) rather than silently skip the check.

## License

[MIT](../LICENSE)
