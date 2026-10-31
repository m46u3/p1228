import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTokens, positiveInt } from '../../src/p1228/core/config.js';

test('parseTokens prefers unique comma/newline-separated values', () => {
  process.env.TEST_MULTI = ' alpha, beta\nalpha ';
  process.env.TEST_SINGLE = 'fallback';
  assert.deepEqual(parseTokens('TEST_MULTI', 'TEST_SINGLE'), ['alpha', 'beta']);
});

test('parseTokens falls back to the single token', () => {
  process.env.TEST_MULTI = ' ';
  process.env.TEST_SINGLE = 'one-token';
  assert.deepEqual(parseTokens('TEST_MULTI', 'TEST_SINGLE'), ['one-token']);
});

test('positiveInt accepts non-negative values when minimum is zero', () => {
  process.env.TEST_INT = '0';
  assert.equal(positiveInt('TEST_INT', 10, { minimum: 0 }), 0);
  process.env.TEST_INT = '-1';
  assert.throws(() => positiveInt('TEST_INT', 10, { minimum: 0 }));
});
