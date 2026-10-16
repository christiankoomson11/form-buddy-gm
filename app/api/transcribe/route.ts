/* ---------------------------------------------------------------------------
   POST /api/transcribe
   ---------------------------------------------------------------------------

   The only route that costs money, so the only route that is rate limited.

   Order of operations is deliberate:

     1. Parse and validate the upload (type, size)
     2. CHECK THE RATE LIMIT          <-- before any model call
     3. Send the audio to Gemini
     4. Return transcript + language + English translation

   Step 2 sits before step 3 so a flood costs us Redis reads, which are
   effectively free, rather than model calls on audio, which are not.

   This is also why the architecture is record-and-send rather than Gemini's
   Live streaming API. Live would have the browser stream audio straight to
   Google over a WebSocket, which Vercel's serverless functions cannot proxy
   — and that path would bypass this limiter entirely. Here every byte of
   audio passes through this function, so the 60/min ceiling is real.
   --------------------------------------------------------------------------- */

import { GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';

import {
  checkRateLimit,
  rateLimitHeaders,
  visitorKeyFromHeaders,
} from '@/lib/ratelimit';
import { getForm } from '@/lib/forms';
import {
  MAX_AUDIO_BYTES,
  TRANSCRIPTION_SCHEMA,
  normaliseAudioType,
  transcriptionPrompt,
  type Transcription,
} from '@/lib/transcription';

export const runtime = 'nodejs';

/** Audio uploads are bigger than the default body cap. */
export const maxDuration = 60;

/*
 * A general multimodal model, not the dedicated `gemini-3.5-transcribe`.
 * We need three things from one call — transcript, language detection and
 * an English translation, returned as JSON against a schema — and a
 * speech-to-text-only model gives you the first of those. If you only ever
 * needed English, switching GEMINI_MODEL to gemini-3.5-transcribe would be
 * cheaper and faster.
 */
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  /* --- 1. Parse and validate -------------------------------------------- */

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad('Could not read that recording.');
  }

  const audio = form.get('audio');
  const formId = String(form.get('formId') ?? '');
  const questionId = String(form.get('questionId') ?? '');

  if (!(audio instanceof File)) {
    return bad('No recording was attached.');
  }

  const definition = getForm(formId);
  if (!definition) return bad('Unknown form.', 404);

  const question = definition.questions.find((q) => q.id === questionId);
  if (!question) return bad('Unknown question.', 404);

  if (audio.size === 0) {
    return bad('That recording was empty. Please try again.');
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return bad(
      'That recording is too long. Please record it in shorter pieces.',
      413,
    );
  }

  const mimeType = normaliseAudioType(audio.type);
  if (!mimeType) {
    return bad(
      `This browser recorded in a format we cannot read (${audio.type || 'unknown'}). You can type your answer instead.`,
      415,
    );
  }

  /* --- 2. Rate limit ----------------------------------------------------- */

  const visitorKey = await visitorKeyFromHeaders(request.headers);
  const limit = await checkRateLimit(visitorKey);

  if (!limit.success) {
    const retryAfter = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));

    /*
     * This message has to work for a resident, not a developer. Someone who
     * hits it is mid-way through a form and has just spoken into their
     * phone. "429 Too Many Requests" tells them nothing. So: what happened,
     * how long to wait, and that typing still works — because it does.
     */
    return NextResponse.json(
      {
        error: `A lot of people are using this right now. Please wait about ${retryAfter} seconds and try recording again. You can type your answer instead if you would rather not wait.`,
        retryAfter,
        scope: limit.scope,
      },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  /* --- 3. Transcribe ----------------------------------------------------- */

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'Voice input is not switched on in this deployment. You can type your answer instead.',
      },
      { status: 503, headers: rateLimitHeaders(limit) },
    );
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const bytes = Buffer.from(await audio.arrayBuffer());

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: bytes.toString('base64') } },
          ],
        },
      ],
      config: {
        systemInstruction: transcriptionPrompt({
          formTitle: definition.title,
          questionLabel: question.label,
          questionHelp: question.help,
        }),
        responseMimeType: 'application/json',
        responseJsonSchema: TRANSCRIPTION_SCHEMA,
        // Transcription is not a creative task. We want the same audio to
        // produce the same text every time.
        temperature: 0,
        maxOutputTokens: 2048,
      },
    });

    const raw = response.text?.trim();
    if (!raw) {
      return NextResponse.json(
        {
          error:
            'We could not make out that recording. Please try again, or type your answer.',
        },
        { status: 502, headers: rateLimitHeaders(limit) },
      );
    }

    let parsed: Transcription;
    try {
      parsed = JSON.parse(raw) as Transcription;
    } catch {
      console.error('[transcribe] model returned non-JSON', { raw: raw.slice(0, 200) });
      return NextResponse.json(
        {
          error:
            'Something went wrong reading that recording. Please try again, or type your answer.',
        },
        { status: 502, headers: rateLimitHeaders(limit) },
      );
    }

    if (!parsed.heardSpeech || !parsed.english?.trim()) {
      return NextResponse.json(
        {
          error:
            'We could not hear any speech in that recording. Check your microphone is working, move somewhere quieter if you can, and try again.',
          heardSpeech: false,
        },
        { status: 422, headers: rateLimitHeaders(limit) },
      );
    }

    const isEnglish =
      parsed.languageCode?.toLowerCase().startsWith('en') ||
      parsed.original.trim() === parsed.english.trim();

    return NextResponse.json(
      {
        original: parsed.original.trim(),
        english: parsed.english.trim(),
        languageName: parsed.languageName?.trim() || 'Unknown',
        languageCode: parsed.languageCode?.trim() ?? '',
        isEnglish,
        meta: {
          model: MODEL,
          remaining: limit.remaining,
          limit: limit.limit,
          degraded: limit.degraded,
        },
      },
      { headers: rateLimitHeaders(limit) },
    );
  } catch (error) {
    // Log for us; never leak provider errors to the resident.
    console.error('[transcribe] model call failed', {
      formId,
      questionId,
      mimeType,
      bytes: audio.size,
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error:
          'Sorry, voice input is not working at the moment. Your answers are safe and you can type instead.',
      },
      { status: 502, headers: rateLimitHeaders(limit) },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Send a POST request with an audio recording to use this endpoint.' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
