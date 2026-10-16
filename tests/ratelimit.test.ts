import { test } from 'node:test';
import assert from 'node:assert/strict';

/* ---------------------------------------------------------------------------
   These tests exercise the in-memory fallback, because no Upstash credentials
   are present in CI. That is the point: the fallback has to behave the same
   way the Redis path does, or local development tells you nothing useful
   about production.

   Note the module-level state — the limiter's counters live for the life of
   the process, so these tests run in one file and in order.
   --------------------------------------------------------------------------- */

import {
  checkRateLimit,
  rateLimitHeaders,
  peekGlobal,
  usingRedis,
  GLOBAL_LIMIT,
} from '../lib/ratelimit.ts';

test('the test environment has no Redis, so the fallback is what we are testing', () => {
  assert.equal(usingRedis, false);
});

test('a fresh window reports the full allowance', async () => {
  const peek = await peekGlobal();

  assert.equal(peek.limit, GLOBAL_LIMIT);
  assert.equal(peek.remaining, GLOBAL_LIMIT);
  assert.equal(peek.degraded, true);
});

test('peeking does not consume any of the allowance', async () => {
  await peekGlobal();
  await peekGlobal();
  await peekGlobal();

  const peek = await peekGlobal();
  assert.equal(peek.remaining, GLOBAL_LIMIT);
});

test(`exactly ${GLOBAL_LIMIT} requests are allowed, and the next is not`, async () => {
  for (let i = 1; i <= GLOBAL_LIMIT; i++) {
    const result = await checkRateLimit('visitor-a');
    assert.equal(result.success, true, `request ${i} should have been allowed`);
    assert.equal(result.remaining, GLOBAL_LIMIT - i);
  }

  const blocked = await checkRateLimit('visitor-a');

  assert.equal(blocked.success, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.scope, 'global');
});

test('the limit is global, so a different visitor is also blocked', async () => {
  // This is the trade-off made explicit. With PER_VISITOR_LIMIT set to null,
  // one heavy user exhausts the shared allowance for everybody. If this test
  // ever fails, someone has turned the per-visitor layer on — which is a
  // good change, but the pitch and the README need to say so.
  const other = await checkRateLimit('a-completely-different-visitor');
  assert.equal(other.success, false);
});

test('a blocked result carries a sane reset time', async () => {
  const blocked = await checkRateLimit('visitor-b');

  assert.equal(blocked.success, false);
  assert.ok(blocked.reset > Date.now(), 'reset should be in the future');
  assert.ok(
    blocked.reset <= Date.now() + 61_000,
    'reset should be within the window',
  );
});

test('headers follow the convention clients expect', async () => {
  const blocked = await checkRateLimit('visitor-c');
  const headers = rateLimitHeaders(blocked);

  assert.equal(headers['RateLimit-Limit'], String(GLOBAL_LIMIT));
  assert.equal(headers['RateLimit-Remaining'], '0');

  // Retry-After must be a positive whole number of seconds.
  const retryAfter = Number(headers['Retry-After']);
  assert.ok(Number.isInteger(retryAfter), 'Retry-After must be an integer');
  assert.ok(retryAfter >= 1, 'Retry-After must be at least 1 second');
  assert.ok(retryAfter <= 60, 'Retry-After must not exceed the window');
});

test('a successful result carries no Retry-After', () => {
  const headers = rateLimitHeaders({
    success: true,
    limit: 60,
    remaining: 42,
    reset: Date.now() + 30_000,
    scope: 'global',
    degraded: true,
  });

  assert.equal(headers['Retry-After'], undefined);
  assert.equal(headers['RateLimit-Remaining'], '42');
});

test('remaining never reports a negative number', () => {
  const headers = rateLimitHeaders({
    success: false,
    limit: 60,
    remaining: -5,
    reset: Date.now() + 1_000,
    scope: 'global',
    degraded: true,
  });

  assert.equal(headers['RateLimit-Remaining'], '0');
});
