/* ---------------------------------------------------------------------------
   GET /api/status

   Reports how the rate limiter is configured and how much of the global
   allowance is left, without consuming any of it.

   Useful for two things: confirming after deploy that Vercel picked up your
   environment variables, and showing the limiter working during the pitch.
   --------------------------------------------------------------------------- */

import { NextResponse } from 'next/server';

import { GLOBAL_LIMIT, GLOBAL_WINDOW, PER_VISITOR_LIMIT, peekGlobal, usingRedis } from '@/lib/ratelimit';

export const runtime = 'nodejs';

// Never cache this — a cached status page is a lie about live state.
export const dynamic = 'force-dynamic';

export async function GET() {
  const global = await peekGlobal();

  return NextResponse.json(
    {
      rateLimit: {
        globalLimit: GLOBAL_LIMIT,
        window: GLOBAL_WINDOW,
        perVisitorLimit: PER_VISITOR_LIMIT,
        remaining: global.remaining,
        resetsInSeconds: Math.max(
          0,
          Math.ceil((global.reset - Date.now()) / 1000),
        ),
        store: usingRedis ? 'upstash-redis' : 'in-memory',
        /*
         * Surfaced deliberately. If this says true in production the limit is
         * not actually being enforced across instances, and that is something
         * you want to find out from a status check rather than from a bill.
         */
        degraded: global.degraded,
      },
      voice: {
        configured: Boolean(process.env.GEMINI_API_KEY),
        model: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
