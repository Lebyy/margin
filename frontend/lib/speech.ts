"use client";

// Voice on the student page: dictate a message, and hear Askretes' reply.
//
// Dictation is the browser's own speech recognition. It only produces text in
// a field, and that text is then sent like any typed message, so it goes
// through the scribe, the policy, and the guard. No audio is uploaded by our
// code.
//
// Reading aloud uses the Gemini speech model through our API, with the
// browser's voice as the fallback. Either way it speaks a reply that has
// already passed the guard.
//
// One thing a later reader should know: in Chrome, the built-in recognizer
// sends the audio to Google to transcribe it. That is the browser's
// behavior, the mic button asks for permission first, and typing always
// works without it.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscribe = () => () => undefined;

/** True in a browser that can transcribe speech. False on the server and during hydration, so the mic button never flashes in and out. */
export function useCanDictate(): boolean {
  return useSyncExternalStore(noSubscribe, () => recognitionClass() !== null, () => false);
}

/** True in a browser that can speak text. */
export function useCanSpeak(): boolean {
  return useSyncExternalStore(noSubscribe, () => "speechSynthesis" in window, () => false);
}

/**
 * Dictation into one field.
 * `onText` receives the whole transcript so far each time it grows, so the field shows the words as they are heard. Pressing the button again stops it. The recognizer also stops by itself after a pause, and `listening` follows that.
 */
export function useDictation(onText: (text: string) => void): { listening: boolean; toggle: () => void } {
  const [listening, setListening] = useState(false);
  const active = useRef<Recognition | null>(null);
  const deliver = useRef(onText);
  useEffect(() => {
    deliver.current = onText;
  }, [onText]);
  useEffect(() => () => active.current?.stop(), []);

  const toggle = useCallback(() => {
    if (active.current) {
      active.current.stop();
      return;
    }
    const Impl = recognitionClass();
    if (!Impl) return;
    const rec = new Impl();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i += 1) text += e.results[i][0].transcript;
      deliver.current(text);
    };
    const done = () => {
      active.current = null;
      setListening(false);
    };
    rec.onend = done;
    rec.onerror = done;
    active.current = rec;
    setListening(true);
    rec.start();
  }, []);

  return { listening, toggle };
}

let playing: HTMLAudioElement | null = null;
/** Bumped by every new speak and every stop. A clip that finishes loading after that checks this and stays silent. */
let turn = 0;

/** Splits a reply into pieces of a sentence or two. The speech model takes a few seconds per request however short the text, so one request for a whole reply meant a long silence before any sound. */
function pieces(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text];
  const out: string[] = [];
  for (const sentence of sentences) {
    const last = out[out.length - 1];
    if (last !== undefined && (last + sentence).length < 180) out[out.length - 1] = last + sentence;
    else out.push(sentence);
  }
  return out.map((p) => p.trim()).filter(Boolean);
}

/**
 * Reads text aloud, replacing anything still being spoken. A second reply should not queue behind the first.
 *
 * The voice is the Gemini speech model, fetched through our API. `fetchSpeech` is passed in so this file does not import the API client. The reply is cut into short pieces that are all requested at once and played in order, so the first words start after one short request while the rest are still arriving. If the first piece fails, the browser's own voice reads the whole reply, so read-aloud never silently does nothing.
 */
export async function speak(text: string, fetchSpeech?: (text: string) => Promise<{ mimeType: string; base64: string }>): Promise<void> {
  if (typeof window === "undefined") return;
  stopSpeaking();
  const mine = turn;
  if (fetchSpeech) {
    const clips = pieces(text).map((piece) => fetchSpeech(piece).catch(() => null));
    const first = await clips[0];
    if (first && mine === turn) {
      for (const clip of clips) {
        const audio = await clip;
        if (mine !== turn) return;
        if (!audio) continue;
        playing = new Audio(`data:${audio.mimeType};base64,${audio.base64}`);
        try {
          await playing.play();
          await new Promise<void>((done) => {
            if (!playing) return done();
            playing.onended = () => done();
            playing.onpause = () => done();
          });
        } catch {
          return;
        }
      }
      return;
    }
    if (mine !== turn) return;
  }
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  turn += 1;
  playing?.pause();
  playing = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
