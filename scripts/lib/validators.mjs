import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { repoRoot } from './config.mjs';
import { markerPath } from './marker.mjs';
import { loadAdapter } from './store.mjs';

const schema = JSON.parse(readFileSync(join(repoRoot, 'agent', 'summary.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(schema);

/** Every guard below exists because the real system failed without it
 * (see docs/ARCHITECTURE.md's "The guards"). Each returns { ok, errors }.
 * self-check.mjs and validate-summary.mjs both call these -- never restate
 * the rule in only one place. */

export function checkRanMarker() {
  const ok = existsSync(markerPath());
  return { ok, errors: ok ? [] : [`Ran-marker missing at ${markerPath()} -- the agent pass may never have executed. Do not report "nothing to do" for this.`] };
}

export function checkOutputExists(summary) {
  const ok = summary != null && typeof summary === 'object';
  return { ok, errors: ok ? [] : ['No summary produced -- an agent that ran and wrote nothing has not decided nothing.'] };
}

export function checkSchema(summary) {
  const ok = validateSchema(summary);
  const errors = ok ? [] : validateSchema.errors.map((e) => `${e.instancePath || '(root)'} ${e.message}`);
  return { ok, errors };
}

/** Normalizes the documented vocabulary synonyms -- identity (item_id) is
 * strict and never normalized; presentation fields are not. */
export function normalizeVocabulary(summary) {
  const clone = structuredClone(summary);
  for (const mod of clone.modules ?? []) {
    if (mod.module && !mod.name) mod.name = mod.module;
    for (const item of mod.updated ?? []) {
      if (item.reason_for_updating && !item.reason) item.reason = item.reason_for_updating;
    }
    for (const item of mod.deprecated ?? []) {
      if (item.reason_for_updating && !item.reason) item.reason = item.reason_for_updating;
    }
  }
  return clone;
}

/** Guard: a pass that changed nothing must say which kind of nothing, and a
 * single examined module must not be able to close a cycle in which others
 * were never looked at. */
export function checkCoverage(summary, inScopePRs) {
  const errors = [];
  const modules = summary.modules ?? [];
  const allEmpty = modules.every((m) => (m.created?.length ?? 0) === 0 && (m.updated?.length ?? 0) === 0 && (m.deprecated?.length ?? 0) === 0);

  if (allEmpty) {
    if (!summary.no_action_reason) {
      errors.push('Every module has empty action lists but no_action_reason is missing -- "audited and found nothing" is indistinguishable from "was prevented from doing anything" without it.');
    } else if (modules.length === 0) {
      errors.push('no_action_reason is present but modules is empty -- nothing-needed requires non-empty modules, not just the reason.');
    }
  }

  const coveredPRs = new Set(
    modules.flatMap((m) => String(m.driven_by ?? '').match(/#\d+/g) ?? []).map((s) => s.replace('#', ''))
  );
  for (const pr of inScopePRs ?? []) {
    if (!coveredPRs.has(String(pr.number))) {
      errors.push(`PR #${pr.number} is in scope but appears in no module's driven_by -- it was never examined.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Guard: every reported item id must resolve in the store before
 * publishing. Distinguishes "not found" from "could not check" -- a network
 * failure must never be reported as a missing item (adapter.getItem()
 * returns null only for a genuine not-found; anything else throws). */
export async function checkItemsExist(config, summary, adapterOverride) {
  const adapter = adapterOverride ?? (await loadAdapter(config));
  const errors = [];
  const ids = (summary.modules ?? []).flatMap((m) => [
    ...(m.created ?? []).map((i) => i.item_id),
    ...(m.updated ?? []).map((i) => i.item_id),
    ...(m.deprecated ?? []).map((i) => i.item_id),
  ]);
  for (const id of ids) {
    try {
      const item = await adapter.getItem(config, { itemId: id });
      if (!item) errors.push(`Item ${id} does not resolve in the store.`);
    } catch (err) {
      errors.push(`Could not check item ${id}: ${err.message} (treated as blocking, not as "not found")`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Guard: every factual/numeric claim must cite a file, a line number
 * (documentation files included), and one real verbatim line -- never a
 * multi-line construct reassembled onto one line, since that text exists
 * nowhere and must correctly fail this check. */
export function checkGrounding(summary) {
  const errors = [];
  for (const g of summary.grounding ?? []) {
    const filePath = join(repoRoot, g.file);
    if (!existsSync(filePath)) {
      errors.push(`Grounding for "${g.claim}" cites ${g.file}, which does not exist.`);
      continue;
    }
    const lines = readFileSync(filePath, 'utf8').split('\n');
    const windowStart = Math.max(0, g.line - 2);
    const windowEnd = Math.min(lines.length, g.line + 1);
    const nearby = lines.slice(windowStart, windowEnd).join('\n');
    if (!nearby.includes(g.excerpt.trim())) {
      errors.push(`Grounding for "${g.claim}" cites ${g.file}:${g.line} but that excerpt was not found there verbatim.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Runs every guard in order, short-circuiting is deliberately NOT done --
 * report every problem found, not just the first, so a human fixing this
 * sees the whole picture in one pass. */
export async function runAllValidators(config, summary, { inScopePRs } = {}) {
  const results = {
    ranMarker: checkRanMarker(),
    outputExists: checkOutputExists(summary),
  };
  if (!results.outputExists.ok) {
    return { ok: false, results };
  }
  const normalized = normalizeVocabulary(summary);
  results.schema = checkSchema(normalized);
  results.coverage = checkCoverage(normalized, inScopePRs);
  results.grounding = checkGrounding(normalized);
  results.itemsExist = await checkItemsExist(config, normalized);

  const ok = Object.values(results).every((r) => r.ok);
  return { ok, results, normalized };
}
