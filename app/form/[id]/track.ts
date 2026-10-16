'use client';

/* ---------------------------------------------------------------------------
   Client-side event sending
   ---------------------------------------------------------------------------

   The signature is the safeguard. This function physically cannot send an
   answer: it takes an event name from a fixed union, a question INDEX, and
   a language CODE. There is no free-text parameter, so a future change
   cannot casually start sending content without someone editing this file
   and noticing what they are doing.

   Fire and forget. A failed counter must never interrupt someone filling in
   a form, so every error is swallowed.
   --------------------------------------------------------------------------- */

import type { TrackedEvent } from '@/lib/analytics';

type TrackOptions = {
  /** Position in the form, never the question's id or text. */
  questionIndex?: number;
  /** A BCP-47 code such as "ur". Validated again server-side. */
  languageCode?: string;
};

export function track(
  event: TrackedEvent,
  formId: string,
  options: TrackOptions = {},
): void {
  try {
    const payload = JSON.stringify({
      event,
      formId,
      questionIndex: options.questionIndex,
      languageCode: options.languageCode,
    });

    /*
     * sendBeacon survives the page being closed, which matters: the most
     * important moment to record is someone abandoning the form, and that
     * is exactly when a normal fetch gets cancelled.
     */
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon('/api/events', blob)) return;
    }

    void fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {
      /* analytics must never break the form */
    });
  } catch {
    /* analytics must never break the form */
  }
}
