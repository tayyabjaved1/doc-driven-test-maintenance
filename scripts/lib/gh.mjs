import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Thin wrapper around `gh api graphql`, paced and bounded-retried against
 * GitHub's rate limits -- which are per-account, not per-process: local runs
 * and CI share the same budget (see docs/CREDENTIALS.md). Never batches
 * calls into a tight loop; callers that need many records use `after`-based
 * pagination with a pause between pages, not one call per record.
 * @param token the GH_TOKEN this call authenticates as (store or repo-ops -- caller decides)
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
      return JSON.parse(stdout);
    } catch (err) {
      const message = String(err.stderr || err.message || err);
      const transient = /rate limit|timeout|ECONNRESET|secondary rate limit|502|503/i.test(message);
      if (!transient || Date.now() >= deadline) {
        // Surface which kind of problem this is -- see docs/CREDENTIALS.md's
        // "fine-grained PAT error wording" note. Callers match on this text.
        throw new Error(`gh api graphql failed (attempt ${attempt}): ${message}`);
      }
      const backoffMs = Math.min(2000 * attempt, 15_000);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}

/** Non-GraphQL `gh api` calls (REST), same pacing/retry contract as ghGraphql. */
export async function ghRest(token, args, retryBudgetMs = 120_000) {
  const deadline = Date.now() + retryBudgetMs;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      const { stdout } = await execFileAsync('gh', ['api', ...args], {
        env: { ...process.env, GH_TOKEN: token },
        maxBuffer: 1024 * 1024 * 32,
      });
      return stdout ? JSON.parse(stdout) : null;
    } catch (err) {
      const message = String(err.stderr || err.message || err);
      const transient = /rate limit|timeout|ECONNRESET|secondary rate limit|502|503/i.test(message);
      if (!transient || Date.now() >= deadline) {
        throw new Error(`gh api ${args[0]} failed (attempt ${attempt}): ${message}`);
      }
      const backoffMs = Math.min(2000 * attempt, 15_000);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
}
