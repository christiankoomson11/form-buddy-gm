/* ---------------------------------------------------------------------------
   Transcription: prompt, schema and limits
   ---------------------------------------------------------------------------

   One Gemini call does three things at once:

     1. Transcribe what the resident said
     2. Detect which language they said it in
     3. Translate it to English if it was not already

   Doing it in one call rather than three matters for the person waiting:
   they have just spoken into a form, and every extra round trip is another
   second of silence wondering whether it worked.

   The whole call happens server-side, which is the point. The audio goes
   browser -> our API -> Gemini, so the rate limiter sees every request and
   the API key never reaches the browser.
   --------------------------------------------------------------------------- */

/** Longest recording we accept, in seconds. Bounds both cost and upload size. */
export const MAX_RECORDING_SECONDS = 90;

/**
 * Largest audio payload we accept, in bytes.
 *
 * Gemini caps a whole request at 20MB. Opus at ~24kbps gives roughly 3KB a
 * second, so 90 seconds is about 270KB — this 8MB ceiling is far above
 * anything legitimate and exists to reject junk early, before we spend a
 * model call on it.
 */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/** MIME types we pass through to Gemini. Anything else is rejected. */
export const ACCEPTED_AUDIO_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/opus',
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'audio/wav',
  'audio/mpeg',
  'audio/mp3',
  'audio/flac',
] as const;

/**
 * Browsers label recordings with codec details, e.g.
 * "audio/webm;codecs=opus". Gemini wants the bare type.
 */
export function normaliseAudioType(raw: string): string | null {
  const base = raw.split(';')[0].trim().toLowerCase();

  // Safari's MediaRecorder produces audio/mp4; Gemini lists audio/m4a.
  if (base === 'audio/x-m4a') return 'audio/m4a';

  return (ACCEPTED_AUDIO_TYPES as readonly string[]).includes(base)
    ? base
    : null;
}

/* --- What we expect back -------------------------------------------------- */

export type Transcription = {
  /** Exactly what they said, in the language they said it in. */
  original: string;
  /** The language in English, e.g. "Urdu". "Unknown" if unclear. */
  languageName: string;
  /** BCP-47 code, e.g. "ur". Empty string if unclear. */
  languageCode: string;
  /** English version. Identical to `original` when they spoke English. */
  english: string;
  /** False when nothing intelligible was said. */
  heardSpeech: boolean;
};

/**
 * Structured output schema.
 *
 * Asking for JSON rather than parsing prose matters here: this text goes
 * straight into a form field. A model that decides to reply "Sure! Here's
 * the transcription:" would put that sentence into someone's housing repair
 * application.
 */
export const TRANSCRIPTION_SCHEMA = {
  type: 'object',
  properties: {
    original: {
      type: 'string',
      description:
        'Exactly what the speaker said, in the language they spoke. Empty string if nothing intelligible was said.',
    },
    languageName: {
      type: 'string',
      description:
        'The language spoken, named in English, e.g. "English", "Urdu", "Polish". "Unknown" if unclear.',
    },
    languageCode: {
      type: 'string',
      description: 'BCP-47 code for the language, e.g. "en", "ur", "pl". Empty string if unclear.',
    },
    english: {
      type: 'string',
      description:
        'The English translation. If they spoke English, repeat the original exactly.',
    },
    heardSpeech: {
      type: 'boolean',
      description: 'False if the audio contained no intelligible speech.',
    },
  },
  required: ['original', 'languageName', 'languageCode', 'english', 'heardSpeech'],
} as const;

/* --- The prompt ----------------------------------------------------------- */

/**
 * Built per question, so the model knows what it is listening for. Knowing
 * the question is what lets it tell "fourteen Example Road" from "40 Example
 * Road" when the question is asking for an address.
 */
export function transcriptionPrompt(context: {
  formTitle: string;
  questionLabel: string;
  questionHelp?: string;
}): string {
  return `
You are transcribing a short spoken answer to one question on a form for a
public service in Greater Manchester, England.

The form is: ${context.formTitle}
The question they were answering is: ${context.questionLabel}
${context.questionHelp ? `Guidance shown with the question: ${context.questionHelp}` : ''}

Do exactly this:

1. Write down what they said, word for word, in the language they said it in.
2. Name that language in English, and give its BCP-47 code.
3. Give an English translation. If they spoke English, repeat it exactly.

Rules that matter more than being helpful:

- Transcribe what they ACTUALLY said. Never add, complete, tidy or infer.
  If they trailed off mid-sentence, the transcript trails off mid-sentence.
- Never answer the question yourself. You are writing down their words, not
  helping them fill the form.
- Do not correct their grammar, their phrasing or their facts. These are
  their own words going onto their own application. A "tidied" answer is no
  longer theirs.
- Keep British spellings and British terms.
- Write numbers, dates and addresses the way a person would on a form:
  "14 Example Road", "2 November 2025", "07700 900123".
- Expect accents, dialects, and languages other than English. Greater
  Manchester has a very mixed population and this tool exists for the people
  other systems fail. Do your best with unclear audio.
- If you genuinely cannot make out a word, write [unclear] in its place
  rather than guessing. A visible gap is honest; a confident wrong word gets
  copied onto a real application.
- If there is no intelligible speech at all, set heardSpeech to false and
  leave the text fields empty. Do not invent a plausible answer.
- Never include commentary, headings, apologies or anything you were not
  asked for. Your output goes directly into a form field.
`.trim();
}
