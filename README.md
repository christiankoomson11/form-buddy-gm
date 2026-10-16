# Form Buddy GM

Fill in a Greater Manchester council form **by speaking**, in any language.
Built for **Build for Greater Manchester**.

A proof of concept. The two forms included are demonstrations modelled on the
kind of forms GM councils publish — they are not any real council's form, and
no wording here has been approved by anyone.

---

## The problem

From the participant brief:

- Almost **400,000** people in Greater Manchester are digitally excluded, and
  more than **1 million** lack essential digital skills.
- **28.7%** of residents are from Asian, Black, Mixed or other ethnic groups,
  and "services increasingly need to work across languages and cultures".
- Residents **give up partway through a form**.

Typing is the barrier. It is slow, it exposes spelling, and on a phone it is
genuinely hard. Speaking is not — and it is the one interface almost everyone
already knows how to use.

## What it does

A resident presses the microphone and says their answer in whichever
language they speak most easily. One Gemini call then:

1. **Transcribes** what they said, in their own language
2. **Detects** which language that was
3. **Translates** it to English so the council can read it

The English goes in the form field, editable. **Their own words are kept**,
shown on screen and carried onto the printed summary, so the council sees
what they actually said rather than only a machine's version of them.

Around it: one question at a time, plain English, an explanation of why each
question is asked, questions that do not apply are skipped, obvious mistakes
are caught, and a printable summary at the end.

## What it deliberately does not do

Each of these is enforced in code, not just asked for in a prompt:

- **It never decides eligibility.** Council Tax Reduction schemes differ
  across all ten boroughs. Being wrong about money people are counting on
  does real harm. See the comment at the top of
  `lib/forms/council-tax-reduction.ts`.
- **It never submits anything.** It hands the resident a summary.
- **It never answers for them.** The transcription prompt forbids
  completing, tidying or inferring. Unclear audio becomes `[unclear]`, not a
  confident guess — a visible gap is honest, a wrong word gets copied onto a
  real application.
- **It never corrects their grammar.** These are their words on their
  application.
- **Voice never replaces typing.** A voice-only form would be a new locked
  door: it would exclude people who cannot speak, are deaf, are somewhere
  public, or whose microphone does not work. The keyboard never goes away,
  and every failure path says so.
- **It never stores answers on a server.** Answers live in `sessionStorage`
  in the resident's own browser, cleared when the tab closes. Audio is held
  in memory for one request and never written to disk.
- **The AI never validates.** Rules in `lib/validate.ts` do that — declared
  as data, auditable by a council officer, identical every time.

---

## Rate limiting

**60 requests per minute, globally, across the whole app.**

Only `/api/transcribe` is limited, because it is the only route that costs
money.

### Why record-and-send rather than Gemini Live

Gemini's Live API streams audio over a WebSocket. Vercel's serverless
functions cannot hold a WebSocket, so the documented pattern is to mint an
ephemeral token and have **the browser stream audio straight to Google**.

That was rejected here for two reasons:

1. **It bypasses the rate limiter.** A server-side limit could only cap
   *sessions started*, not the audio minutes flowing to Google afterwards.
   The whole point of the limit is that it caps spend.
2. **Ephemeral tokens are easy to get wrong.** A token minted without
   `liveConnectConstraints` lets whoever holds it set its own model, system
   instruction and tools — including code execution, on your quota.
   [Google's own reference implementation omits that field.](https://gbhackers.com/google-gemini-live-api-flaw/)

Record-and-send means every byte of audio passes through our own function,
so the 60/min ceiling is real. The cost is no live word-by-word transcript.

### Why a shared store and not a counter in memory

On Vercel an API route is a serverless function. Two things break an
in-memory counter:

1. **Horizontal scale.** Vercel runs as many instances as it needs, each with
   its own memory. Ten instances each allowing 60/min allow 600/min.
2. **Cold starts.** An idle instance is torn down; the next request starts
   fresh with the count at zero.

So the count lives in Upstash Redis, which all instances can see. Upstash
rather than ordinary Redis because it speaks HTTP, and a serverless function
cannot reliably hold a raw TCP connection.

### Sliding window, not fixed

A fixed window resets on the minute, so 60 requests at 10:00:59 and 60 more
at 10:01:00 is 120 in two seconds, both "within limits". A sliding window
counts the last 60 seconds from now, and catches that.

### The trade-off to name in the pitch

The limit is **global**, which caps spend however many people arrive. But one
person sending 60 requests a minute locks everyone else out.

A per-visitor layer is written and switched off. In `lib/ratelimit.ts`:

```ts
export const PER_VISITOR_LIMIT: number | null = null;  // set to e.g. 10
```

It runs *before* the global check, so an abusive visitor is rejected without
eating the shared budget. IPs are SHA-256 hashed with a salt before being
used as keys — an IP is personal data under UK GDPR.

### Checking it works

`GET /api/status` reports the configuration and remaining allowance without
consuming any of it:

```json
{
  "rateLimit": { "globalLimit": 60, "remaining": 60, "store": "upstash-redis", "degraded": false },
  "voice":     { "configured": true, "model": "gemini-3.8-flash" }
}
```

**`"degraded": true` means the limit is not actually enforced across
instances** — the Upstash variables are missing. Check this after deploying.

Verified behaviour (65 uploads in 602ms):

| Requests | Response |
|---|---|
| 1–60 | passed the limiter |
| 61–65 | `429`, `Retry-After: 60`, `RateLimit-Remaining: 0` |

Junk is rejected **before** the limiter and before any model call: wrong MIME
type gives `415`, an empty recording `400`, oversized audio `413`.

---

## Running it locally

```bash
npm install
cp .env.example .env.local   # works with everything blank
npm run dev
```

With no environment variables the app still runs: every question can be
typed, validation works, the summary prints. The microphone button reports
that voice is switched off.

```bash
npm test           # 36 tests, no network, no Redis, no API key needed
npm run build
```

**Microphones need HTTPS.** `getUserMedia` only works on a secure origin.
`localhost` counts as secure, and Vercel gives you HTTPS, so this works in
both places — but it will fail on a bare-IP LAN address, which is the usual
way this surprises people when demoing from a phone.

## Deploying to Vercel

1. Push to GitHub.
2. In Vercel: **Add New > Project**, import the repo. Next.js is detected
   automatically; no build settings to change.
3. Add Upstash from the Vercel Marketplace (**Storage > Upstash Redis**).
   Connecting it injects `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`.
4. Add the rest under **Settings > Environment Variables**:

   | Variable | Required | Notes |
   |---|---|---|
   | `GEMINI_API_KEY` | For voice | Without it, typing still works |
   | `GEMINI_MODEL` | No | Defaults to `gemini-3.8-flash` |
   | `UPSTASH_REDIS_REST_URL` | **Yes in production** | Else the limit is not enforced |
   | `UPSTASH_REDIS_REST_TOKEN` | **Yes in production** | |
   | `RATE_LIMIT_SALT` | Recommended | `openssl rand -hex 32` |

5. Deploy, then open `/api/status` and confirm `"degraded": false` and
   `"configured": true`.

Redeploy after adding variables — Vercel does not apply them to an existing
build.

---

## Adding a form

This is the scaling argument, and why forms are data rather than code.

1. Create `lib/forms/your-form.ts` exporting a `FormDefinition`.
2. Add it to the array in `lib/forms/index.ts`.

That is the whole change. No UI work, no new prompts, no engine changes. A
council officer can review the question wording without reading any
TypeScript, and these objects can move to JSON, a CMS or a database later.

`lib/forms/types.ts` documents every field.

## Project structure

```
app/
  page.tsx                   form picker
  form/[id]/FormRunner.tsx   one question at a time, voice first
  form/[id]/useRecorder.ts   microphone capture and upload
  api/transcribe/route.ts    the only paid route — rate limited
  api/status/route.ts        limiter configuration and headroom
  globals.css                design tokens, print and dark mode
lib/
  ratelimit.ts               60/min global, Redis with in-memory fallback
  transcription.ts           prompt, JSON schema, audio limits
  validate.ts                the rule engine — no AI, no network
  forms/                     form definitions as data; add yours here
tests/                       36 tests
```

## Accessibility

The brief asks for the people hardest to reach, so this is not an
afterthought:

- **Typing always works**, on every question and every failure path.
- Base font 17px, line height 1.6, tap targets at least 52px; the mic button
  is 60px and full width.
- Focus is visible everywhere and never removed.
- Focus moves to the new question on navigation — without this, pressing
  Next is silent for a screen reader user.
- Recorder errors are in an `aria-live="assertive"` region; validation in a
  polite one.
- Right-to-left scripts get `lang` and `dir="auto"`, so Urdu, Arabic, Hebrew
  and Farsi render correctly even mixed with Latin-script street names.
- Microphone released as soon as recording stops, so the browser's recording
  indicator goes out.
- Print stylesheet for the offline and assisted route; the original-language
  words print too.
- Dark mode, and `prefers-reduced-motion` respected.
- No horizontal scroll at 390px (verified).

## Known gaps

Honest list, better said than asked:

- **The live recording path is untested end to end.** The build container has
  no audio device and no Gemini key, so the UI flow was verified with a
  stubbed recorder and a mocked API response. **Test on a real phone before
  the day** — this is the first thing to do.
- **Translation quality is unverified** for the languages that matter most
  here. Worth testing with a native speaker of Urdu, Polish or Romanian
  before claiming it works.
- **Two sample forms**, not real council forms.
- **Voice is not offered on multiple-choice questions.** Mapping spoken words
  onto a fixed option is a decision about someone's answer, not a
  transcription of it, so it is left to a tap.
- **No analytics**, so completion and drop-off cannot yet be measured. Those
  are the numbers that would prove this works, and they need a DPIA first.
- **The global-only limit** locks everyone out when one person floods it.

## Tech

Next.js 16 (App Router) · TypeScript · Google Gemini · Upstash Redis · plain
CSS, no framework. 0 known vulnerabilities.

Sources: [Gemini audio understanding](https://ai.google.dev/gemini-api/docs/audio) ·
[Live API ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens) ·
[Unconstrained token advisory](https://gbhackers.com/google-gemini-live-api-flaw/)
