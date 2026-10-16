import type { Metadata } from 'next';
import Link from 'next/link';

import { forms } from '@/lib/forms';
import { statsKey } from '@/lib/analytics';
import { Redis } from '@upstash/redis';

export const metadata: Metadata = {
  title: 'Usage — Form Buddy GM',
  description: 'Where residents get stuck, and how voice input is being used.',
};

// Always live. A cached dashboard during a pitch shows yesterday's numbers.
export const dynamic = 'force-dynamic';

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

/** Language codes we are likely to see in Greater Manchester, named. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ur: 'Urdu',
  pa: 'Punjabi',
  pl: 'Polish',
  ro: 'Romanian',
  ar: 'Arabic',
  bn: 'Bengali',
  gu: 'Gujarati',
  so: 'Somali',
  fa: 'Persian',
  ps: 'Pashto',
  ku: 'Kurdish',
  ti: 'Tigrinya',
  uk: 'Ukrainian',
  pt: 'Portuguese',
  es: 'Spanish',
  fr: 'French',
  zh: 'Chinese',
  lt: 'Lithuanian',
  sq: 'Albanian',
};

export default async function StatsPage() {
  if (!redis) {
    return (
      <>
        <h1>Usage</h1>
        <div className="notice notice-check">
          <p>
            <strong>Not recording yet</strong>
          </p>
          <p>
            Upstash Redis is not configured for this deployment, so there is
            nothing to show. Connect it in Vercel and redeploy.
          </p>
        </div>
        <p>
          <Link href="/" className="btn-quiet">
            &larr; Back to the forms
          </Link>
        </p>
      </>
    );
  }

  const data = await Promise.all(
    forms.map(async (definition) => {
      const raw =
        (await redis.hgetall<Record<string, unknown>>(
          statsKey(definition.id),
        )) ?? {};

      const reach = definition.questions.map((q, index) => ({
        index,
        label: q.label,
        reached: num(raw[`reached:${index}`]),
      }));

      return { definition, raw, reach };
    }),
  );

  const anyData = data.some(({ raw }) => num(raw['form_started']) > 0);

  return (
    <>
      <h1>Usage</h1>
      <p className="lede">
        Where people get stuck, and how voice is being used. Aggregate counts
        only &mdash; no individual records, no sessions, no answer content.
      </p>

      {!anyData && (
        <div className="notice notice-info">
          <p>
            <strong>No activity recorded yet</strong>
          </p>
          <p>
            Numbers appear here once someone starts a form. Walk through one
            yourself to check it is wired up.
          </p>
        </div>
      )}

      {data.map(({ definition, raw, reach }) => {
        const started = num(raw['form_started']);
        const completed = num(raw['form_completed']);
        const printed = num(raw['summary_printed']);
        const attempted = num(raw['voice_attempted']);
        const succeeded = num(raw['voice_succeeded']);
        const denied = num(raw['voice_denied']);
        const failed = num(raw['voice_failed']);
        const translated = num(raw['voice_translated']);

        const languages = Object.entries(raw)
          .filter(([field]) => field.startsWith('lang:'))
          .map(([field, value]) => ({
            code: field.slice(5),
            count: num(value),
          }))
          .sort((a, b) => b.count - a.count);

        /*
         * How many got PAST each question. Not "how many reached the next
         * one" — that is wrong for conditional questions, which few people
         * reach by design, and would make the question before them look
         * like a cliff. Anyone who reached a LATER question passed this
         * one, so take the highest reach from here on.
         */
        const gotPast = (i: number) =>
          Math.max(completed, ...reach.slice(i + 1).map((r) => r.reached), 0);

        const worst = reach
          .map((entry, i) => ({
            ...entry,
            lost: Math.max(0, entry.reached - gotPast(i)),
          }))
          .filter((entry) => entry.reached > 0)
          .sort((a, b) => b.lost - a.lost)[0];

        return (
          <section key={definition.id} className="card" style={{ marginTop: 20 }}>
            <h2 style={{ marginTop: 0 }}>{definition.title}</h2>

            <div className="stat-row">
              <div className="stat">
                <span className="stat-value">{started}</span>
                <span className="stat-label">Started</span>
              </div>
              <div className="stat">
                <span className="stat-value">{completed}</span>
                <span className="stat-label">Reached the end</span>
              </div>
              <div className="stat">
                <span className="stat-value">{pct(completed, started)}%</span>
                <span className="stat-label">Completion</span>
              </div>
              <div className="stat">
                <span className="stat-value">{printed}</span>
                <span className="stat-label">Printed</span>
              </div>
            </div>

            {worst && worst.lost > 0 && (
              <div className="notice notice-check">
                <p>
                  <strong>Most people give up here</strong>
                </p>
                <p>
                  Question {worst.index + 1}: &ldquo;{worst.label}&rdquo; &mdash;{' '}
                  {worst.lost} of {worst.reached} who reached it went no further.
                </p>
              </div>
            )}

            <h3>Drop-off by question</h3>
            <ul className="funnel">
              {reach.map((entry, i) => {
                const lost = Math.max(0, entry.reached - gotPast(i));
                const width = started > 0 ? pct(entry.reached, started) : 0;

                return (
                  <li key={entry.index} className="funnel-row">
                    <span className="funnel-label">
                      <span className="funnel-n">{entry.index + 1}</span>
                      {entry.label}
                    </span>
                    <span className="funnel-track">
                      <span
                        className="funnel-fill"
                        style={{ width: `${width}%` }}
                      />
                    </span>
                    <span className="funnel-count">
                      {entry.reached}
                      {lost > 0 && <em> &minus;{lost}</em>}
                    </span>
                  </li>
                );
              })}
            </ul>

            <h3>Voice</h3>
            {attempted === 0 ? (
              <p style={{ color: 'var(--ink-soft)' }}>
                Nobody has used the microphone on this form yet.
              </p>
            ) : (
              <>
                <div className="stat-row">
                  <div className="stat">
                    <span className="stat-value">{attempted}</span>
                    <span className="stat-label">Tried</span>
                  </div>
                  <div className="stat">
                    <span className="stat-value">{pct(succeeded, attempted)}%</span>
                    <span className="stat-label">Worked</span>
                  </div>
                  <div className="stat">
                    <span className="stat-value">{denied}</span>
                    <span className="stat-label">No mic access</span>
                  </div>
                  <div className="stat">
                    <span className="stat-value">{failed}</span>
                    <span className="stat-label">Failed</span>
                  </div>
                </div>
                <p style={{ color: 'var(--ink-soft)', fontSize: '0.9375rem' }}>
                  {translated} answers were given in a language other than
                  English.
                </p>
              </>
            )}

            {languages.length > 0 && (
              <>
                <h3>Languages spoken</h3>
                <ul className="funnel">
                  {languages.map((lang) => (
                    <li key={lang.code} className="funnel-row">
                      <span className="funnel-label">
                        {LANGUAGE_NAMES[lang.code] ?? lang.code}
                      </span>
                      <span className="funnel-track">
                        <span
                          className="funnel-fill"
                          style={{
                            width: `${pct(lang.count, languages[0].count)}%`,
                          }}
                        />
                      </span>
                      <span className="funnel-count">{lang.count}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        );
      })}

      <div className="notice notice-info" style={{ marginTop: 24 }}>
        <p>
          <strong>What is and is not collected</strong>
        </p>
        <p>
          Every number here is a counter. Nothing identifies a person: no
          session ids, no IP addresses, no timestamps per event, and never any
          part of an answer or recording. Question numbers are stored, not
          question text.
        </p>
      </div>

      <p style={{ marginTop: 20 }}>
        <Link href="/" className="btn-quiet">
          &larr; Back to the forms
        </Link>
      </p>
    </>
  );
}
