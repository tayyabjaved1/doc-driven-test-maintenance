import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayload } from '../notifier.mjs';

test('buildPayload: mentions are included only when the queue is non-empty', () => {
  const nonEmpty = buildPayload({ isEmpty: false }, 'digest text', '@qe-team');
  assert.match(nonEmpty.text, /^@qe-team /);

  const empty = buildPayload({ isEmpty: true }, 'all clear', '@qe-team');
  assert.equal(empty.text.includes('@qe-team'), false);
});
