/* ---------------------------------------------------------------------------
   POST /api/events
   ---------------------------------------------------------------------------

   Records one funnel event as an aggregate counter.

   What this endpoint will accept is deliberately tiny: an event name from a
   fixed list, a form id that must exist, an optional question INDEX, and an
   optional language CODE matching a strict pattern. Everything else is
   dropped on the floor.

   That narrowness is the privacy control. There is no field through which
   an answer, a transcript or an identifier could travel, even if a future
   change to the client tried to send one. See lib/analytics.ts.

   Failures here are silent by design. Analytics must never break the form —
   a resident trying to report damp in their flat should not see an error
   because a counter did not increment.
   --------------------------------------------------------------------------- */

import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

import { checkEventsRateLimit, visitorKeyFromHeaders } from '@/lib/ratelimit';
import { getForm } from '@/lib/forms';
import {
  isTrackedEvent,
  languageField,
  reachedField,
  statsKey,
} from '@/lib/analytics';

export const runtime = 'nodejs';

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

/** Always 204. The client neither needs nor gets a reason. */
const noContent = () => new NextResponse(null, { status: 204 });

export async function POST(request: Request) {
  // No Redis configured (local dev): accept and discard.
  if (!redis) return noContent();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noContent();
  }

  const { event, formId, questionIndex, languageCode } = (body ?? {}) as {
    event?: unknown;
    formId?: unknown;
    questionIndex?: unknown;
    languageCode?: unknown;
  };

  // Closed vocabulary. Anything else is not an event we know about.
  if (!isTrackedEvent(event)) return noContent();

  if (typeof formId !== 'string' || !getForm(formId)) return noContent();

  const visitorKey = await visitorKeyFromHeaders(request.headers);
  const limit = await checkEventsRateLimit(visitorKey);
  if (!limit.success) return noContent();

  try {
    const key = statsKey(formId);
    const writes: Promise<unknown>[] = [redis.hincrby(key, event, 1)];

    /*
     * A question INDEX, not its id or text. Bounded to a sane range so a
     * hostile client cannot create unbounded hash fields.
     */
    if (
      typeof questionIndex === 'number' &&
      Number.isInteger(questionIndex) &&
      questionIndex >= 0 &&
      questionIndex < 100
    ) {
      writes.push(redis.hincrby(key, reachedField(questionIndex), 1));
    }

    /*
     * The only model-produced string that reaches storage, so it is
     * pattern-checked rather than trusted. languageField returns null for
     * anything that is not a plain language code.
     */
    if (typeof languageCode === 'string') {
      const field = languageField(languageCode);
      if (field) writes.push(redis.hincrby(key, field, 1));
    }

    await Promise.all(writes);
  } catch (error) {
    // Log for us; never surface to the resident.
    console.error('[events] write failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return noContent();
}

export async function GET() {
  return NextResponse.json(
    { error: 'Send a POST request to record an event. See /api/stats to read them.' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
