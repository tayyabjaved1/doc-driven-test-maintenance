# <Project name> — test-case runbook

Copy this to `agent/RUNBOOK.md` and fill in every `<...>` placeholder before
Stage 3 of the porting checklist. This file owns *content*: what makes a
good test case here, and how this project's store works. `agent/PROCESS.md`
owns *process* and wins on anything that disagrees with it.

Audit the two files against each other before the first run, and again
whenever either changes — three of this design's real failures came from the
process file and this runbook silently disagreeing about something, each
time with the agent following whichever one told it to act.

## Where the documentation lives

`<docs path(s), matching config.yml's detection.docs_paths>`

## What "a module" means here

`<copy config.yml's module_definition, and give one or two real examples
from this repo, e.g. "the Applications module is docs/features/applications/">`

## What makes a good test case in this project

Replace this whole section with your own standard. A starting shape:

- **Title**: `<convention, e.g. "<Role> can <action> when <condition>">`
- **Priority**: `<your scale, e.g. P0/P1/P2, and what decides which>`
- **Role**: `<the roles/personas your product has>`
- **Steps**: `<numbered, one user action per step, or however your store
  expects them>`
- **Expected result**: `<what "pass" means for this case — be specific about
  observable outcomes, not implementation>`

## Store fields and statuses

| Field | Meaning | Values |
|---|---|---|
| Status | `<how your store's status field maps to the states below>` | Draft, Updated (Under Review), Deprecated (Under Review), Approved (human-only, never set by this pipeline) |
| Priority | `<your project's priority scale>` | `<e.g. P0, P1, P2>` |
| Role | `<your project's roles>` | `<list them>` |
| Module | `<how this maps to "what a module means here", above>` | — |

`config.yml`'s `store.<adapter>.fields`/`.statuses` sections must match this
table exactly, by name — see PORTING.md Stage 1.

## Writing the summary — worked example

One `summary.json` per run, matching `agent/summary.schema.json`. A minimal
real example for this project:

```json
{
  "modules": [
    {
      "name": "<a real module name from this project>",
      "driven_by": "#<a real PR number>",
      "created": [
        { "title": "<...>", "item_id": "<the id the broker's create returned>", "priority": "<...>", "role": "<...>" }
      ],
      "updated": [],
      "deprecated": [],
      "no_change": 0
    }
  ],
  "grounding": [
    { "claim": "<a factual claim your summary makes>", "file": "<path>", "line": 1, "excerpt": "<the real line at that number>" }
  ],
  "conflicts": [],
  "judgement_calls": [],
  "notes": []
}
```

See `agent/PROCESS.md` §4 for the three rules this must satisfy (counts
derived not stated, strict ids, `no_action_reason` when every module is
empty) — they are enforced by `scripts/lib/validators.mjs`, not just
requested here.

## Known quirks worth recording

Add project-specific traps here as you hit them — a field that silently
accepts the wrong type, a status transition the UI allows but the API
rejects, a store rate limit tighter than GitHub's. State the *reason*, not
just the rule: "do not set Status directly to Approved" is easy to miss;
"Approved means a human reviewed it, and that is the one guarantee this
whole pipeline depends on" is harder to.
