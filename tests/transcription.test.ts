import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseAudioType,
  transcriptionPrompt,
  TRANSCRIPTION_SCHEMA,
  MAX_AUDIO_BYTES,
  MAX_RECORDING_SECONDS,
} from '../lib/transcription.ts';
import { housingRepair } from '../lib/forms/housing-repair.ts';

/* --- MIME handling --------------------------------------------------------
   Browsers disagree about what they record. Chrome and Firefox give
   webm/opus, Safari gives mp4, and all of them append codec parameters.
   Getting this wrong means voice silently fails on one browser only, which
   is the kind of bug that survives a demo and breaks in the field.
   ------------------------------------------------------------------------ */

test('codec parameters are stripped from the MIME type', () => {
  assert.equal(normaliseAudioType('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(normaliseAudioType('audio/ogg; codecs=opus'), 'audio/ogg');
});

test('each browser default is accepted', () => {
  // Chrome / Edge / Firefox
  assert.equal(normaliseAudioType('audio/webm;codecs=opus'), 'audio/webm');
  // Safari
  assert.equal(normaliseAudioType('audio/mp4'), 'audio/mp4');
  // Safari sometimes labels it this way
  assert.equal(normaliseAudioType('audio/x-m4a'), 'audio/m4a');
});

test('case and whitespace do not matter', () => {
  assert.equal(normaliseAudioType('  AUDIO/WEBM ;codecs=opus'), 'audio/webm');
});

test('anything we cannot send to the model is rejected', () => {
  for (const bad of ['video/mp4', 'application/octet-stream', 'text/plain', '']) {
    assert.equal(normaliseAudioType(bad), null, `should reject: ${bad}`);
  }
});

/* --- Limits --------------------------------------------------------------- */

test('the size ceiling stays under the model request limit', () => {
  // Gemini caps a whole request at 20MB including the prompt. Base64
  // encoding inflates bytes by about a third, so the raw ceiling must leave
  // room: 8MB becomes roughly 10.7MB encoded.
  const encodedSize = MAX_AUDIO_BYTES * (4 / 3);
  assert.ok(
    encodedSize < 20 * 1024 * 1024,
    `encoded payload ${Math.round(encodedSize / 1024 / 1024)}MB must stay under 20MB`,
  );
});

test('the recording ceiling is long enough to be useful but bounded', () => {
  assert.ok(MAX_RECORDING_SECONDS >= 30, 'too short to answer a real question');
  assert.ok(MAX_RECORDING_SECONDS <= 300, 'unbounded recordings are a cost bug');
});

/* --- Schema --------------------------------------------------------------- */

test('the schema requires every field the UI reads', () => {
  // If a field stops being required the model may omit it, and the UI would
  // put "undefined" into someone's form.
  for (const field of [
    'original',
    'languageName',
    'languageCode',
    'english',
    'heardSpeech',
  ]) {
    assert.ok(
      TRANSCRIPTION_SCHEMA.required.includes(field as never),
      `${field} must be required`,
    );
    assert.ok(
      field in TRANSCRIPTION_SCHEMA.properties,
      `${field} must be declared`,
    );
  }
});

/* --- Prompt --------------------------------------------------------------- */

test('the prompt carries the question, so homophones resolve correctly', () => {
  const question = housingRepair.questions.find((q) => q.id === 'address')!;
  const prompt = transcriptionPrompt({
    formTitle: housingRepair.title,
    questionLabel: question.label,
    questionHelp: question.help,
  });

  assert.match(prompt, /Report a repair in your rented home/);
  assert.match(prompt, /What is the address of the home/);
});

test('the prompt forbids the model answering or tidying', () => {
  // These instructions are the difference between a transcription tool and
  // a tool that quietly rewrites people's benefit applications.
  const prompt = transcriptionPrompt({
    formTitle: 'A form',
    questionLabel: 'A question',
  });

  assert.match(prompt, /Never answer the question yourself/i);
  assert.match(prompt, /Do not correct their grammar/i);
  assert.match(prompt, /\[unclear\]/);
  assert.match(prompt, /Never add, complete, tidy or infer/i);
});

test('the prompt handles optional help text being absent', () => {
  const prompt = transcriptionPrompt({
    formTitle: 'A form',
    questionLabel: 'A question',
  });

  assert.ok(!prompt.includes('undefined'), 'must not leak undefined into the prompt');
});
