/* ---------------------------------------------------------------------------
   GET /api/stats
   ---------------------------------------------------------------------------

   Reads the funnel back. Everything here is an aggregate count — there is
   nothing individual stored to return.

   The useful number is `dropOff`: for each question, how many people saw it
   and how many never reached the next one. That is the sentence a council
   wants: "a third of people give up on question 4", and then you go and fix
   question 4.
   --------------------------------------------------------------------------- */

import { Redis } from '@upstash/redis';
import { NextResponse } from 'next/server';

import { forms, getForm } from '@/lib/forms';
import { statsKey } from '@/lib/analytics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

export type QuestionStat = {
  index: number;
  label: string;
  reached: number;
  /** How many of those who reached it never reached the next one. */
  lost: number;
  /** Lost as a percentage of those who reached it. */
  lostPercent: number;
};

export type FormStats = {
  formId: string;
  title: string;
  started: number;
  completed: number;
  printed: number;
  completionRate: number;
  voice: {
    attempted: number;
    succeeded: number;
    denied: number;
    failed: number;
    translated: number;
    successRate: number;
  };
  questions: QuestionStat[];
  languages: { code: string; count: number }[];
  friction: { warnings: number; errors: number };
};

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export async function GET() {
  if (!redis) {
    return NextResponse.json(
      {
        error:
          'Stats are not available: Upstash Redis is not configured for this deployment.',
        forms: [],
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const results: FormStats[] = [];

  for (const definition of forms) {
    const raw =
      (await redis.hgetall<Record<string, unknown>>(statsKey(definition.id))) ??
      {};

    const started = toNumber(raw['form_started']);
    const completed = toNumber(raw['form_completed']);

    /*
     * Reach counts per question. We read the full question list rather than
     * whatever happens to be in Redis, so a question nobody has reached
     * still appears as a zero — an absent row would read as "no problem
     * here" when it may mean "nobody ever gets this far".
     */
    const reach = definition.questions.map((q, index) => ({
      index,
      label: q.label,
      reached: toNumber(raw[`reached:${index}`]),
    }));

    /*
     * How many got PAST this question.
     *
     * Not simply "how many reached the next one" — that is wrong whenever a
     * question is conditional. `safety_detail` only appears if you answered
     * one particular way, so few people reach it, and comparing against it
     * makes the preceding question look like a cliff when nothing is wrong.
     *
     * Anyone who reached ANY later question necessarily passed this one, so
     * take the highest reach from here on, and never less than the number
     * who completed.
     */
    const questions: QuestionStat[] = reach.map((entry, i) => {
      const laterReach = reach.slice(i + 1).map((r) => r.reached);
      const got_past = Math.max(completed, ...laterReach, 0);
      const lost = Math.max(0, entry.reached - got_past);
      return {
        ...entry,
        lost,
        lostPercent: percent(lost, entry.reached),
      };
    });

    const attempted = toNumber(raw['voice_attempted']);
    const succeeded = toNumber(raw['voice_succeeded']);

    const languages = Object.entries(raw)
      .filter(([field]) => field.startsWith('lang:'))
      .map(([field, value]) => ({
        code: field.slice('lang:'.length),
        count: toNumber(value),
      }))
      .sort((a, b) => b.count - a.count);

    results.push({
      formId: definition.id,
      title: definition.title,
      started,
      completed,
      printed: toNumber(raw['summary_printed']),
      completionRate: percent(completed, started),
      voice: {
        attempted,
        succeeded,
        denied: toNumber(raw['voice_denied']),
        failed: toNumber(raw['voice_failed']),
        translated: toNumber(raw['voice_translated']),
        successRate: percent(succeeded, attempted),
      },
      questions,
      languages,
      friction: {
        warnings: toNumber(raw['warning_shown']),
        errors: toNumber(raw['error_shown']),
      },
    });
  }

  return NextResponse.json(
    {
      note: 'Aggregate counts only. No individual records, sessions, IP addresses or answer content are stored.',
      forms: results,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
