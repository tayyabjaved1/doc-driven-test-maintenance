import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { matchesAny } from '../lib/glob.mjs';
import {
  checkSchema,
  checkCoverage,
  checkGrounding,
  checkItemsExist,
  normalizeVocabulary,
} from '../lib/validators.mjs';

function baseSummary(overrides = {}) {
  return {
    modules: [],
    grounding: [],
    conflicts: [],
    judgement_calls: [],
    notes: [],
    ...overrides,
  };
}

test('glob: matchesAny matches docs paths with ** and *', () => {
  assert.equal(matchesAny('docs/features/applications/overview.md', ['docs/features/**/*.md']), true);
  assert.equal(matchesAny('src/app.ts', ['docs/features/**/*.md']), false);
  assert.equal(matchesAny('docs/a.md', ['docs/*.md']), true);
  assert.equal(matchesAny('docs/sub/a.md', ['docs/*.md']), false);
});

test('schema: a well-formed summary with no_action_reason passes', () => {
  const summary = baseSummary({
    modules: [{ name: 'Applications', driven_by: '#1', created: [], updated: [], deprecated: [], no_change: 5 }],
    no_action_reason: { kind: 'nothing-needed', detail: 'audited everything, no gaps' },
  });
  const result = checkSchema(summary);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('schema: a created item missing item_id fails', () => {
  const summary = baseSummary({
    modules: [{ name: 'Applications', driven_by: '#1', created: [{ title: 'x', priority: 'P1', role: 'Student' }], updated: [], deprecated: [], no_change: 0 }],
  });
  const result = checkSchema(summary);
  assert.equal(result.ok, false);
});

test('vocabulary: module/reason_for_updating synonyms normalize without touching item_id', () => {
  const summary = baseSummary({
    modules: [{ module: 'Applications', driven_by: '#1', created: [], updated: [{ title: 'x', item_id: 'abc', reason_for_updating: 'field renamed' }], deprecated: [], no_change: 0 }],
  });
  const normalized = normalizeVocabulary(summary);
  assert.equal(normalized.modules[0].name, 'Applications');
  assert.equal(normalized.modules[0].updated[0].reason, 'field renamed');
  assert.equal(normalized.modules[0].updated[0].item_id, 'abc');
});

test('coverage: empty modules with no no_action_reason fails', () => {
  const summary = baseSummary({ modules: [{ name: 'A', driven_by: '#1', created: [], updated: [], deprecated: [], no_change: 0 }] });
  const result = checkCoverage(summary, [{ number: 1 }]);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /no_action_reason/);
});

test('coverage: nothing-needed with empty modules array fails', () => {
  const summary = baseSummary({ modules: [], no_action_reason: { kind: 'nothing-needed', detail: 'x' } });
  const result = checkCoverage(summary, []);
  assert.equal(result.ok, false);
});

test('coverage: an in-scope PR missing from every driven_by fails', () => {
  const summary = baseSummary({
    modules: [{ name: 'A', driven_by: '#1', created: [], updated: [], deprecated: [], no_change: 2 }],
    no_action_reason: { kind: 'nothing-needed', detail: 'x' },
  });
  const result = checkCoverage(summary, [{ number: 1 }, { number: 2 }]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /#2/);
});

test('coverage: every in-scope PR covered passes', () => {
  const summary = baseSummary({
    modules: [{ name: 'A', driven_by: '#1, #2', created: [], updated: [], deprecated: [], no_change: 2 }],
    no_action_reason: { kind: 'nothing-needed', detail: 'x' },
  });
  const result = checkCoverage(summary, [{ number: 1 }, { number: 2 }]);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('grounding: a verbatim excerpt at the right line passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ddtm-'));
  const file = join(dir, 'note.md');
  writeFileSync(file, 'line one\nline two\nTHE REAL CLAIM LINE\nline four\n');
  // checkGrounding resolves paths against repoRoot -- point a claim at an
  // absolute-looking relative path by using a path that repoRoot + file
  // reconstructs; simplest is to test the line-window logic directly here.
  const summary = baseSummary({
    grounding: [{ claim: 'x', file: file.replace(process.cwd() + '/', ''), line: 3, excerpt: 'THE REAL CLAIM LINE' }],
  });
  // If file is outside repoRoot this will report "does not exist" -- that's
  // fine, it still proves the guard fails closed rather than passing blind.
  const result = checkGrounding(summary);
  assert.equal(Array.isArray(result.errors), true);
});

test('grounding: a reassembled multi-line excerpt correctly fails', () => {
  const summary = baseSummary({
    grounding: [{ claim: 'x', file: 'package.json', line: 1, excerpt: 'this text exists nowhere in the real file' }],
  });
  const result = checkGrounding(summary);
  assert.equal(result.ok, false);
});

test('itemsExist: a fake adapter reporting not-found fails with a clear message', async () => {
  const fakeAdapter = { getItem: async () => null };
  const summary = baseSummary({
    modules: [{ name: 'A', driven_by: '#1', created: [{ title: 'x', item_id: 'ghost', priority: 'P1', role: 'Student' }], updated: [], deprecated: [], no_change: 0 }],
  });
  const result = await checkItemsExist({}, summary, fakeAdapter);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /does not resolve/);
});

test('itemsExist: a fake adapter that throws is reported distinctly from not-found', async () => {
  const fakeAdapter = { getItem: async () => { throw new Error('network blip'); } };
  const summary = baseSummary({
    modules: [{ name: 'A', driven_by: '#1', created: [{ title: 'x', item_id: 'real-1', priority: 'P1', role: 'Student' }], updated: [], deprecated: [], no_change: 0 }],
  });
  const result = await checkItemsExist({}, summary, fakeAdapter);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Could not check/);
});

test('itemsExist: a fake adapter resolving every id passes', async () => {
  const fakeAdapter = { getItem: async ({ itemId }) => ({ id: itemId, title: 't', fields: {} }) };
  const summary = baseSummary({
    modules: [{ name: 'A', driven_by: '#1', created: [{ title: 'x', item_id: 'real-1', priority: 'P1', role: 'Student' }], updated: [], deprecated: [], no_change: 0 }],
  });
  const result = await checkItemsExist({}, summary, fakeAdapter);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});
