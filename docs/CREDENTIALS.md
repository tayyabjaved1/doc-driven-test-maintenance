# Credentials

Four distinct grants. Use **separate narrow tokens**, not one broad one.

| Purpose | Needs | Config key |
|---|---|---|
| Agent API access | An API key or OAuth token for the model | `credentials.anthropic_api_key_secret` |
| Test-case store | Read + write on the store only | `credentials.store_token_secret` |
| Repo operations | Read PRs, write issues and labels in the main repo | `credentials.repo_ops_token_secret` |
| Cross-repo reads | Read on any other repo whose docs you pull in | `credentials.cross_repo_token_secret` |

## Why separate

The agent reaches the store token through the broker while reading PR
content from authors who may not be trusted. Every additional scope on that
credential raises what the path is worth to anything that talks the agent
into misusing it. If your docs and your test-case store both live where a
single token *could* reach both, split the token anyway — the store token
should be unable to touch the repo, and the repo token should be unable to
touch the store.

## Traps worth knowing before you start

**The agent action may replace your token.** `claude-code-action` (and
similar GitHub-Action-based agent runners) exchange OIDC for their own
GitHub App token and export it as `GITHUB_TOKEN`/`GH_TOKEN`, overwriting
whatever the workflow set. That app token typically has no project/store
scope — so store queries return **empty rather than erroring**, which looks
like a finding, not a failure. A confident summary of many proposed test
cases with zero updates usually means "I could not see any of the existing
ones." This is exactly why the broker holds its **own** credential
(`STORE_TOKEN`, read directly from `process.env` inside
`scripts/lib/broker.mjs` and the adapter) rather than relying on whatever the
agent runner happens to export.

**Fine-grained PAT error wording tells you which problem you have.**
`Resource not accessible by personal access token` means the repo is listed
but the permission is missing. `Not Found` means the repo is not in the
token's list at all. `Bad credentials` means the token is invalid. These
need different fixes and the distinction saves hours.

**Permissions are per-scope.** A token that can dispatch workflows (Actions:
write) may not be able to read a file (Contents: read). Dispatch working is
not evidence that reads work — test the actual scope you need.

**Rate limits are per account, not per process.** Local verification scripts
and CI draw from the same budget. Unpaced queries against one account can
exhaust the secondary rate limit and break a live CI run as a side effect.
Page with a pause and a retry (`scripts/lib/gh.mjs` does this); batch
lookups into one query rather than one call per item wherever the store's
API supports it.

**Secrets cannot be read back.** Once set, a repo secret's value is
write-only forever. If you need to know what a token can do, test it with a
script that reads it from hidden input locally — never ask anyone to paste a
token into a chat, including to an AI agent.
