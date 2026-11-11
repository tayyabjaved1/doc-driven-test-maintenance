import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The GitHub GraphQL API returns `data` ALONGSIDE `errors` on a partial
 * failure -- a page missing one field silently drops items if this isn't
 * checked. Exported as a pure function so it's independently testable
 * without mocking `gh` itself. */
export function assertNoGraphqlErrors(parsed) {
  if (parsed.errors && parsed.errors.length > 0) {
    throw new Error(`GraphQL response included errors: ${JSON.stringify(parsed.errors)}`);
  }
  return parsed;
}

/** Thin wrapper around `gh api graphql`, paced and bounded-retried against
 * GitHub's rate limits (per-account, not per-process -- see the sibling
 * test-case-maintenance tool's docs/CREDENTIALS.md). Deliberately duplicated
 * from that tool's scripts/lib/gh.mjs rather than imported across folders:
 * this tool is meant to be copied out on its own (see README.md), and a
 * cross-folder import would break that the moment someone does.
 * @param token the GH_TOKEN this call authenticates as (read-only; see docs/CREDENTIALS note in README)
 * @param query the GraphQL document
 * @param variables GraphQL variables object
 * @param retryBudgetMs total time this call may spend retrying transient failures
 */
export async function ghGraphql(token, query, variables = {}, retryBudgetMs = 120_000) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push('-F', `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`);
  }

  const deadline = Date.now() + retryBudgetMs;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const { stdout } = await execFileAsync('gh', args, {
        env: { ...process.env, GH_TOKEN: token },
        maxBuffer: 1024 * 1024 * 32,
      });
      return assertNoGraphqlErrors(JSON.parse(stdout));
    } catch (err) {
      const message = String(err.stderr || err.message || err);
      const transient = /rate limit|timeout|ECONNRESET|secondary rate limit|502|503/i.test(message);
      if (!transient || Date.now() >= deadline) {
        throw new Error(`gh api graphql failed (attempt ${attempt}): ${message}`);
      }
      const backoffMs = Math.min(2000 * attempt, 15_000);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}
