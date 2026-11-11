import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertNoGraphqlErrors } from '../lib/gh.mjs';

test('assertNoGraphqlErrors: a clean response passes through unchanged', () => {
  const response = { data: { foo: 'bar' } };
  assert.deepEqual(assertNoGraphqlErrors(response), response);
});

test('assertNoGraphqlErrors: throws even when data is ALSO present (the documented partial-response bug)', () => {
  const response = { data: { items: [{ id: 1 }] }, errors: [{ message: 'field X could not be resolved' }] };
  assert.throws(() => assertNoGraphqlErrors(response), /GraphQL response included errors/);
});

test('assertNoGraphqlErrors: an empty errors array is not treated as a failure', () => {
  const response = { data: { ok: true }, errors: [] };
  assert.doesNotThrow(() => assertNoGraphqlErrors(response));
});
