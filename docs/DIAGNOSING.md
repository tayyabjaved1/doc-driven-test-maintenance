# Diagnosing failures

## Step icons lie — the single most useful thing in this document

A GitHub Actions step marked `continue-on-error: true` reports
`conclusion: success` **even when it failed.** GitHub masks the real result;
only `outcome` carries it, and the standard jobs API does not expose
`outcome`. A broken step can sit green in every run log for weeks and never
once have actually succeeded.

The reliable signals instead:

| Instead of | Check |
|---|---|
| The render step's icon | Whether the publish job's precondition (`validate`'s `passed` output) is `true` |
| A `continue-on-error` step's conclusion | Whether its gated follow-up step **ran** — if a "something failed" step ran, something failed |
| "The agent did X" | The agent's execution-log artifact: what tools it actually called |

Keep the agent's execution log as an artifact on every run (most agent
GitHub Actions emit one; upload it alongside the other `.artifacts/` output).
It is the only way to answer "what did it actually do," and it will answer
that question more often than the job log does.

## Failure modes to design against

| Symptom | Cause |
|---|---|
| Run green, nothing done, issue closed | No ran-marker check |
| Confident summary, zero updates | Agent could not read the store; empty results looked like a finding |
| Render rejects a correct audit | Agent used different key names than the contract (see the vocabulary-normalization note in `scripts/lib/validators.mjs`) |
| Report lists items that do not exist | No existence verification |
| Live cycle lost its report | No retry on a transient lookup failure |
| Agent ran a while, wrote nothing | It spawned background sub-processes and ended its turn waiting for them — in CI, nothing wakes it back up |
| Zero changes reported, writes all refused | No `no_action_reason`; empty looked like "nothing needed" |
| PRs marked done on a failed run | Agent labelled them itself, bypassing the gate |

## A pattern worth internalising

Across systems built this way, the overwhelming majority of real incidents
share one shape: **a failure path that reported success.** Some of those
failures are even found inside code written specifically to fix that exact
problem — a guard can itself fail silently.

When reviewing this pipeline — its config, a change to `agent/PROCESS.md`, a
new store adapter — the question to ask is never "did it pass?" It is
**"what would this look like if it had failed?"** If the honest answer is
"the same," there is a guard missing.

## On the agent's own judgement

Worth remembering as you tune this: the agent is often right and the
plumbing around it is often wrong. An agent that declines to update a case
it cannot confidently match, and says so in its notes, has made a good call
— not a failure to fix. The risk is not that the agent needs more watching.
It is that **its uncertainty needs a reliable channel out** (`conflicts` and
`judgement_calls` in the summary contract exist for exactly this). Build that
reporting path as carefully as the audit logic itself — a good judgement
call that never reaches a human because the run that reported it failed to
publish is no better than a bad one.
