import { test } from 'node:test';
import assert from 'node:assert/strict';

import nextConfig from '../next.config.mjs';

/* ---------------------------------------------------------------------------
   Permissions-Policy
   ---------------------------------------------------------------------------

   These exist because of a real bug that shipped.

   The header originally read `microphone=()`, which was correct when the
   app was typing-only. An empty allowlist means "no origin may use the
   microphone" — including our own. The browser then refuses getUserMedia
   WITHOUT showing a permission prompt, so the symptom is a mic button that
   does nothing and no dialog, which looks like broken JavaScript rather
   than a header.

   It cost an afternoon to find. These tests make the same mistake fail
   here instead.
   --------------------------------------------------------------------------- */

async function permissionsPolicy(): Promise<string> {
  const groups = await nextConfig.headers!();
  const header = groups
    .flatMap((g) => g.headers)
    .find((h) => h.key === 'Permissions-Policy');

  assert.ok(header, 'Permissions-Policy header should be set');
  return header.value;
}

test('the microphone is allowed for our own origin', async () => {
  const value = await permissionsPolicy();
  assert.match(
    value,
    /microphone=\(self\)/,
    'microphone must be allowed for self, or voice input silently fails',
  );
});

test('the microphone is NOT disabled by an empty allowlist', async () => {
  // The exact regression. `microphone=()` blocks our own origin.
  const value = await permissionsPolicy();
  assert.ok(
    !/microphone=\(\s*\)/.test(value),
    'microphone=() blocks getUserMedia on our own origin with no prompt',
  );
});

test('camera and geolocation stay switched off', async () => {
  // This tool has no business asking for either. If one ever gets enabled
  // it should be a deliberate change someone had to make a test fail for.
  const value = await permissionsPolicy();
  assert.match(value, /camera=\(\s*\)/, 'camera should be disabled');
  assert.match(value, /geolocation=\(\s*\)/, 'geolocation should be disabled');
});

test('the other security headers are still set', async () => {
  const groups = await nextConfig.headers!();
  const headers = Object.fromEntries(
    groups.flatMap((g) => g.headers).map((h) => [h.key, h.value]),
  );

  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
});
