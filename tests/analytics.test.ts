import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  TRACKED_EVENTS,
  isTrackedEvent,
  languageField,
  reachedField,
  statsKey,
} from '../lib/analytics.ts';

/* --- The closed vocabulary ------------------------------------------------
   This is the control that makes leaking answer content impossible rather
   than merely discouraged. If these tests are ever loosened, the privacy
   claim in the README stops being true.
   ------------------------------------------------------------------------ */

test('only known events are accepted', () => {
  for (const event of TRACKED_EVENTS) {
    assert.ok(isTrackedEvent(event), `${event} should be accepted`);
  }
});

test('an arbitrary string is never treated as an event', () => {
  // The attack this prevents: smuggling an answer through as an event name.
  const attempts = [
    'There is black mould on the bedroom wall',
    '07700 900123',
    'form_started; DROP TABLE',
    '',
    'FORM_STARTED',
    null,
    undefined,
    42,
    { event: 'form_started' },
  ];

  for (const attempt of attempts) {
    assert.ok(
      !isTrackedEvent(attempt),
      `should reject: ${JSON.stringify(attempt)}`,
    );
  }
});

/* --- Language codes -------------------------------------------------------
   The only model-produced string that reaches storage, so it gets a strict
   pattern rather than trust.
   ------------------------------------------------------------------------ */

test('real language codes are accepted', () => {
  assert.equal(languageField('ur'), 'lang:ur');
  assert.equal(languageField('en'), 'lang:en');
  assert.equal(languageField('pt-BR'), 'lang:pt-br');
  assert.equal(languageField('  PL  '), 'lang:pl');
});

test('anything that is not a language code is rejected', () => {
  // If the model ever returned a sentence in this field, it must not be
  // stored. This is the backstop.
  const attempts = [
    'There is black mould on the bedroom wall',
    'Urdu, spoken by the resident',
    '',
    'a',
    'averylonglanguagename',
    '../../etc/passwd',
    'en; DROP',
    '<script>',
  ];

  for (const attempt of attempts) {
    assert.equal(
      languageField(attempt),
      null,
      `should reject: ${JSON.stringify(attempt)}`,
    );
  }
});

/* --- Keys ----------------------------------------------------------------- */

test('question fields record an index, never text', () => {
  assert.equal(reachedField(0), 'reached:0');
  assert.equal(reachedField(7), 'reached:7');
});

test('stats keys are namespaced per form', () => {
  assert.equal(statsKey('housing-repair'), 'fbgm:stats:housing-repair');
  assert.notEqual(statsKey('housing-repair'), statsKey('council-tax-reduction'));
});

/* --- The structural guarantee --------------------------------------------
   These read the source rather than calling it. The point is to make a
   future change that starts sending answer content fail CI rather than
   ship quietly.
   ------------------------------------------------------------------------ */

/** Strip comments, so prose about the design is not mistaken for code. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('the client tracker has no free-text parameter', () => {
  const source = codeOnly(
    readFileSync(new URL('../app/form/[id]/track.ts', import.meta.url), 'utf8'),
  );

  // The options object must expose exactly these two fields.
  assert.match(source, /questionIndex\?: number/);
  assert.match(source, /languageCode\?: string/);

  // No declared field that could carry content.
  for (const forbidden of ['answer', 'value', 'text', 'transcript', 'original']) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\??\\s*:`, 'i').test(source),
      `track.ts must not accept a "${forbidden}" field`,
    );
  }
});

test('the events endpoint reads no field that could carry content', () => {
  const source = readFileSync(
    new URL('../app/api/events/route.ts', import.meta.url),
    'utf8',
  );

  // Exactly four fields are destructured from the body.
  const match = source.match(
    /const \{([^}]+)\} = \(body \?\? \{\}\) as/,
  );
  assert.ok(match, 'expected a single destructuring of the request body');

  const fields = match[1]
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .sort();

  assert.deepEqual(fields, [
    'event',
    'formId',
    'languageCode',
    'questionIndex',
  ]);
});

test('every event the client can send is in the server vocabulary', () => {
  // A typo in a track() call would silently produce no data. This catches it.
  const source = readFileSync(
    new URL('../app/form/[id]/FormRunner.tsx', import.meta.url),
    'utf8',
  );

  const used = [...source.matchAll(/track\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(used.length > 0, 'expected FormRunner to send events');

  for (const event of used) {
    assert.ok(
      (TRACKED_EVENTS as readonly string[]).includes(event),
      `FormRunner sends "${event}", which is not in TRACKED_EVENTS`,
    );
  }
});
