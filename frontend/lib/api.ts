// Every request the two screens make, in one file.
//
// The shapes below are the JSON the Express routes return, field for field.
// There is no answer-key field on any of them, and no route sends the canary
// marker. The turn reply may say canary: "absent", which is the drawer's word
// for a clean check, not the marker. A type here that grew the marker as a
// value would be the first sign a route had started leaking it.
//
// Nothing in this file computes a statistic. A percent on screen is the
// number in the response body. The pages format it and do not recompute it.

/** Where the Express API listens. The dev server is on 3000 and the API on 4000, and the API's CORS allows only that origin. */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

export type HintLevel = 1 | 2 | 3;

export type StruggleType = "misconception" | "stuck_starting" | "syntax_or_mechanics" | "careless_error" | "none";

/** The student-safe assignment. The server builds it from an inclusion list. */
export type Assignment = {
  id: string;
  course_name: string;
  title: string;
  prompt: string;
  notes: string;
  concepts: string[];
  hint_ceiling: number;
};

export type AssignmentListItem = { id: string; course_name: string; title: string };

export type GuardVerdict = {
  leaks: boolean;
  severity: "none" | "partial" | "full";
  /** Already scrubbed of the key and the canary by the server. The drawer shows it as received. */
  reason: string;
  layer: "deterministic" | "judge" | "fallback";
};

/** The reply to one student turn. */
export type TurnReply = {
  reply: string;
  level: HintLevel;
  verdict: GuardVerdict;
  retries: number;
  /**
   * Set only when the reply and the verdict reason do not carry the canary.
   * The drawer prints the word "absent". The marker itself is never a value here.
   */
  canary?: "absent";
  /** The privacy receipt: how many emails, phone numbers, or ids were removed before the model saw the message, and that the name was not sent. */
  sent: { redactions: number; name_sent: boolean };
  /** The scribe's read of the student's message. `answer_request` is shown only in the debug drawer, never in the chat or the progress panel. */
  label: { concept: string; attempt_made: boolean; struggle_type: StruggleType; answer_request: boolean };
};

/** Where the mistake is on the photo, in 0-to-1 units from the top left of the image that was sent. */
export type PhotoBox = { x: number; y: number; w: number; h: number };

/**
 * The reply to a photo of the student's work (snap-your-work). `question`
 * already passed the server's guard. `level` is the session's level, which a
 * photo does not change. Any failure is a 501 `vision_unavailable` instead.
 */
export type PhotoReply = { step: string; box: PhotoBox; question: string; level: HintLevel };

/**
 * Revision cards for one concept (D-R4). The server wrote them from the
 * professor's notes and ran the guard's check on each one. `concept` is null
 * when the student has not struggled with anything yet.
 */
export type Flashcards = { concept: string | null; cards: { front: string; back: string }[] };

export type SessionStart = { session_id: string; student_id: string; assignment_id: string; level: HintLevel };

export type SessionMessages = {
  session_id: string;
  student_id: string;
  assignment_id: string;
  level: HintLevel;
  messages: { role: "student" | "tutor"; content: string; hint_level: number | null }[];
};

export type ProgressLabel = {
  assignment_id: string;
  session_id: string;
  concept: string;
  struggle_type: StruggleType;
  attempt_made: boolean;
  demonstrated_understanding: boolean;
  evidence: string;
  hint_level: number | null;
  created_at: string;
};

export type StudentProgress = {
  student_id: string;
  sessions: { session_id: string; assignment_id: string; assignment_title: string; current_level: number; created_at: string }[];
  labels: ProgressLabel[];
};

export type ConceptSummary = {
  concept: string;
  students_struggling: number;
  percent_struggling: number;
  turns: number;
  struggle_types: Record<StruggleType, number>;
};

export type ClassSummary = {
  assignment_id: string;
  total_students: number;
  total_turns: number;
  concepts: ConceptSummary[];
};

export type StudentSummary = {
  student_id: string;
  display_name: string;
  concept: string | null;
  struggle_type: StruggleType;
  last_hint_level: number | null;
  turns: number;
};

export type Roster = {
  assignment_id: string;
  students: StudentSummary[];
  guard: { answer_requests: number; drafts_held: number; replies: number };
};

export type TranscriptTurn = {
  session_id: string;
  role: "student" | "tutor";
  content: string;
  hint_level: number | null;
  guard: { leaks: boolean; severity: "none" | "partial" | "full"; layer: "deterministic" | "judge" | "fallback" } | null;
  retries: number;
  label: { concept: string; struggle_type: StruggleType; attempt_made: boolean } | null;
  created_at: string;
};

export type Transcript = { student_id: string; display_name: string; turns: TranscriptTurn[] };

export type ThursdayCard = {
  card_id: string;
  generated_at: string;
  concept: string;
  percent_struggling: number;
  students_struggling: number;
  total_students: number;
  struggle_types: Record<StruggleType, number>;
  headline: string;
  reteach_note: string;
  practice_problems: string[];
};

export type ProfessorMessage = { id: string; body: string; created_at: string };

/** What the setup form posts. `answer_key` is left out on an edit to keep the stored key. */
export type AssignmentForm = {
  id?: string;
  course_name: string;
  title: string;
  prompt: string;
  answer_key?: string;
  notes: string;
  concepts: string[];
  hint_ceiling: number;
};

/**
 * A response the API answered with an error status.
 * `code` is the server's fixed error word, such as `no_struggles_yet`. The pages branch on it, because a 409 before anyone has struggled is an ordinary state to describe and not a failure to alarm about.
 */
export class ApiError extends Error {
  status: number;
  code: string;
  issues: { path: string; message: string }[];
  constructor(status: number, code: string, issues: { path: string; message: string }[] = []) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

/**
 * One JSON request.
 * A failed connection becomes `api_unreachable`, so a page can say the API is not running instead of showing a stack trace. `cache: "no-store"` is set because every screen shows live records, and a cached class summary would show yesterday's percent as today's.
 */
async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "api_unreachable");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; issues?: { path: string; message: string }[] };
    throw new ApiError(res.status, err.error ?? "request_failed", err.issues ?? []);
  }
  return data as T;
}

const q = (id: string) => encodeURIComponent(id);

export const api = {
  health: () => request<{ ok: boolean; db: string }>("GET", "/health"),
  listAssignments: () => request<{ assignments: AssignmentListItem[] }>("GET", "/api/assignments"),
  assignment: (id: string) => request<Assignment>("GET", `/api/assignments/${q(id)}`),
  profAssignment: (id: string) => request<Assignment & { has_answer_key: boolean }>("GET", `/api/prof/assignments/${q(id)}`),
  /** The body is sent as JSON. The key is never placed in a URL, where it would land in history and server logs. */
  saveAssignment: (form: AssignmentForm) => request<{ _id: string }>("POST", "/api/prof/assignments", form),
  startSession: (assignmentId: string, who: { student_id: string } | { display_name: string }) =>
    request<SessionStart>("POST", "/api/sessions", { assignment_id: assignmentId, ...who }),
  sessionMessages: (sessionId: string) => request<SessionMessages>("GET", `/api/sessions/${q(sessionId)}/messages`),
  /** `attempt` is sent only when the student wrote one. There is no flag that claims an attempt. The server's scribe reads the words. */
  sendTurn: (sessionId: string, text: string, attempt?: string) =>
    request<TurnReply>("POST", `/api/sessions/${q(sessionId)}/messages`, attempt ? { text, attempt } : { text }),
  /** The photo as base64 without a data: prefix, in the type it was encoded as. */
  sendPhoto: (sessionId: string, image: { mimeType: string; base64: string }) =>
    request<PhotoReply>("POST", `/api/sessions/${q(sessionId)}/messages`, { image }),
  /** Without `concept`, the server picks this student's weakest concept from their own labels. */
  flashcards: (studentId: string, assignmentId: string, concept?: string) =>
    request<Flashcards>(
      "GET",
      `/api/students/${q(studentId)}/flashcards?assignment_id=${q(assignmentId)}${concept ? `&concept=${q(concept)}` : ""}`,
    ),
  progress: (studentId: string) => request<StudentProgress>("GET", `/api/students/${q(studentId)}/progress`),
  classSummary: (assignmentId: string) => request<ClassSummary>("GET", `/api/prof/class-summary?assignment_id=${q(assignmentId)}`),
  roster: (assignmentId: string) => request<Roster>("GET", `/api/prof/students?assignment_id=${q(assignmentId)}`),
  transcript: (studentId: string, assignmentId: string) =>
    request<Transcript>("GET", `/api/prof/students/${q(studentId)}/transcript?assignment_id=${q(assignmentId)}`),
  thursdayCard: (assignmentId: string) => request<ThursdayCard>("GET", `/api/prof/thursday-card?assignment_id=${q(assignmentId)}`),
  generateThursdayCard: (assignmentId: string) =>
    request<ThursdayCard>("POST", `/api/prof/thursday-card?assignment_id=${q(assignmentId)}`),
  profMessages: (assignmentId: string) =>
    request<{ assignment_id: string; messages: ProfessorMessage[] }>("GET", `/api/prof/messages?assignment_id=${q(assignmentId)}`),
};

/** `base_case` reads as "base case" on screen. The stored name is unchanged, since it is the scribe's vocabulary. */
export function conceptLabel(concept: string): string {
  return concept.replace(/_/g, " ");
}

/** The struggle types in the words a student or a professor would use. `none` is "no struggle", never a blank. */
export const STRUGGLE_LABEL: Record<StruggleType, string> = {
  misconception: "misconception",
  stuck_starting: "stuck starting",
  syntax_or_mechanics: "syntax or mechanics",
  careless_error: "careless error",
  none: "no struggle",
};

/** The three rungs, named as the hint ladder names them. */
export const LEVEL_NAME: Record<HintLevel, string> = { 1: "Nudge", 2: "Pointer", 3: "Similar example" };
export const LEVEL_HELP: Record<HintLevel, string> = {
  1: "One guiding question.",
  2: "Where in your professor's notes to look.",
  3: "A worked example of a different problem.",
};
