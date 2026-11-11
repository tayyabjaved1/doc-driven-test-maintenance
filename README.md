# Doc-driven test-case maintenance

A portable GitHub Actions pipeline that keeps a manual test-case catalogue in
sync with product documentation. It watches merged pull requests for
documented behaviour changes, has an AI agent audit the affected features
against the current docs, and creates/updates/deprecates test cases
accordingly — but only ever publishes anything after a battery of
independent validation checks pass.

Not domain-specific: it ships with a working GitHub Projects (v2) adapter
and no other dependency beyond a GitHub org and an Anthropic API key. Built
to be forked and configured, not rewritten.

## The one-sentence design

**The agent does only what needs judgement — reading docs, deciding what a
test case should assert. Every mechanical step (finding PRs, labelling,
notifying, publishing) is a plain script, and nothing is published until a
separate validation phase, which the agent cannot see or influence, has
passed.** See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the whole
design and why each piece exists.

## Before you start

This only works if your project already has:

1. Per-feature reference docs describing user-visible behaviour, in the repo.
2. A structured test-case store with an API (GitHub Projects, Jira, TestRail...).
3. Docs and code in the same repo, or reliably cross-referenced.
4. A convention linking PRs to features — a docs path, a label, a directory.

If you don't have #1 yet, build that first — everything here amplifies doc
quality in both directions.

## Quick start

```bash
npm install
cp config.example.yml config.yml   # fill in every value -- see PORTING.md Stage 1
cp agent/RUNBOOK.template.md agent/RUNBOOK.md   # fill in every placeholder
cp .env.example .env                # for running scripts by hand locally
```

Then follow [PORTING.md](PORTING.md) — a 6-stage checklist, each stage
independently useful, ending with proof the pipeline fails safely before you
ever trust it unattended.

## Layout

```
.github/workflows/test-case-maintenance.yml   the pipeline, 5 jobs (detect -> prepare -> audit -> validate -> publish)
agent/
  PROCESS.md           how this CI run works -- read by the agent every run
  RUNBOOK.template.md  what a good test case looks like here -- copy to RUNBOOK.md and fill in
  summary.schema.json  the one machine-readable file the agent writes
scripts/
  detect-prs.mjs         phase 1
  preflight.mjs          phase 2a
  fetch-catalogue.mjs    phase 2b
  label-and-track.mjs    phase 2c
  self-check.mjs         the agent's own mandatory last step (phase 3)
  validate-summary.mjs   phase 4
  render-summary.mjs     phase 4 (prose + notification, generated from the JSON)
  publish.mjs            phase 5
  lib/                   config, the broker, validators, a paced GitHub API client
  store/                 the adapter interface + the GitHub Projects adapter
docs/
  ARCHITECTURE.md   the design, the guards, and why each exists
  CREDENTIALS.md    the four-token model and the traps that cost real time
  DIAGNOSING.md     why GitHub Actions' own UI lies about step success, and what to check instead
PORTING.md          the adoption checklist
```

## Adding a different test-case store

GitHub Projects is the only fully-implemented adapter. The interface is four
functions (`preflight`, `listAll`, `createItem`/`getItem`,
`updateItemFields`) — see
[scripts/store/adapter.interface.md](scripts/store/adapter.interface.md) and
use `scripts/store/github-projects.adapter.mjs` as the reference shape for a
Jira, TestRail, or in-house adapter.

## License

[MIT](LICENSE)
