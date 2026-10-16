/* ---------------------------------------------------------------------------
   Rate limiting
   ---------------------------------------------------------------------------

   WHY THIS FILE EXISTS

   Every AI call costs money. Without a limit, anyone who finds the URL can
   hold down a key and run up the bill, or knock the demo over mid-pitch.

   WHY NOT JUST A COUNTER IN MEMORY

   On Vercel, an API route runs as a serverless function. Two things break an
   in-memory counter:

     1. Horizontal scale. Vercel runs as many instances as it needs. Each one
        gets its own memory, so each one has its own count. Ten instances with
        a "60/min" counter each allow 600/min in total.
     2. Cold starts. An idle instance is torn down. The next request starts a
        fresh process with the count back at zero.

   So the count has to live somewhere all instances can see. That is Redis.
   We use Upstash because it speaks HTTP rather than a raw TCP socket, which
   is what serverless functions can actually open.

   WHAT WE ENFORCE

   One global limit: 60 requests per minute across the whole app.

   That is a cost guard, not an abuse guard. Worth knowing the trade-off,
   because a judge may well ask:

     - It caps your spend no matter how many people show up.
     - But one person sending 60 requests a minute locks out every other
       resident, and they will see "too many people are using this".

   A per-visitor limit layered underneath fixes that. It is written below and
   switched off by default; see PER_VISITOR_LIMIT. Turning it on is a config
   change, not a rewrite.
   --------------------------------------------------------------------------- */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/** Requests allowed across the whole app, per window. */
export const GLOBAL_LIMIT = 60;

/** The window, in Upstash's duration format. */
export const GLOBAL_WINDOW = '60 s' as const;

/**
 * Optional second layer: a per-visitor cap, applied before the global one.
 * Set to a number (e.g. 10) to stop a single visitor consuming the whole
 * global allowance. Set to null to disable.
 */
export const PER_VISITOR_LIMIT: number | null = null;
export const PER_VISITOR_WINDOW = '60 s' as const;

/* --- Result shape ---------------------------------------------------------
   Both the Redis limiter and the in-memory fallback return this, so the API
   route does not care which one is running.
   ------------------------------------------------------------------------- */

export type LimitResult = {
  /** Did this request get through? */
  success: boolean;
  /** The ceiling that applied. */
  limit: number;
  /** How many requests are left in this window. */
  remaining: number;
  /** Unix ms when the window resets. */
  reset: number;
  /** Which layer rejected it, for logging and for the response body. */
  scope: 'global' | 'visitor';
  /** True when we are counting in memory because Redis is not configured. */
  degraded: boolean;
};

/* --- Is Redis configured? ------------------------------------------------- */

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

export const usingRedis = Boolean(redisUrl && redisToken);

/* --- The real limiter ----------------------------------------------------- */

/**
 * A sliding window, not a fixed one. A fixed window resets on the minute, so
 * someone can send 60 at 10:00:59 and 60 more at 10:01:00 — 120 requests in
 * two seconds, both "within limits". A sliding window counts the last 60
 * seconds from now, so that burst is caught.
 */
const redis = usingRedis
  ? new Redis({ url: redisUrl!, token: redisToken! })
  : null;

const globalLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(GLOBAL_LIMIT, GLOBAL_WINDOW),
      prefix: 'fbgm:global',
      /*
       * Keeps already-blocked keys in the instance's memory for the rest of
       * the window, so a flood does not become a flood of Redis calls too.
       * It is a cost optimisation, not the limit itself.
       */
      ephemeralCache: new Map(),
      analytics: true,
    })
  : null;

const visitorLimiter =
  redis && PER_VISITOR_LIMIT !== null
    ? new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(PER_VISITOR_LIMIT, PER_VISITOR_WINDOW),
        prefix: 'fbgm:visitor',
        ephemeralCache: new Map(),
        analytics: true,
      })
    : null;

/* --- The fallback -------------------------------------------------------- *
   Used when Redis is not configured, so `npm run dev` works with no signup
   and the demo still runs if the Upstash env vars are missing on the day.

   It is genuinely a sliding window, but only for THIS instance. Read the
   caveat at the top of the file before relying on it in production.
   ------------------------------------------------------------------------ */

const memoryHits = new Map<string, number[]>();

function parseWindowMs(window: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(window.trim());
  if (!match) throw new Error(`Cannot parse rate limit window: "${window}"`);
  const value = Number(match[1]);
  const unit = match[2];
  const multiplier = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multiplier[unit as keyof typeof multiplier];
}

function limitInMemory(
  key: string,
  limit: number,
  window: string,
  scope: LimitResult['scope'],
): LimitResult {
  const windowMs = parseWindowMs(window);
  const now = Date.now();
  const cutoff = now - windowMs;

  // Drop timestamps that have aged out of the window.
  const hits = (memoryHits.get(key) ?? []).filter((t) => t > cutoff);

  if (hits.length >= limit) {
    return {
      success: false,
      limit,
      remaining: 0,
      // The window frees up when the oldest hit in it ages out.
      reset: hits[0] + windowMs,
      scope,
      degraded: true,
    };
  }

  hits.push(now);
  memoryHits.set(key, hits);

  // Stop the Map growing without bound if many keys are used.
  if (memoryHits.size > 5_000) {
    for (const [k, v] of memoryHits) {
      if (v.every((t) => t <= cutoff)) memoryHits.delete(k);
    }
  }

  return {
    success: true,
    limit,
    remaining: limit - hits.length,
    reset: now + windowMs,
    scope,
    degraded: true,
  };
}

/* --- Public entry point -------------------------------------------------- */

/**
 * Check both layers and return the first rejection.
 *
 * Order matters. The per-visitor check runs first so that a single abusive
 * visitor is rejected without consuming any of the global allowance. If the
 * global check ran first, their requests would still eat the shared budget
 * before being thrown away.
 *
 * @param visitorKey Something stable-ish per visitor, usually a hashed IP.
 *                   Only used when PER_VISITOR_LIMIT is set.
 */
export async function checkRateLimit(
  visitorKey: string,
): Promise<LimitResult> {
  // Layer 1: per visitor (off by default).
  if (PER_VISITOR_LIMIT !== null) {
    const result = visitorLimiter
      ? await visitorLimiter
          .limit(visitorKey)
          .then((r) => ({ ...r, scope: 'visitor' as const, degraded: false }))
      : limitInMemory(
          `visitor:${visitorKey}`,
          PER_VISITOR_LIMIT,
          PER_VISITOR_WINDOW,
          'visitor',
        );

    if (!result.success) {
      return {
        success: false,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
        scope: 'visitor',
        degraded: 'degraded' in result ? result.degraded : false,
      };
    }
  }

  // Layer 2: global. One fixed key, so every request counts against the same
  // bucket regardless of who sent it or which instance handled it.
  if (globalLimiter) {
    const r = await globalLimiter.limit('all');
    return {
      success: r.success,
      limit: r.limit,
      remaining: r.remaining,
      reset: r.reset,
      scope: 'global',
      degraded: false,
    };
  }

  return limitInMemory('global:all', GLOBAL_LIMIT, GLOBAL_WINDOW, 'global');
}

/* --- Analytics events ----------------------------------------------------
   A SEPARATE budget from the AI limit above, on purpose.

   If events shared the 60/min AI allowance, counting people could exhaust
   the allowance for transcribing them — a resident unable to use the
   microphone because the app had spent its quota on analytics. The AI limit
   exists to protect spend; this one only stops someone inflating the
   numbers or hammering Redis. Events cost nothing per call, so the ceiling
   is far higher.
   ------------------------------------------------------------------------ */

const EVENTS_LIMIT = 600;
const EVENTS_WINDOW = '60 s' as const;

const eventsLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(EVENTS_LIMIT, EVENTS_WINDOW),
      prefix: 'fbgm:events-rl',
      ephemeralCache: new Map(),
    })
  : null;

export async function checkEventsRateLimit(
  visitorKey: string,
): Promise<LimitResult> {
  if (eventsLimiter) {
    const r = await eventsLimiter.limit(visitorKey);
    return {
      success: r.success,
      limit: r.limit,
      remaining: r.remaining,
      reset: r.reset,
      scope: 'visitor',
      degraded: false,
    };
  }

  return limitInMemory(
    `events:${visitorKey}`,
    EVENTS_LIMIT,
    EVENTS_WINDOW,
    'visitor',
  );
}

/**
 * Read the current global allowance WITHOUT consuming any of it.
 *
 * Exists so the UI can show "54 of 60 left this minute" and so you can
 * demonstrate the limiter on stage. A status endpoint that spent a request
 * in order to report on requests would be its own small joke.
 */
export async function peekGlobal(): Promise<{
  remaining: number;
  limit: number;
  reset: number;
  degraded: boolean;
}> {
  if (globalLimiter) {
    const r = await globalLimiter.getRemaining('all');
    return { ...r, degraded: false };
  }

  const windowMs = parseWindowMs(GLOBAL_WINDOW);
  const cutoff = Date.now() - windowMs;
  const hits = (memoryHits.get('global:all') ?? []).filter((t) => t > cutoff);

  return {
    remaining: Math.max(0, GLOBAL_LIMIT - hits.length),
    limit: GLOBAL_LIMIT,
    reset: hits.length ? hits[0] + windowMs : Date.now() + windowMs,
    degraded: true,
  };
}

/**
 * Turn a limit result into the headers a well-behaved API returns.
 * `Retry-After` is in whole seconds, which is what the spec requires.
 */
export function rateLimitHeaders(result: LimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(Math.max(0, result.remaining)),
    'RateLimit-Reset': String(Math.max(0, Math.ceil((result.reset - Date.now()) / 1000))),
  };

  if (!result.success) {
    headers['Retry-After'] = String(
      Math.max(1, Math.ceil((result.reset - Date.now()) / 1000)),
    );
  }

  return headers;
}

/**
 * A rough per-visitor key from request headers.
 *
 * `x-forwarded-for` is a list; the client address is the first entry. Vercel
 * also sets `x-real-ip`. Neither is trustworthy enough for anything
 * security-critical — a determined abuser can rotate addresses — which is
 * part of why the global cap is the real spend guard.
 *
 * We hash it so a raw IP never reaches Redis or the logs. The brief asks for
 * minimum data collection, and an IP is personal data under UK GDPR.
 */
export async function visitorKeyFromHeaders(
  headers: Headers,
): Promise<string> {
  const forwarded = headers.get('x-forwarded-for');
  const ip =
    forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';

  const salt = process.env.RATE_LIMIT_SALT ?? 'form-buddy-gm-dev-salt';
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);

  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
