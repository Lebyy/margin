// The only file that imports the Gemini SDK.
// Guard and scribe call completeJson. Vision calls it too, because a photo still has to come back as JSON.
// The tutor does not. tutor.ts calls createDeepAgent. Importing the SDK from that file would make two model doors, and the identity strip would be optional on one of them.

import { GoogleGenAI } from "@google/genai";
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

/** Who is asking. There is no tutor role. Adding one would route the tutor through this file. */
export type ModelRole = "guard" | "scribe" | "vision";

/**
 * Vision uses the strong model. Guard and scribe use the fast one.
 * A later default of the strong model for every role would spend the guard's budget on the slow model, on every turn.
 */
export function modelFor(role: ModelRole): string {
  if (role === "vision") return STRONG_MODEL;
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
  const model = input.image ? STRONG_MODEL : modelFor(input.role);
  const system = stripIdentity(input.system);
  const user = stripIdentity(input.user);
  const generate = input.generate ?? ((request) => generateWithGemini(request, input.schema, input.image));

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
