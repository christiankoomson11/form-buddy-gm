'use client';

/* ---------------------------------------------------------------------------
   The form runner — voice first
   ---------------------------------------------------------------------------

   One question on screen at a time, answered by speaking.

   Two decisions worth explaining:

   1. VOICE IS PRIMARY, TYPING IS ALWAYS THERE. A voice-only form would be a
      new locked door: it would exclude people who cannot speak, are deaf,
      are somewhere public or noisy, or whose microphone does not work. The
      keyboard never goes away.

   2. THE SPOKEN WORDS ARE KEPT. When someone answers in Urdu we put the
      English in the field so the council can read it, and keep their own
      words alongside it, shown here and carried onto the printed summary.
      Throwing away what they actually said would mean the council only ever
      sees a machine's version of them.
   --------------------------------------------------------------------------- */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import type { FormDefinition, Question } from '@/lib/forms/types';
import { visibleQuestions, type Answers } from '@/lib/forms';
import { validateAnswer, validateForm, hasErrors, type Issue } from '@/lib/validate';
import { MAX_RECORDING_SECONDS } from '@/lib/transcription';
import { useRecorder } from './useRecorder';
import { track } from './track';

type Stage = 'intro' | 'questions' | 'summary';

/** What someone actually said, when it was not English. */
type SpokenOriginal = {
  original: string;
  languageName: string;
  languageCode: string;
};

type Spoken = Record<string, SpokenOriginal>;

/* --- Persistence ----------------------------------------------------------
   sessionStorage, not localStorage: wiped when the tab closes, which matches
   what we promise, and a mis-tap on refresh does not destroy ten minutes of
   work. Every access is wrapped — in a private window these throw, and the
   form has to work anyway.
   ------------------------------------------------------------------------ */

const key = (formId: string, what: string) => `fbgm:${what}:${formId}`;

function load<T>(formId: string, what: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key(formId, what));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(formId: string, what: string, value: unknown) {
  try {
    sessionStorage.setItem(key(formId, what), JSON.stringify(value));
  } catch {
    /* no storage — the form still works, it just will not survive a refresh */
  }
}

function wipe(formId: string) {
  try {
    sessionStorage.removeItem(key(formId, 'answers'));
    sessionStorage.removeItem(key(formId, 'spoken'));
  } catch {
    /* nothing to do */
  }
}

export default function FormRunner({ form }: { form: FormDefinition }) {
  const [stage, setStage] = useState<Stage>('intro');
  const [answers, setAnswers] = useState<Answers>({});
  const [spoken, setSpoken] = useState<Spoken>({});
  const [index, setIndex] = useState(0);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [showWhy, setShowWhy] = useState(false);
  const [restored, setRestored] = useState(false);

  /*
   * Question ids whose warnings have been seen. A warning must stop someone
   * ONCE — otherwise it scrolls past unread and only resurfaces on the
   * summary, by which point they have forgotten the answer. The second press
   * goes through, because they know their circumstances better than our
   * rules do.
   */
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());

  const headingRef = useRef<HTMLDivElement>(null);
  const recorder = useRecorder(form.id);

  /* --- Restore ----------------------------------------------------------- */

  useEffect(() => {
    const savedAnswers = load<Answers>(form.id, 'answers', {});
    const savedSpoken = load<Spoken>(form.id, 'spoken', {});
    if (Object.keys(savedAnswers).length > 0) {
      setAnswers(savedAnswers);
      setSpoken(savedSpoken);
      setRestored(true);
    }
  }, [form.id]);

  useEffect(() => {
    if (Object.keys(answers).length > 0) save(form.id, 'answers', answers);
  }, [answers, form.id]);

  useEffect(() => {
    if (Object.keys(spoken).length > 0) save(form.id, 'spoken', spoken);
  }, [spoken, form.id]);

  /* --- Which questions apply --------------------------------------------- */

  const applicable = useMemo(() => visibleQuestions(form, answers), [form, answers]);
  const question: Question | undefined = applicable[index];
  const total = applicable.length;

  /* --- Focus on navigation ----------------------------------------------
     Without this a screen reader user hears nothing after pressing Next:
     the heading changed but focus did not move, so nothing is announced.
     -------------------------------------------------------------------- */

  useEffect(() => {
    if (stage === 'questions' && headingRef.current) headingRef.current.focus();
  }, [index, stage]);

  const setAnswer = useCallback((id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setIssues((prev) => prev.filter((i) => i.questionId !== id));
    // A different answer re-arms the warning.
    setAcknowledged((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  /** Typing over a spoken answer drops the stored original — it is no longer
   *  a translation of what is in the box. */
  const typeAnswer = useCallback(
    (id: string, value: string) => {
      setAnswer(id, value);
      setSpoken((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [setAnswer],
  );

  /* --- Voice ------------------------------------------------------------- */

  const handleStop = useCallback(async () => {
    if (!question) return;

    const result = await recorder.stopAndTranscribe(question.id);

    if (!result) {
      /*
       * Distinguish "no microphone access" from "transcription broke".
       * They need different fixes: one is a browser permission problem we
       * might solve with better wording, the other is us.
       */
      const denied = /permission|microphone|cannot record/i.test(
        recorder.error ?? '',
      );
      track(denied ? 'voice_denied' : 'voice_failed', form.id, {
        questionIndex: index,
      });
      return;
    }

    track('voice_succeeded', form.id, { questionIndex: index });

    if (!result.isEnglish) {
      track('voice_translated', form.id, { languageCode: result.languageCode });
    }

    /*
     * Append rather than replace. Someone correcting themselves records a
     * second time, and losing the first half would be infuriating.
     */
    const existing = (answers[question.id] ?? '').trim();
    const addition = result.english.trim();
    const combined = existing ? `${existing} ${addition}` : addition;

    setAnswer(question.id, combined);

    if (!result.isEnglish && result.original.trim()) {
      setSpoken((prev) => {
        const previous = prev[question.id];
        return {
          ...prev,
          [question.id]: {
            original: previous
              ? `${previous.original} ${result.original.trim()}`
              : result.original.trim(),
            languageName: result.languageName,
            languageCode: result.languageCode,
          },
        };
      });
    }
  }, [question, recorder, answers, setAnswer, form.id, index]);

  /* --- Navigation -------------------------------------------------------- */

  const goNext = useCallback(() => {
    if (!question) return;
    if (recorder.status === 'recording') recorder.cancel();

    const found = validateAnswer(question, answers[question.id]);
    setIssues(found);

    if (hasErrors(found)) {
      track('error_shown', form.id, { questionIndex: index });
      return;
    }

    const hasWarning = found.some((i) => i.severity === 'warning');
    if (hasWarning && !acknowledged.has(question.id)) {
      setAcknowledged((prev) => new Set(prev).add(question.id));
      track('warning_shown', form.id, { questionIndex: index });
      return;
    }

    setShowWhy(false);
    recorder.dismissError();

    if (index + 1 >= total) {
      const all = validateForm(form, answers, applicable);
      setIssues(all);
      setStage('summary');
      track('form_completed', form.id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setIndex(index + 1);
      // Reaching a question is what builds the drop-off curve.
      track('question_reached', form.id, { questionIndex: index + 1 });
    }
  }, [question, answers, index, total, form, applicable, acknowledged, recorder]);

  const goBack = useCallback(() => {
    if (recorder.status === 'recording') recorder.cancel();
    setIssues([]);
    setShowWhy(false);
    recorder.dismissError();
    if (index === 0) setStage('intro');
    else setIndex(index - 1);
  }, [index, recorder]);

  const startOver = useCallback(() => {
    track('form_restarted', form.id);
    wipe(form.id);
    setAnswers({});
    setSpoken({});
    setIndex(0);
    setIssues([]);
    setRestored(false);
    setAcknowledged(new Set());
    setStage('intro');
  }, [form.id]);

  /* === INTRO ============================================================= */

  if (stage === 'intro') {
    return (
      <>
        <p className="no-print" style={{ marginTop: '1.5rem' }}>
          <Link href="/" className="btn-quiet">
            All forms
          </Link>
        </p>

        <h1>{form.title}</h1>
        <p className="lede">{form.summary}</p>

        <div className="notice notice-info">
          <p>
            <strong>You can answer out loud</strong>
          </p>
          <p>
            Press the microphone and say your answer in whichever language you
            speak most easily. We write it down, and put an English version on
            the form so the council can read it. Your own words are kept too.
          </p>
          <p>You can type instead at any point, if you would rather.</p>
        </div>

        {restored && (
          <div className="notice notice-info">
            <p>
              <strong>You have answers saved from earlier</strong>
            </p>
            <p>
              Carry on where you left off, or{' '}
              <button type="button" className="btn-quiet" onClick={startOver}>
                start again
              </button>
              .
            </p>
          </div>
        )}

        {form.eligibilityNote && (
          <div className="notice notice-check">
            <p>
              <strong>Before you start</strong>
            </p>
            <p>{form.eligibilityNote}</p>
          </div>
        )}

        <div className="card">
          <h2 style={{ marginTop: 0 }}>What you will need</h2>
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.9375rem' }}>
            You do not need all of this to start. You can leave things out and
            come back.
          </p>
          <ul className="evidence-list">
            {form.evidenceUpfront.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setStage('questions');
              track('form_started', form.id);
              track('question_reached', form.id, { questionIndex: 0 });
            }}
          >
            {restored ? 'Carry on' : 'Start'}
          </button>
          <span style={{ color: 'var(--ink-3)', fontSize: '0.9375rem' }}>
            About {form.estimatedMinutes} minutes, {total} questions
          </span>
        </div>
      </>
    );
  }

  /* === SUMMARY =========================================================== */

  if (stage === 'summary') {
    const warnings = issues.filter((i) => i.severity === 'warning');
    const errors = issues.filter((i) => i.severity === 'error');

    return (
      <>
        <h1>Check your answers</h1>
        <p className="lede">
          Read this through and fix anything that looks wrong. Then print it or
          save it, and use it to fill in the real form.
        </p>

        {errors.length > 0 && (
          <div className="notice notice-error no-print">
            <p>
              <strong>Some answers still need attention</strong>
            </p>
            <ul className="evidence-list">
              {errors.map((issue, i) => (
                <li key={`${issue.questionId}-${i}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="notice notice-check no-print">
            <p>
              <strong>Worth a second look</strong>
            </p>
            <ul className="evidence-list">
              {warnings.map((issue, i) => (
                <li key={`${issue.questionId}-${i}`}>{issue.message}</li>
              ))}
            </ul>
            <p style={{ marginTop: 8 }}>
              These are not errors. If you know your answer is right, carry on.
            </p>
          </div>
        )}

        {/*
          Styled as a document rather than another screen: this is the
          thing someone carries to a counter or reads down a phone, and it
          should look like a record, not an app.
        */}
        <div className="doc">
          <div className="doc-head">
            <h2 style={{ marginTop: 0 }}>{form.title}</h2>
            <p className="doc-meta">
              Prepared with Form Buddy GM on{' '}
              {new Date().toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              . Not an application.
            </p>
          </div>
          <ul className="summary-list">
            {applicable.map((q) => {
              const raw = (answers[q.id] ?? '').trim();
              /*
               * Dates arrive from the input as 2025-11-02. On a document
               * someone hands across a counter that reads as data; written
               * out it reads as a date.
               */
              let display = raw;
              if (q.type === 'choice') {
                display = q.options?.find((o) => o.value === raw)?.label ?? raw;
              } else if (q.type === 'date' && raw) {
                const parsed = new Date(raw);
                if (!Number.isNaN(parsed.getTime())) {
                  display = parsed.toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  });
                }
              }
              const original = spoken[q.id];

              return (
                <li key={q.id} className="summary-item">
                  <span className="summary-q">{q.label}</span>
                  <span className={display ? 'summary-a' : 'summary-a summary-a--empty'}>
                    {display || 'Not answered'}
                  </span>

                  {/* Their own words travel with the translation, onto the
                      printout as well, so the council sees both. */}
                  {original && (
                    <span className="summary-original">
                      <span className="summary-original-label">
                        Said in {original.languageName}
                      </span>
                      {/* dir="auto" so Arabic, Urdu, Hebrew and Farsi read
                          right-to-left, including when the sentence also
                          contains a Latin-script street name or number. */}
                      <span lang={original.languageCode || undefined} dir="auto">
                        {original.original}
                      </span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>What to do next</h2>
          <ol className="evidence-list">
            {form.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p style={{ fontSize: '0.875rem', color: 'var(--ink-soft)', marginBottom: 0 }}>
            This summary is not an application. Nothing has been sent to{' '}
            {form.provider.toLowerCase()}.
          </p>
        </div>

        <div className="actions no-print">
          <button
            type="button"
            className="btn btn-honey"
            onClick={() => {
              track('summary_printed', form.id);
              window.print();
            }}
          >
            Print or save as PDF
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setIndex(0);
              setStage('questions');
            }}
          >
            Change an answer
          </button>
          <span className="btn-row-spacer" />
          <button type="button" className="btn-quiet" onClick={startOver}>
            Clear and start again
          </button>
        </div>
      </>
    );
  }

  /* === QUESTIONS ========================================================= */

  if (!question) {
    return (
      <div className="notice notice-error">
        <p>Something went wrong finding that question. Please start again.</p>
        <button type="button" className="btn btn-secondary" onClick={startOver}>
          Start again
        </button>
      </div>
    );
  }

  const value = answers[question.id] ?? '';
  const original = spoken[question.id];
  const questionIssues = issues.filter((i) => i.questionId === question.id);
  const blocking = questionIssues.filter((i) => i.severity === 'error');
  const soft = questionIssues.filter((i) => i.severity === 'warning');

  // Speaking a radio choice would need the model to map words onto options,
  // which is a decision about their answer, not a transcription of it.
  const canSpeak = question.type !== 'choice' && recorder.supported;
  const busy = recorder.status === 'recording' || recorder.status === 'transcribing';

  return (
    <>
      <div className="progress no-print">
        {/*
          A segment per question, not a continuous bar: you can count what
          is left at a glance, which a smooth fill hides.
        */}
        <div
          className="progress-bar"
          role="progressbar"
          aria-valuenow={index + 1}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={`Question ${index + 1} of ${total}`}
        >
          {applicable.map((q, i) => (
            <span key={q.id} className="progress-seg" data-done={i <= index} />
          ))}
        </div>
        <p className="progress-text">
          Question {index + 1} of {total}
        </p>
      </div>

      <div className="question">
        <div ref={headingRef} tabIndex={-1}>
          <label className="question-label" htmlFor={`q-${question.id}`}>
            {question.label}
            {!question.required && (
              <span className="question-optional">You can leave this blank</span>
            )}
          </label>
        </div>

        {question.help && <p className="question-help">{question.help}</p>}

        {question.why && (
          <>
            {!showWhy && (
              <button
                type="button"
                className="btn-quiet no-print"
                onClick={() => setShowWhy(true)}
                aria-expanded={false}
              >
                Why are they asking this?
              </button>
            )}
            {showWhy && (
              <div className="question-why">
                <strong>Why they ask this</strong>
                {question.why}
              </div>
            )}
          </>
        )}

        {/* --- Voice ------------------------------------------------------- */}

        {canSpeak && (
          <div className="voice no-print">
            {recorder.status === 'transcribing' ? (
              <div className="voice-busy">
                <span className="spinner" aria-hidden="true" />
                Writing down what you said&hellip;
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="mic"
                  data-recording={recorder.status === 'recording'}
                  /*
                   * The live loudness drives the ring. A custom property
                   * rather than React state on the element keeps this off
                   * the render path — it updates every animation frame.
                   */
                  style={
                    {
                      '--level': recorder.status === 'recording' ? recorder.level : 0,
                    } as React.CSSProperties
                  }
                  onClick={() => {
                    if (recorder.status === 'recording') {
                      void handleStop();
                    } else {
                      track('voice_attempted', form.id, { questionIndex: index });
                      void recorder.start();
                    }
                  }}
                  disabled={recorder.status === 'requesting'}
                  aria-label={
                    recorder.status === 'recording'
                      ? 'Stop recording and write down what I said'
                      : value
                        ? 'Add more to this answer by speaking'
                        : 'Answer this question by speaking'
                  }
                >
                  {recorder.status === 'recording' && (
                    <span className="mic-ring" aria-hidden="true" />
                  )}
                  <span
                    className={recorder.status === 'recording' ? 'mic-stop' : 'mic-glyph'}
                    aria-hidden="true"
                  />
                </button>

                <p className="voice-caption">
                  {recorder.status === 'recording' ? (
                    <>
                      Listening.{' '}
                      <strong>
                        {Math.floor(recorder.seconds / 60)}:
                        {String(recorder.seconds % 60).padStart(2, '0')}
                      </strong>{' '}
                      Press again when you have finished. Stops on its own after{' '}
                      {MAX_RECORDING_SECONDS} seconds.
                    </>
                  ) : recorder.status === 'requesting' ? (
                    'Your browser is asking whether we can use the microphone.'
                  ) : value ? (
                    'Press to add more. Speak any language.'
                  ) : (
                    'Press and say your answer. Any language.'
                  )}
                </p>

                {recorder.status === 'recording' && (
                  <div className="voice-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={recorder.cancel}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Errors from the recorder, including the rate limiter's 429. */}
        <div aria-live="assertive">
          {recorder.error && (
            <div className="notice notice-check no-print">
              <p>{recorder.error}</p>
              <button type="button" className="btn-quiet" onClick={recorder.dismissError}>
                Hide this
              </button>
            </div>
          )}
        </div>

        {/* --- The field --------------------------------------------------- */}

        {question.type === 'choice' && question.options ? (
          <fieldset className="choice-list">
            <legend className="visually-hidden">{question.label}</legend>
            {question.options.map((option) => (
              <label
                key={option.value}
                className="choice"
                data-selected={value === option.value}
              >
                <input
                  type="radio"
                  name={question.id}
                  value={option.value}
                  checked={value === option.value}
                  onChange={() => typeAnswer(question.id, option.value)}
                />
                <span className="choice-text">
                  {option.label}
                  {option.hint && <span>{option.hint}</span>}
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          <>
            {canSpeak && (
              <p className="field-label-or">
                {value ? 'What we wrote down — edit it if it is wrong' : 'Or type it here'}
              </p>
            )}
            {question.type === 'longtext' ? (
              <textarea
                id={`q-${question.id}`}
                value={value}
                placeholder={question.placeholder}
                onChange={(e) => typeAnswer(question.id, e.target.value)}
                aria-invalid={blocking.length > 0}
                aria-describedby={questionIssues.length ? `issues-${question.id}` : undefined}
              />
            ) : (
              <input
                id={`q-${question.id}`}
                type={
                  question.type === 'date'
                    ? 'date'
                    : question.type === 'number'
                      ? 'number'
                      : 'text'
                }
                value={value}
                placeholder={question.placeholder}
                onChange={(e) => typeAnswer(question.id, e.target.value)}
                aria-invalid={blocking.length > 0}
                aria-describedby={questionIssues.length ? `issues-${question.id}` : undefined}
              />
            )}
          </>
        )}

        {/* --- Their own words --------------------------------------------- */}

        {original && (
          <div className="original-words">
            <h3>Your words, in {original.languageName}</h3>
            <p lang={original.languageCode || undefined} dir="auto">
              {original.original}
            </p>
            <p className="original-note">
              This is kept and printed with your answers, so the council can see
              what you actually said. The English above is a machine
              translation, so check it says what you meant.
            </p>
          </div>
        )}

        {/* --- Feedback ---------------------------------------------------- */}

        <div id={`issues-${question.id}`} aria-live="polite">
          {blocking.map((issue, i) => (
            <div className="notice notice-error" key={`e-${i}`}>
              <p>{issue.message}</p>
            </div>
          ))}
          {soft.map((issue, i) => (
            <div className="notice notice-check" key={`w-${i}`}>
              <p>
                <strong>Just checking</strong>
              </p>
              <p>{issue.message}</p>
              <p style={{ marginTop: 6, fontSize: '0.875rem' }}>
                If you know this is right, press Next again to carry on.
              </p>
            </div>
          ))}
        </div>

        {question.evidence && question.evidence.length > 0 && (
          <div className="notice notice-info">
            <p>
              <strong>You may need</strong>
            </p>
            <ul className="evidence-list">
              {question.evidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="actions no-print">
          <button type="button" className="btn btn-secondary" onClick={goBack}>
            Back
          </button>
          <button type="button" className="btn btn-honey" onClick={goNext} disabled={busy}>
            {index + 1 >= total ? 'Check my answers' : 'Next'}
          </button>
        </div>
      </div>

      <p className="no-print" style={{ marginTop: 20 }}>
        <button type="button" className="btn-quiet" onClick={startOver}>
          Clear my answers and start again
        </button>
      </p>
    </>
  );
}
