'use client';

/* ---------------------------------------------------------------------------
   Microphone recording
   ---------------------------------------------------------------------------

   Records a short answer and posts it to /api/transcribe.

   Deliberately plain: MediaRecorder, one blob, one POST. No streaming, no
   WebSocket, no audio worklet. Everything goes through our own API so the
   rate limiter sees it and the API key stays on the server.

   Browser support is the thing that actually breaks this in the field, so
   every failure path below ends somewhere useful rather than in a dead end —
   typing is always available.
   --------------------------------------------------------------------------- */

import { useCallback, useEffect, useRef, useState } from 'react';

import { MAX_RECORDING_SECONDS } from '@/lib/transcription';

export type TranscriptionResult = {
  original: string;
  english: string;
  languageName: string;
  languageCode: string;
  isEnglish: boolean;
};

export type RecorderStatus =
  | 'idle'
  | 'requesting'   // waiting on the browser permission prompt
  | 'recording'
  | 'transcribing'
  | 'error';

/**
 * Pick a container the browser can record AND the API accepts.
 * Chrome and Firefox give webm/opus; Safari gives mp4.
 */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];

  return candidates.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

export function isRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export function useRecorder(formId: string) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  /**
   * Live input loudness, 0–1, sampled from the microphone.
   *
   * This drives the ring around the mic button. It matters more than it
   * looks: the commonest way voice input fails in the field is a muted or
   * dead microphone, and without feedback the person talks for thirty
   * seconds into nothing and only finds out at the end. A ring that does
   * not move is a fault they can see immediately.
   */
  const [level, setLevel] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((blob: Blob | null) => void) | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  /** Release the microphone. Leaving it open keeps the browser's recording
   *  indicator lit, which is alarming and reads as surveillance. */
  const cleanup = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // Close the AudioContext too — browsers cap how many can exist, and
    // leaking one per recording eventually breaks the feature silently.
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    setLevel(0);

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  /**
   * Watch the input loudness via an AnalyserNode.
   *
   * Uses RMS rather than peak so the ring follows the shape of speech
   * instead of twitching on every consonant, and a gentle curve so a
   * normal speaking voice uses most of the range — raw RMS from a phone
   * mic sits low enough that the ring would barely move.
   */
  const watchLevel = useCallback((stream: MediaStream) => {
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;

      const ctx = new Ctx();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);

      const buffer = new Float32Array(analyser.fftSize);

      const sample = () => {
        analyser.getFloatTimeDomainData(buffer);

        let sum = 0;
        for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);

        setLevel(Math.min(1, Math.pow(rms * 7, 0.7)));
        rafRef.current = requestAnimationFrame(sample);
      };

      rafRef.current = requestAnimationFrame(sample);
    } catch {
      // No analyser is survivable — the button still records, the ring
      // just sits still. Not worth failing the recording over.
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    setSeconds(0);

    if (!isRecordingSupported()) {
      setStatus('error');
      setError(
        'This browser cannot record audio. You can type your answer instead.',
      );
      return;
    }

    setStatus('requesting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      setStatus('error');

      // Distinguish "said no" from "no microphone", because the fix differs.
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setError(
          'We do not have permission to use your microphone. You can allow it in your browser settings, or type your answer instead.',
        );
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setError(
          'We could not find a microphone on this device. You can type your answer instead.',
        );
      } else {
        setError(
          'We could not start recording. You can type your answer instead.',
        );
      }
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || mimeType || 'audio/webm',
      });
      cleanup();
      resolveRef.current?.(blob);
      resolveRef.current = null;
    };

    recorder.start();
    setStatus('recording');
    watchLevel(stream);

    // Count up, and stop ourselves at the ceiling so a forgotten recording
    // cannot run until the tab is closed.
    tickRef.current = setInterval(() => {
      setSeconds((previous) => {
        const next = previous + 1;
        if (next >= MAX_RECORDING_SECONDS && recorderRef.current?.state === 'recording') {
          recorderRef.current.stop();
        }
        return next;
      });
    }, 1000);
  }, [cleanup, watchLevel]);

  /**
   * Stop recording and transcribe. Resolves with the result, or null if
   * something went wrong — in which case `error` holds a message for the
   * resident.
   */
  const stopAndTranscribe = useCallback(
    async (questionId: string): Promise<TranscriptionResult | null> => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        cleanup();
        setStatus('idle');
        return null;
      }

      const blob = await new Promise<Blob | null>((resolve) => {
        resolveRef.current = resolve;
        recorder.stop();
      });

      if (!blob || blob.size === 0) {
        setStatus('error');
        setError('That recording was empty. Please try again.');
        return null;
      }

      setStatus('transcribing');

      try {
        const body = new FormData();
        body.append('audio', blob, 'answer.webm');
        body.append('formId', formId);
        body.append('questionId', questionId);

        const response = await fetch('/api/transcribe', { method: 'POST', body });
        const data = await response.json();

        if (!response.ok) {
          // Covers 429 from the rate limiter, 503 with no API key, and 422
          // when nothing intelligible was said.
          setStatus('error');
          setError(data.error ?? 'That did not work. You can type your answer instead.');
          return null;
        }

        setStatus('idle');
        return data as TranscriptionResult;
      } catch {
        setStatus('error');
        setError(
          'We could not reach the server. Check your connection, or type your answer instead.',
        );
        return null;
      }
    },
    [formId, cleanup],
  );

  /** Abandon a recording without transcribing it. */
  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      resolveRef.current = null;
      recorder.onstop = null;
      recorder.stop();
    }
    cleanup();
    setStatus('idle');
    setSeconds(0);
  }, [cleanup]);

  const dismissError = useCallback(() => {
    setError(null);
    setStatus('idle');
  }, []);

  return {
    status,
    error,
    seconds,
    level,
    start,
    stopAndTranscribe,
    cancel,
    dismissError,
    supported: isRecordingSupported(),
  };
}
