# Architecture

## What this builds

A nightly job that reads merged pull requests, works out which product
behaviour changed, and creates or updates test cases in a test-case store to
match — then reports what it did, or refuses to report anything at all.

The insight it rests on: **product documentation already describes what the
app does.** When a PR changes those docs, the docs and the test cases have
drifted apart. So this pipeline watches the docs, not the code.

This matters at scale. A catalogue of a few hundred test cases can be
re-read by hand. One of several thousand cannot, so it silently rots — and a
test suite nobody trusts is worse than none.

## Prerequisites — be honest about these before starting

This design only works if your project already has all four:

| Requirement | Why it is load-bearing |
|---|---|
| Per-feature reference docs in the repo, describing user-visible behaviour | This is the entire input. Without it the agent has nothing to audit against and will fall back to guessing from code. |
| A structured test-case store with an API | The agent must read ~all existing cases to avoid duplicates, and write back with status fields. |
| Docs and code in the same repo, or reliably cross-referenced | The agent cross-checks doc claims against implementation. Split repos make this fragile. |
| A convention linking PRs to features — a docs path, a label, a directory | This is how detection works. No convention means no reliable trigger. |

If your reference docs don't exist or are badly out of date, **build those
first.** This system amplifies doc quality in both directions: good docs
produce good test cases, and stale docs produce confidently wrong ones.

## What it is not

It does not write automated tests. It maintains a catalogue of *manual* test
cases that humans execute or later automate. It also never marks anything
approved — a human reviews every change in the store.

## The single most important design decision

**The agent does only what needs judgement: reading documentation, deciding
what a test case should assert, recognising that a change invalidates
existing coverage. Scripts do everything mechanical: finding PRs, labelling
them, posting notifications, building URLs, closing issues.**

Get this wrong and you will spend weeks on the failures it prevents. Every
bug a notification path has ever had, in systems like this, tends to come
from an agent interpreting instructions — a link pointing at the wrong item,
a duplicate posted an hour later, a message landing before the thing it
refers to. None of those are reachable from a shell step that runs once.

The rule generalises: **if a step has one correct output given its inputs,
it must not be the agent's job.**

### The three things the agent must never do

| Forbidden | Why |
|---|---|
| Send the notification | It is derived from the agent's own output; let a script derive it. |
| Label the PRs | The label is what stops a PR being retried. Applying it before validation marks work complete that nothing has checked. |
| Close the tracking issue | Same reasoning — closure is a claim that the cycle finished. |

All three happen **after** the agent's output has been validated, and only
if it passed. An agent that does one of these partway through its own audit,
then fails validation, can leave a PR permanently stranded — its labelling
step already moved the label, aging it past whatever retry window that label
was the only route back into a future run through.

### Tool access: a broker, not a raw token

Give the agent a **broker script**, not a raw credential — a thin wrapper
that holds the store token and accepts only the operations the job needs
(`scripts/lib/broker.mjs`). Two reasons:

1. The agent reads PR content written by people who may not be trusted, so
   handing it a broad token plus shell access is a privilege-escalation path.
2. Agent tool allowlists typically match on command prefix — an env-var
   prefix like `TOKEN=x some-command` no longer starts with an allowed word
   and gets denied, so the credential has to live inside the wrapper anyway.

Be honest in the wrapper's own comments about what it is: **a narrowing, not
a sandbox.** A broker that permits writes still reaches anything that
credential can see.

## The pipeline

Five phases. Steps 1–2 and 4–5 are plain scripts; only step 3 is the agent.

### 1. Detect — which PRs changed documented behaviour

A script queries merged PRs touching the docs path, in three passes:

| Pass | Window | Purpose |
|---|---|---|
| 1 | Last N hours | Fresh changes |
| 2 | 1–M days | Anything an earlier run missed |
| 3 | Any age, if still labelled queued | Stranded work from a failed cycle |

Pass 3 is what makes failure recoverable: a cycle that dies partway leaves
its PRs labelled, and they come back however old they get. **Exclude
anything labelled done, at every pass.**

No qualifying PRs means exit cleanly — no issue, no notification, no store
access. An idle night must not look like a failure.

### 2. Prepare

1. **Verify store access before writing anything.** Probe exactly the way
   the agent will; a preflight that tests a different call than the agent
   makes will pass while the agent fails. Abort here, before any mutation.
2. **Fetch the whole catalogue to a file**, one record per line so the agent
   can grep it. The agent must never paginate the store itself — that burns
   its context on retrieval instead of analysis.
3. **Label the PRs queued and open a tracking issue.**

### 3. Audit — the agent

The agent reads the PR's doc diff, then the **complete current docs** for
every affected feature — not just the diff. A one-line doc change can
invalidate a test case the diff never mentions.

It builds a coverage model (every surface, control and outcome a user can
reach), compares it against existing cases, and for each decides: create,
update, deprecate, or leave alone. It writes those changes to the store
through the broker, then writes **one JSON file** describing what it did.

**Status discipline matters.** The agent sets provisional states only —
never the approved state. Promotion is human-only. That single rule is what
makes the whole thing safe to run unattended.

### 4. Validate — before anything is published

This is where most of the engineering goes. See "The guards" below.

### 5. Publish — only if validation passed

Summary comment on the issue → notification → label PRs done → close the
issue. **If any validation step fails, none of this runs.** The issue stays
open, the PRs stay queued, and the next run retries them. A failure must
never be able to close a cycle.

## The summary contract

The agent writes **one** machine-readable file
(`agent/summary.schema.json`). The human summary and the notification are
both *generated* from it (`scripts/render-summary.mjs`), so they cannot
describe different runs.

### Three rules that are not negotiable

1. **Counts are never stated — only derived.** `"created": 3` beside a list
   of two items is exactly the inconsistency this shape removes. Generate
   the prose from the arrays and the two cannot disagree.
2. **Identity is strict; vocabulary is not.** The renderer accepts synonyms
   for presentation fields (`module` for `name`, `reason_for_updating` for
   `reason`) — failing a completed audit over a word is absurd. But an item
   id that does not resolve in the store must **fail the run**. A wrong word
   is recoverable; a link to a test case that does not exist tells the team
   work happened that cannot be found.
3. **A pass that changed nothing must say which kind of nothing.** Require
   `no_action_reason` whenever every action list is empty:

   | `kind` | Meaning | Effect |
   |---|---|---|
   | `nothing-needed` | Audited everything in scope; catalogue already correct | Cycle closes |
   | `blocked` | Something prevented writing — refused command, bad token | Issue stays open, PRs stay queued |
   | `incomplete` | Ran out of room before auditing everything | Issue stays open, PRs stay queued |

   Without this, "I audited and found nothing" is indistinguishable from "I
   was prevented from doing anything." Also enforce that `nothing-needed`
   requires non-empty `modules` *and* that every in-scope PR appears against
   some module — a single module with empty lists must not be able to close
   a cycle in which others were never examined.

## The guards

Every guard here exists because a system like this fails without it. The
failure they share a shape with is worth naming up front: **a run that
reports success while having done nothing, or something different from what
it says.** That is far more dangerous than a crash, because a crash gets
investigated.

### 1. Did the agent run at all?

Have the agent create a marker file as its literal first action, using a
tool it actually has (not a shell command that may not be in its
allowlist). If the marker is absent, the pass never executed — report that,
do **not** report "nothing to do."

### 2. Did the agent produce output at all?

An agent that ran and wrote nothing has not decided nothing. Require either
a summary or an explicit abort reason. Neither present = failure, issue
stays open.

### 3. Do the reported items actually exist?

Resolve every reported item id against the store before publishing.
Distinguish **"not found" from "could not check"** — a network failure must
not be reported as a missing item; both block publication, but they are
different claims. Retry transient failures, with a bounded total budget —
unbounded retries can exhaust the job timeout and kill a run whose store
work already succeeded, which is the failure the retry was meant to prevent.

### 4. Are factual claims grounded?

If the summary asserts a count, require a file, a line number (including for
documentation files), and a verbatim excerpt. Open the file and check. Quote
**one real line** — never reassemble a multi-line construct into a single
line, because that text exists nowhere and the citation must correctly fail.

### 5. Did the agent check its own work?

Give the agent a script that runs the same validators the workflow will, and
require it to run that script before finishing. This is the
highest-leverage guard, because it moves errors **inside the agent's turn**
where they can still be fixed.

**Enforce it, do not request it.** Have the script record a fingerprint of
what it validated, and have the later, independent validation step refuse to
continue without one that matches the final file. Be honest about the limit:
if the agent can write files, it can write the fingerprint too — this
catches *skipping*, which is the realistic failure. The validators
themselves remain the actual backstop, run again independently afterward.

## A pattern worth internalising

When reviewing a system built this way, the question is never "did it
pass?" It is **"what would this look like if it had failed?"** If the answer
is "the same," there is a guard missing.
