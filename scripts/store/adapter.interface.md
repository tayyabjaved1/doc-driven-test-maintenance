# Store adapter interface

A store adapter is a plain ES module exporting these four async functions.
`scripts/store/github-projects.adapter.mjs` is the reference implementation --
read it alongside this file. To add a new store (Jira, TestRail, ...), copy
its shape, not its GitHub-specific internals.

```ts
// All four receive `config` (the parsed config.yml) and read their own
// credential from process.env themselves -- never accept a token as a
// parameter, so it can never end up in a log line or an agent-visible argument.

preflight(config): Promise<void>
// Probes store access with EXACTLY the call create()/update() will make --
// not a cheaper proxy (e.g. "can I list projects" is not evidence "can I
// create an item"). Throws on failure. See docs/ARCHITECTURE.md's "verify
// store access before writing anything."

listAll(config): Promise<Array<{ id: string, title: string, fields: Record<string, string> }>>
// Returns every item in the store, in one pass, as plain objects -- the
// caller (fetch-catalogue.mjs) writes them one-per-line to a file. An
// adapter MUST paginate internally; the agent must never see pagination.

createItem(config, { title, body, fields }): Promise<{ id: string }>
// fields is a flat map of configured field name -> value (e.g.
// { status: "Draft", priority: "P1", role: "Student", module: "Applications" }).
// The adapter resolves each configured field name to the store's actual
// field/option identifiers; the caller never sees them.

getItem(config, { itemId }): Promise<{ id: string, title: string, fields: Record<string, string> } | null>
// Returns null (never throws) when itemId does not resolve -- this is the
// one function allowed to treat "not found" as a normal result, since it is
// exactly what the existence-resolution guard calls to tell "not found"
// apart from "could not check" (a thrown error there IS "could not check").

updateItemFields(config, { itemId, fields }): Promise<void>
// Same `fields` shape as createItem, partial updates allowed. Must throw a
// distinguishable error for "itemId does not exist" vs. any other failure --
// validate-summary.mjs's existence-resolution guard depends on being able to
// tell "not found" apart from "could not check" (see docs/ARCHITECTURE.md).
```

## The broker is not the adapter

`scripts/lib/broker.mjs` is a separate, narrower layer in front of the
adapter: it is what the AGENT calls (via an explicit CLI with exactly three
verbs: `create`, `update`, `get` -- see its own file), never the adapter
directly and never a raw API client. The non-agent scripts (`detect-prs.mjs`,
`fetch-catalogue.mjs`, `validate-summary.mjs`, `publish.mjs`) call the
adapter's functions directly -- they are deterministic code, not an LLM
reading untrusted PR content, so they don't need the broker's narrowing.
