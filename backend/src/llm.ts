// The only file that imports the Gemini SDK.
// Guard, scribe, and coach call completeJson. Vision calls it too, because a photo still has to come back as JSON.
// The tutor does not. tutor.ts calls createDeepAgent. Importing the SDK from that file would make two model doors, and the identity strip would be optional on one of them.

import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";

/**
 * Strong model, for a photo and for the tutor's model id.
 * Gemini 4 Carbon is the strongest model on the current model page, and it accepts text and images. The 2.5 pro id is deprecated.
 * Pointing vision at the fast model would judge a handwritten page with the model we picked for a short JSON label.
 */
export const STRONG_MODEL = "gemini-4-carbon";

/**
 * Fast model, for the guard judge and the scribe.
 * Gemini 3.8 Flash is the current intelligent Flash model, and it is the cheap call that can still judge a draft. The 2.5 flash id is deprecated.
 * The guard runs on every draft, so the Carbon model would put a long pause in front of every hint.
 */
export const FAST_MODEL = "gemini-3.8-flash";

/**
 * The tutor's model. It is the fast model.
 * The student waits on three calls in a row: the scribe, the tutor, and the guard's judge, and nothing can be shown before the judge has read the whole draft. On the strong model the tutor alone took 20 to 45 seconds and sometimes hit the turn timeout, so the student got an error instead of a hint. A hint is at most four sentences, and the guard checks it either way, so the speed is worth more here than the stronger model.
 * Vision stays on the strong model, because reading a photo of handwriting is where it earns its time.
 */
export const TUTOR_MODEL = FAST_MODEL;

/**
 * Where those two models live. Carbon returns 404 from us-central1. That 404 is the region, not a missing model.
 * Dropping this sends the next call to a regional host the project cannot use.
 */
export const MODEL_LOCATION = "global";

/** The Cloud project that holds the express key. The SDK puts this in the Agent Platform path. */
export const CLOUD_PROJECT = "project-9f1acacd-fa08-4a3e-9e0";

/**
 * The host the express key can call.
 * generativelanguage.googleapis.com is AI Studio. This key is rejected there with 402, because the trial credit does not cover that host.
 */
export const AGENT_PLATFORM_HOST = "https://aiplatform.googleapis.com";

/**
 * The base URL and version string for a client that builds `.../models/<id>:generateContent` itself.
 * ChatGoogleGenerativeAI does that, and its default host is AI Studio. The project and `global` have to sit in front of `models/`, or Carbon 404s as if the model were missing.
 * tutor.ts is the only caller. A second copy of this path would let one client drift back to a regional host.
 */
export function agentPlatformRequest(): { baseUrl: string; apiVersion: string } {
  return {
    baseUrl: AGENT_PLATFORM_HOST,
    apiVersion: `v1/projects/${CLOUD_PROJECT}/locations/${MODEL_LOCATION}/publishers/google`,
  };
}

/**
 * How much the model reasons before it answers, per role.
 * By default the fast model thinks first, and that roughly doubles each call: about 6.5 seconds against 3.2 for the same one-sentence question, measured on 2026-11-14. The student waits on three calls in a row, so the default cost them ten seconds a turn.
 * The guard's judge keeps a little thinking, because it is the last check before a draft is shown and a paraphrased leak takes a moment's thought to see. The scribe, the coach, the study cards, and the tutor write short structured or four-sentence answers and get none.
 * Vision is left at the model's default.
 */
export const NO_THINKING = { thinkingBudget: 0 } as const;
const JUDGE_THINKING = { thinkingLevel: ThinkingLevel.LOW } as const;

/**
 * Who is asking. There is no tutor role. Adding one would route the tutor through this file.
 * The coach has its own name so a later change to the scribe's model does not silently move the Thursday card with it.
 */
export type ModelRole = "guard" | "scribe" | "coach" | "study" | "look" | "vision";

/**
 * How long one model request may take, in milliseconds.
 * The student waits on the scribe, then the tutor, then the judge, and nothing is streamed. Without a limit a stalled request holds the reply open until the browser gives up.
 * A timeout is thrown as a provider error. The guard reads that as a leak and the scribe as the closed label, so a slow model holds the draft instead of releasing it.
 */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Vision uses the strong model. Guard, scribe, and coach use the fast one.
 * A later default of the strong model for every role would spend the guard's budget on the slow model, on every turn.
 */
export function modelFor(role: ModelRole): string {
  return FAST_MODEL;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Ten digits, so a slide range like 12-16 is too short to match. An empty separator still matches a bare 10-digit run.
const PHONE = /(?:\+\d{1,3}[\s.-]*)?(?:\(\d{3}\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}/g;

// Student ids and other long numbers. Lecture 7 and slides 12-16 are shorter than this, so the citation survives.
const LONG_ID = /\d{6,}/g;

/**
 * Removes email addresses, phone numbers, and long numeric ids from text that is about to be sent.
 * The attempt itself stays, because the hint is about that work. The name is not a parameter of completeJson, so this function never receives display_name unless a caller pastes it into the prose.
 * Running this after the SDK call would mean the address had already left the process.
 */
export function stripIdentity(text: string): string {
  return text.replace(EMAIL, "[redacted]").replace(PHONE, "[redacted]").replace(LONG_ID, "[redacted]");
}

/**
 * How many pieces of identity stripIdentity would remove from this text.
 * The student page shows this count as a receipt: "1 detail removed before the model saw your message". It is counted with the same three patterns, in the same order, so the receipt cannot claim a removal the strip did not make.
 */
export function countIdentity(text: string): number {
  let count = 0;
  const tally = () => {
    count += 1;
    return "[redacted]";
  };
  text.replace(EMAIL, tally).replace(PHONE, tally).replace(LONG_ID, tally);
  return count;
}

/** The model answered, and the answer is not the schema. Retry once, then this error. The message does not include the payload, because the guard's prompt contains the answer key. */
export class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadError";
  }
}

/** What the tests pass in place of the SDK. Production leaves this unset, and completeJson calls Gemini. */
export type TextGenerator = (input: { model: string; system: string; user: string }) => Promise<string>;

export type CompleteJsonInput<T> = {
  role: ModelRole;
  schema: z.ZodType<T>;
  system: string;
  user: string;
  /** A photo, base64, without a data: prefix. Present only for vision. */
  image?: { mimeType: string; base64: string };
  generate?: TextGenerator;
};

/**
 * Sends one JSON request and parses it with the caller's schema.
 * A bad payload is tried once more, then thrown. A provider error is not retried here, so a missing key stays a missing key.
 * Swallowing the second failure would let a non-JSON draft continue, which is how a parse error becomes a student-facing reply.
 */
export async function completeJson<T>(input: CompleteJsonInput<T>): Promise<T> {
  // `look` is a picture on the fast model: Margin glancing at something on the student's canvas while they wait. The strong model took over 20 seconds on that and hit the request timeout. `vision` stays on the strong model for snap-your-work, where one mistake has to be found in handwriting.
  // Every role is on the fast model now, pictures included. The strong model took 20 to 45 seconds and timed out in front of students, and a student who waits that long has stopped reading. STRONG_MODEL stays defined so the id is in one place if a role ever needs it again.
  const model = modelFor(input.role);
  const system = stripIdentity(input.system);
  const user = stripIdentity(input.user);
  const generate = input.generate ?? ((request) => generateWithGemini(request, input.schema, input.image, input.role));

  try {
    return readPayload(await generate({ model, system, user }), input.schema);
  } catch (error) {
    if (!(error instanceof PayloadError)) throw error;
  }

  try {
    return readPayload(await generate({ model, system, user }), input.schema);
  } catch (error) {
    if (error instanceof PayloadError) {
      throw new PayloadError("completeJson: the model payload did not match the schema after one retry");
    }
    throw error;
  }
}

/**
 * Parses the model text and checks it against the schema.
 * A fenced JSON object is still the object. Prose is a payload error.
 * Accepting prose would let the guard treat a sentence as a verdict.
 */
function readPayload<T>(text: string, schema: z.ZodType<T>): T {
  const body = unwrapFence(text);
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new PayloadError("completeJson: the model payload was not JSON");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PayloadError("completeJson: the model payload did not match the schema");
  }
  return parsed.data;
}

function unwrapFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

/**
 * The production generator. Tests never call this.
 * The key is LLM_API_KEY, sent to the Agent Platform. The AI Studio host rejects this key with 402, because the trial credit does not cover that host.
 * Constructing the client without vertexai, or with a regional location, spends a call on an endpoint that cannot answer.
 */
async function generateWithGemini<T>(
  request: { model: string; system: string; user: string },
  schema: z.ZodType<T>,
  image: { mimeType: string; base64: string } | undefined,
  role: ModelRole,
): Promise<string> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error("LLM_API_KEY is empty");
  }

  const ai = new GoogleGenAI({
    vertexai: true,
    apiKey,
    project: CLOUD_PROJECT,
    location: MODEL_LOCATION,
    httpOptions: { timeout: REQUEST_TIMEOUT_MS },
  });
  const response = await ai.models.generateContent({
    model: request.model,
    contents: image
      ? [
          {
            role: "user",
            parts: [
              { text: request.user },
              { inlineData: { mimeType: image.mimeType, data: image.base64 } },
            ],
          },
        ]
      : request.user,
    config: {
      systemInstruction: request.system,
      responseMimeType: "application/json",
      responseJsonSchema: responseSchema(schema),
      ...(role === "vision" ? {} : { thinkingConfig: role === "guard" ? JUDGE_THINKING : NO_THINKING }),
    },
  });

  return response.text ?? "";
}

/** Zod's JSON schema, without the draft header the Gemini API does not ask for. */
function responseSchema(schema: z.ZodType): unknown {
  const json = z.toJSONSchema(schema);
  if (json && typeof json === "object" && "$schema" in json) {
    const { $schema: _schema, ...rest } = json;
    return rest;
  }
  return json;
}

/**
 * The image model. This is the Gemini Flash image model, the one people call Nano Banana.
 * Verified on this project on 2026-11-14 by calling it on the global path: it returned a PNG. `gemini-3-pro-image` also answered and is slower. Do not swap in an id that has not been called.
 */
export const IMAGE_MODEL = "gemini-3.1-flash-image";

/**
 * The speech model. Verified the same day the same way: it returned audio/wav, which a browser plays as is.
 * The older TTS ids answer too, but with raw PCM that needs a header written around it before anything can play it.
 */
export const TTS_MODEL = "gemini-3.8-flash-tts";

/** Pictures and speech take longer than a JSON label, so they get their own limit. Past this the student has moved on. */
const MEDIA_TIMEOUT_MS = 45_000;

type MediaPart = { mimeType: string; base64: string };

/**
 * One request that returns a file: a picture or a clip of speech.
 * It is here, beside completeJson, so the identity strip and the Agent Platform path stay in the one file that talks to Gemini. Any failure returns null, and the caller shows what it had without the file.
 */
async function generateMedia(model: string, text: string, generationConfig: Record<string, unknown>): Promise<MediaPart | null> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return null;
  const { baseUrl, apiVersion } = agentPlatformRequest();
  try {
    const res = await fetch(`${baseUrl}/${apiVersion}/models/${model}:generateContent`, {
      method: "POST",
      // The key goes in a header, not the URL, so it cannot end up in a logged request line.
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: stripIdentity(text) }] }], generationConfig }),
      signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[] };
    const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    return part ? { mimeType: part.mimeType, base64: part.data } : null;
  } catch {
    return null;
  }
}

/** A picture drawn from a text description, or null. */
export function generateImage(description: string): Promise<MediaPart | null> {
  return generateMedia(IMAGE_MODEL, description, { responseModalities: ["TEXT", "IMAGE"] });
}

/** Text read aloud in one warm voice, as a WAV file, or null. */
export function generateSpeech(text: string): Promise<MediaPart | null> {
  // Only the words to speak are sent. A styling sentence in front of them was read aloud along with the reply, since the speech model speaks whatever text it is given.
  return generateMedia(TTS_MODEL, text, {
    responseModalities: ["AUDIO"],
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
  });
}
