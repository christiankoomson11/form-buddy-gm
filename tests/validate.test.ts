import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateAnswer,
  validateForm,
  hasErrors,
  looksLikePostcode,
} from '../lib/validate.ts';
import { housingRepair } from '../lib/forms/housing-repair.ts';
import { visibleQuestions } from '../lib/forms/visibility.ts';
import type { Question } from '../lib/forms/types.ts';

/* --- Required ------------------------------------------------------------- */

test('a required question left blank is a blocking error', () => {
  const q = housingRepair.questions.find((x) => x.id === 'address')!;
  const issues = validateAnswer(q, '');

  assert.equal(issues.length, 1);
  assert.equal(issues[0].severity, 'error');
  assert.ok(hasErrors(issues));
});

test('an optional question left blank raises nothing', () => {
  const q = housingRepair.questions.find((x) => x.id === 'started')!;
  assert.deepEqual(validateAnswer(q, ''), []);
  assert.deepEqual(validateAnswer(q, undefined), []);
});

/* --- Postcodes ------------------------------------------------------------ */

test('postcode detection accepts real-world formats', () => {
  for (const good of [
    '14 Example Road, Manchester, M1 1AA',
    'Flat 2, Oldham OL1 1XX',
    'no space here m32 0rt',
    'Wigan, WN7 4JY',
  ]) {
    assert.ok(looksLikePostcode(good), `should find a postcode in: ${good}`);
  }
});

test('postcode detection does not invent one', () => {
  for (const bad of ['14 Example Road', 'Manchester', '']) {
    assert.ok(!looksLikePostcode(bad), `should find no postcode in: ${bad}`);
  }
});

test('a missing postcode is a WARNING, never a block', () => {
  // This is a deliberate product decision, not an accident: some residents
  // do not know their postcode, and blocking them is the locked door the
  // whole tool exists to remove. If this test ever flips to 'error',
  // someone has changed that decision.
  const q = housingRepair.questions.find((x) => x.id === 'address')!;
  const issues = validateAnswer(q, '14 Example Road, Manchester');

  assert.ok(issues.length > 0);
  assert.ok(issues.every((i) => i.severity === 'warning'));
  assert.ok(!hasErrors(issues));
});

test('a complete address with a postcode passes clean', () => {
  const q = housingRepair.questions.find((x) => x.id === 'address')!;
  assert.deepEqual(validateAnswer(q, 'Flat 2, 14 Example Road, Manchester, M1 1AA'), []);
});

/* --- Lengths -------------------------------------------------------------- */

test('minLength blocks a too-short answer', () => {
  const q = housingRepair.questions.find((x) => x.id === 'problem_detail')!;
  const issues = validateAnswer(q, 'broken');

  assert.ok(hasErrors(issues));
});

test('minLength passes once there is enough detail', () => {
  const q = housingRepair.questions.find((x) => x.id === 'problem_detail')!;
  const issues = validateAnswer(
    q,
    'There is black mould on the bedroom wall behind the wardrobe.',
  );

  assert.deepEqual(issues, []);
});

/* --- Dates ---------------------------------------------------------------- */

test('a date in the future is caught', () => {
  const q = housingRepair.questions.find((x) => x.id === 'started')!;
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);

  const issues = validateAnswer(q, nextYear.toISOString().slice(0, 10));
  assert.ok(hasErrors(issues));
});

test("today's date is not treated as the future", () => {
  // Guards against a timezone bug: the user is in Europe/London, the server
  // runs in UTC, and a naive comparison rejects "today" for part of the year.
  const q = housingRepair.questions.find((x) => x.id === 'started')!;
  const today = new Date().toISOString().slice(0, 10);

  assert.deepEqual(validateAnswer(q, today), []);
});

test('a past date passes', () => {
  const q = housingRepair.questions.find((x) => x.id === 'started')!;
  assert.deepEqual(validateAnswer(q, '2025-03-14'), []);
});

/* --- Choices -------------------------------------------------------------- */

test('a choice outside the offered options is rejected', () => {
  const q = housingRepair.questions.find((x) => x.id === 'tenure')!;
  const issues = validateAnswer(q, 'something-we-never-offered');

  assert.ok(hasErrors(issues));
});

test('a valid choice passes', () => {
  const q = housingRepair.questions.find((x) => x.id === 'tenure')!;
  assert.deepEqual(validateAnswer(q, 'council'), []);
});

/* --- Conditional questions ------------------------------------------------ */

test('a follow-up question is hidden until its trigger is chosen', () => {
  const withoutTrigger = visibleQuestions(housingRepair, { safety: 'no' });
  const ids = withoutTrigger.map((q: Question) => q.id);

  assert.ok(!ids.includes('safety_detail'));
});

test('a follow-up question appears when its trigger is chosen', () => {
  const withTrigger = visibleQuestions(housingRepair, { safety: 'yes-health' });
  const ids = withTrigger.map((q: Question) => q.id);

  assert.ok(ids.includes('safety_detail'));
});

/* --- Whole form ----------------------------------------------------------- */

test('a form with every required answer filled has no blocking errors', () => {
  const answers: Record<string, string> = {
    tenure: 'council',
    address: 'Flat 2, 14 Example Road, Manchester, M1 1AA',
    problem_type: 'damp',
    problem_detail:
      'Black mould on the bedroom wall behind the wardrobe, getting worse since October.',
    safety: 'no',
    contact: '07700 900123',
  };

  const applicable = visibleQuestions(housingRepair, answers);
  const issues = validateForm(housingRepair, answers, applicable);

  assert.ok(!hasErrors(issues), `unexpected errors: ${JSON.stringify(issues)}`);
});

test('a consistency check fires as a warning, not a block', () => {
  const answers: Record<string, string> = {
    tenure: 'council',
    address: 'Flat 2, 14 Example Road, Manchester, M1 1AA',
    problem_type: 'electrics',
    problem_detail: 'Exposed wires hanging out of the socket in the hallway.',
    safety: 'yes-danger',
    contact: '07700 900123',
    access: 'weekday-any',
  };

  const applicable = visibleQuestions(housingRepair, answers);
  const issues = validateForm(housingRepair, answers, applicable);

  const warning = issues.find((i) => i.severity === 'warning');
  assert.ok(warning, 'expected the danger check to fire');
  assert.ok(!hasErrors(issues), 'a consistency check must never block');
  assert.match(warning!.message, /0800 111 999/);
});
