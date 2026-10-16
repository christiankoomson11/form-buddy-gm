/* ---------------------------------------------------------------------------
   Funnel analytics
   ---------------------------------------------------------------------------

   WHY THIS EXISTS

   The one thing that would prove this tool works is a drop-off curve: how
   many people start, which question loses them, how many reach the end.
   Without it, "it helps residents" is an assertion.

   Vercel Web Analytics gives page views for free, but custom events are a
   paid feature — and page views would tell us nothing here anyway, because
   the whole form is one page with client-side stages.

   So the funnel lives in the Upstash Redis we already have.

   THE PRIVACY DESIGN — read this before adding an event

   Residents using this are telling a council about damp in their child's
   bedroom and how little money they have. None of that may ever reach an
   analytics system, and "we'll be careful" is not a safeguard.

   So the design makes leaking impossible rather than discouraged:

     1. AGGREGATE COUNTERS ONLY. Every event increments a number. There are
        no rows, no session ids, no timestamps per event, no IP addresses.
        There is nothing to re-identify because nothing individual is
        stored.

     2. A CLOSED EVENT VOCABULARY. Events are an enum, checked server-side.
        A free-text event name is rejected. You cannot pass an answer
        through this API even deliberately.

     3. NO PAYLOAD. Events carry no properties. The only variable parts are
        a question INDEX (a number) and a language CODE from a fixed shape.
        Never the question's text, never the answer.

   The practical effect: you can tell a council's information governance
   officer that this collects no personal data at all, and the code backs
   that up. That is the difference between analytics that survive a DPIA
   and analytics that get switched off.
   --------------------------------------------------------------------------- */

/**
 * Every event the system can record. Server-side code rejects anything not
 * in this list, which is what makes it impossible to smuggle content
 * through the endpoint.
 */
export const TRACKED_EVENTS = [
  /** Pressed Start on a form. The denominator for everything else. */
  'form_started',
  /**
   * Arrived at a question. Carries the index, which is what builds the
   * drop-off curve. Kept separate from form_started so advancing through
   * the form does not inflate the start count.
   */
  'question_reached',
  /** Reached the summary screen with no blocking errors. */
  'form_completed',
  /** Printed or saved the summary — the real goal, not just finishing. */
  'summary_printed',
  /** Cleared their answers and started again. */
  'form_restarted',

  /** Pressed the microphone button. */
  'voice_attempted',
  /** Got a usable transcription back. */
  'voice_succeeded',
  /** Denied microphone permission, or had no microphone. */
  'voice_denied',
  /** Recording worked but transcription failed, including rate limiting. */
  'voice_failed',
  /** Spoke a language other than English. */
  'voice_translated',

  /** A validation warning was shown — tells us which questions confuse. */
  'warning_shown',
  /** A blocking error was shown. */
  'error_shown',
] as const;

export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

export function isTrackedEvent(value: unknown): value is TrackedEvent {
  return (
    typeof value === 'string' &&
    (TRACKED_EVENTS as readonly string[]).includes(value)
  );
}

/* --- Redis keys -----------------------------------------------------------
   One hash per form, so reading the whole funnel is a single HGETALL rather
   than a key scan. All values are integers.
   ------------------------------------------------------------------------ */

export const STATS_PREFIX = 'fbgm:stats';

export function statsKey(formId: string): string {
  return `${STATS_PREFIX}:${formId}`;
}

/**
 * Field name for "someone reached question N".
 *
 * The INDEX, never the question id or its text. An index is meaningless
 * without the form definition, which is exactly the property we want.
 */
export function reachedField(index: number): string {
  return `reached:${index}`;
}

/**
 * Field name for a language someone spoke in.
 *
 * Sanitised hard: letters and a single hyphen, 2–8 characters, lowercased.
 * A BCP-47 code like "ur" or "pt-br" passes; anything resembling a sentence
 * does not. Belt and braces on top of the closed event list, because this
 * is the only place a model-produced string reaches storage.
 */
export function languageField(code: string): string | null {
  const clean = code.trim().toLowerCase();
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/.test(clean)) return null;
  return `lang:${clean}`;
}

/* Events are rate limited on their own budget, separate from the AI limit.
   See checkEventsRateLimit in lib/ratelimit.ts for why. */
