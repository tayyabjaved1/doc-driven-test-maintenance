# Porting checklist

Build in this order. Each stage is independently useful, and stopping early
still leaves something that works. Read `docs/ARCHITECTURE.md` first if you
haven't — this checklist assumes you have.

## Stage 1 — decide the inputs

- [ ] Confirm your reference docs exist and are current. **If not, stop and
      fix that first** — nothing downstream works without them.
- [ ] Decide the detection rule: which path, label or convention marks a PR
      as behaviour-changing. Fill in `config.yml`'s `detection` section.
- [ ] Identify your test-case store and its API. If it's GitHub Projects,
      run `npm run discover-fields -- --org <org> --project <number>` and
      copy the printed ids into `config.yml`'s `store.github_projects`
      section. If it's something else, see
      `scripts/store/adapter.interface.md` — you'll write an adapter in
      Stage 3.
- [ ] Confirm your store has (or add) statuses for the provisional states:
      draft, updated-under-review, deprecated-under-review, approved. Fill
      in `config.yml`'s `store.*.statuses`.
- [ ] Decide what "a module" means in this project — the unit the agent
      audits one at a time. Fill in `config.yml`'s `module_definition`.
- [ ] Copy `agent/RUNBOOK.template.md` to `agent/RUNBOOK.md` and fill in
      every placeholder.

## Stage 2 — scripts only, no agent

- [ ] `npm install`
- [ ] Set `REPO_OPS_TOKEN` (and `STORE_TOKEN` if testing the store) in a
      local `.env` — see `docs/CREDENTIALS.md` first.
- [ ] Run `npm run detect` by hand. Check `.artifacts/queued-prs.json` lists
      the PRs you expect — if it doesn't, your `docs_paths` glob or label
      convention is wrong; fix it here before anything else depends on it.
- [ ] Run `npm run preflight` — this is the exact call the agent's `create`
      will eventually make. If it fails, fix store access now, not later.
- [ ] Run `npm run fetch-catalogue` and open `.artifacts/catalogue.jsonl` —
      confirm the fields look right for your store.
- [ ] Run `npm run label-and-track` against a real (or disposable test) PR
      and confirm the label and tracking issue appear correctly.
- [ ] Run this on a schedule (or by hand, daily) and read its output for a
      few days before adding the agent. **If detection is wrong, everything
      downstream is wrong.**

## Stage 3 — the agent, dry-run only

- [ ] Confirm `scripts/lib/broker.mjs`'s three verbs (`create`, `update`,
      `get`) work against your adapter — call it directly from the command
      line with a throwaway item before trusting the agent with it.
- [ ] Re-read `agent/PROCESS.md` and your filled-in `agent/RUNBOOK.md`
      against each other. Every instruction that names a command, a path or
      an action is a place they can disagree — audit them now, and again
      whenever either changes.
- [ ] Wire the `audit` job in
      `.github/workflows/test-case-maintenance.yml` with your real
      `allowed_tools` (the ones already there are a reasonable default; add
      nothing beyond `Read`, a scoped `Write`, and the two allowlisted
      `Bash` commands unless you have a specific reason to).
- [ ] Add a dry-run mode if your adapter can support one (e.g. `create`/
      `update` log the operation instead of calling the store) — audit fully
      and write nothing, so you can read a summary before any mutation is
      real.
- [ ] Stay here until the summaries look right. **Verify against the store
      directly**, not against what the summary claims.

## Stage 4 — validation, before any live write

- [ ] Run `npm run validate` by hand against a summary you wrote (or the
      agent wrote in dry-run) and confirm every guard behaves as expected:
  - [ ] Ran-marker check
  - [ ] Output-exists check
  - [ ] Item-existence resolution
  - [ ] Grounding verification
  - [ ] Self-check script, enforced by fingerprint (`npm run self-check`
        first, then `npm run validate` — confirm it fails if you skip the
        first step, or edit the summary afterward)
  - [ ] Render-from-JSON (`npm run render`) — confirm the counts in
        `.artifacts/issue-comment.md` match the arrays, always
- [ ] Deliberately break something (a wrong item id, a missing
      `no_action_reason`) and confirm validation fails loudly and specifically.

## Stage 5 — go live

- [ ] Enable real writes (turn off any dry-run flag from Stage 3).
- [ ] Confirm notification and labelling are both gated on
      `validate`'s `passed` output in the workflow — not just documented as
      such.
- [ ] Add failure alerting (a webhook, an on-call ping) for a failed
      `validate` or `publish` job — see `docs/DIAGNOSING.md`'s step-icon
      warning before you trust the Actions UI alone for this.

## Stage 6 — prove it unattended

- [ ] A scheduled run with real work in scope that completes cleanly.
- [ ] A scheduled run with no work that skips cleanly (no issue, no
      notification, no store access).
- [ ] A deliberately broken run that fails **without** publishing or
      closing anything.

The third matters as much as the first. Don't trust this pipeline until
you've watched it refuse to publish.
