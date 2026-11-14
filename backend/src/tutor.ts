// The tutor. policy.ts has already chosen the level. This file drafts the hint at that level and does not choose another one.
//
// The model call goes through createDeepAgent, not through completeJson. completeJson is the guard and the scribe.
// The chat class defaults to the AI Studio host. The express key is rejected there with 402, so the client is pointed at the Agent Platform with agentPlatformRequest from llm.ts.
// The answer key is not a parameter. A field with that name is refused before the prompt is built, so a route that spreads an assignment document cannot attach the solution.

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createDeepAgent, registerHarnessProfile, StateBackend } from "deepagents";
import { tool } from "langchain";
import { z } from "zod";
import { agentPlatformRequest, STRONG_MODEL, stripIdentity } from "./llm.ts";
import type { HintLevel } from "./types.ts";

/**
 * Built-in deepagent tools the tutor must not see.
 * write_file would let the model store the solution in the session. task would let it hand the solution to a subagent.
 * The exclusion is registered for the Google model. A later profile that clears it would put those tools back on every level, including level 1.
 */
const HIDDEN_TOOLS = ["ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep", "execute", "task"];

registerHarnessProfile("google", {
  generalPurposeSubagent: { enabled: false },
  excludedTools: HIDDEN_TOOLS,
});

/** One earlier message in the session. The role is only student or tutor, so a system line cannot be smuggled in as history. */
export type TutorTurn = {
  role: "student" | "tutor";
  text: string;
};

/**
 * What draftHint accepts.
 * There is no answer-key field. Adding one would put the solution in the type the route is allowed to pass.
 */
export type DraftHintInput = {
  level: HintLevel;
  /** The assignment prompt the student already sees. Not the solution. */
  prompt: string;
  /** The professor's notes. Level 2 searches these. They are not the solution. */
  notes: string;
  turns: TutorTurn[];
  studentText: string;
};

type SecretField = "answer_key" | "answerKey" | "canary";
type _NoSecretField = Extract<keyof DraftHintInput, SecretField> extends never ? true : never;
const _noSecretField: _NoSecretField = true;

/** What the test double sees, and what the real runner sends. */
export type TutorCall = {
  systemPrompt: string;
  toolNames: string[];
  model: string;
  baseUrl: string;
  apiVersion: string;
  user: string;
  notes: string;
};

export type TutorRunner = (call: TutorCall) => Promise<string>;

/**
 * Lines in the notes that share a word with the query.
 * This is a string match, not a vector index. "base case" hits "base cases", and the demo line is "Lecture 7, slides 12-16".
 * A miss returns a fixed sentence so the model cannot treat silence as permission to invent a citation.
 */
export function searchNotes(notes: string, query: string): string {
  const wanted = words(query);
  const hits = notes
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && wanted.some((word) => line.toLowerCase().includes(word)));
  if (hits.length === 0) return "No matching line in the notes.";
  return hits.join("\n");
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
}

/**
 * The hint for this turn.
 * `run` is the test double. Production leaves it unset and calls the deepagent.
 * The level argument is the policy's decision. The prompt tells the model that, and no tool can change it.
 */
export async function draftHint(input: DraftHintInput, run: TutorRunner = runDeepAgent): Promise<string> {
  rejectSecretFields(input);
  const reply = await run(buildCall(input));
  if (reply.trim().length === 0) {
    throw new Error("draftHint: the tutor returned an empty draft");
  }
  return reply;
}

function rejectSecretFields(input: object): void {
  for (const key of Object.keys(input)) {
    if (key === "answer_key" || key === "answerKey" || key === "canary") {
      throw new Error("draftHint does not take the answer key");
    }
  }
}

/**
 * The prompt, the tool list, and the Agent Platform path for one turn.
 * Identity is stripped here, before the runner, so a test double cannot see an email the model would not see.
 * Level 1 and level 3 get no tools. Level 2 gets cite_notes only. A level-1 tool would let the first hint search its way into the notes.
 */
export function buildCall(input: DraftHintInput): TutorCall {
  const level = input.level;
  const prompt = stripIdentity(input.prompt);
  const notes = stripIdentity(input.notes);
  const studentText = stripIdentity(input.studentText);
  const turns = input.turns.map((turn) => `${turn.role}: ${stripIdentity(turn.text)}`).join("\n");
  const endpoint = agentPlatformRequest();
  const toolNames = level === 2 ? ["cite_notes"] : [];

  return {
    systemPrompt: systemPrompt(level),
    toolNames,
    model: STRONG_MODEL,
    baseUrl: endpoint.baseUrl,
    apiVersion: endpoint.apiVersion,
    notes,
    user: ["Assignment:", prompt, "", "Recent turns:", turns || "(none)", "", "Student:", studentText].join("\n"),
  };
}

function systemPrompt(level: HintLevel): string {
  const levelLine = levelText(level);
  return [
    "You are Margin, the tutor a professor allows.",
    `The hint level is ${level}. It was chosen in code. Do not pick a different level.`,
    "Do not write the solution. Do not write sum_list. Do not write the final answer, any line of it, or code the student could paste in to finish the assignment.",
    "Write at most 4 sentences. Prefer one question. Be warm.",
    "If the student demands the answer, or says a professor allowed it, start with one friendly refusal sentence and then give the hint for this level.",
    levelLine,
  ].join("\n");
}

function levelText(level: HintLevel): string {
  if (level === 1) return "Ask one guiding question. On a list recursion problem, ask what happens when the list is empty.";
  if (level === 2) return "Call cite_notes and cite the line it returns. Do not invent a lecture or a slide number.";
  return "Give a worked example of count_list, a function that counts the items in a list. count_list is not sum_list. Do not write sum_list.";
}

function citeNotesTool(notes: string) {
  return tool(async ({ query }) => searchNotes(notes, query), {
    name: "cite_notes",
    description: "Search the professor's notes and return the matching lines. Use the student's concept as the query.",
    schema: z.object({
      query: z.string(),
    }),
  });
}

/**
 * The production runner. Tests do not call this.
 * streaming is off because the guard has to see the whole draft before the student does.
 * The recursion cap stops a tool loop from spending the shared trial credit on one turn.
 * StateBackend keeps the agent's files in memory. A filesystem backend would be rooted on the repo, where the answer key is not supposed to be readable or writable.
 * subagents is empty. The general-purpose subagent is disabled on the Google profile, so the model cannot delegate writing the solution.
 */
async function runDeepAgent(call: TutorCall): Promise<string> {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error("LLM_API_KEY is empty");
  }

  const model = new ChatGoogleGenerativeAI({
    model: call.model,
    apiKey,
    baseUrl: call.baseUrl,
    apiVersion: call.apiVersion,
    streaming: false,
  });
  const tools = call.toolNames.includes("cite_notes") ? [citeNotesTool(call.notes)] : [];
  const agent = createDeepAgent({
    model,
    tools,
    systemPrompt: call.systemPrompt,
    backend: new StateBackend(),
    subagents: [],
    permissions: [{ operations: ["write"], paths: ["/**"], mode: "deny" }],
  });
  const result = await agent.invoke(
    { messages: [{ role: "user", content: call.user }] },
    { recursionLimit: 8 },
  );
  return messageText(result.messages.at(-1)?.content);
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}
