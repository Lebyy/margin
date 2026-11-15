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

import { browser } from "./browser";

/** Where the Express API listens. The dev server is on 3000 and the API on 4000, and the API's CORS allows only that origin. */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000";

/** The most questions one assignment may have, question 1 included. Must equal MAX_QUESTIONS in backend/src/routes.ts. */
export const MAX_QUESTIONS = 20;

/** The longest notes paste the server saves. Must equal MAX_NOTES_CHARS in backend/src/routes.ts, or the form would allow a paste the save refuses. */
export const MAX_NOTES_CHARS = 200_000;

export type HintLevel = 1 | 2 | 3;

/** What kind of work an assignment is. A `topic` is material to learn: it has no answer key and Askretes teaches it. */
export type AssignmentKind = "code" | "written" | "math" | "topic";

export type StruggleType = "misconception" | "stuck_starting" | "syntax_or_mechanics" | "careless_error" | "none";

/** The student-safe assignment. The server builds it from an inclusion list. */
export type Assignment = {
  id: string;
  course_id: string | null;
  course_name: string;
  title: string;
  prompt: string;
  kind: AssignmentKind;
  notes: string;
  concepts: string[];
  hint_ceiling: number;
  /** Every question's prompt in order. Item 0 is `prompt`. Older servers leave it out, and the page then treats `prompt` as the only question. */
  questions?: string[];
  /** ISO time, or null for no due date. */
  due_at?: string | null;
  /** False when the professor has not turned Askretes on for this assignment. Every tutor route then answers 403. */
  margin_enabled?: boolean;
  /** True when the professor's Question PDF can be opened with `questionPdfUrl`. */
  has_question_pdf?: boolean;
};

/** What "Read PDFs" shows the professor: the questions found, and per question only whether its answer was found. Never an answer. */
export type AssignmentDraft = { draft_id: string; kind: AssignmentKind; concepts: string[]; questions: { prompt: string; has_answer: boolean }[]; missing_answers?: number };

/** One side of a new assignment (the questions, or the answer key): typed text, or one file of any kind the server reads. */
export type AssignmentSource = { text: string } | { file: { name: string; base64: string } };

/** The professor's Question PDF for an assignment, in the browser's own viewer. There is no URL for the answer key PDF: it is not kept. */
/** An attached file as it was uploaded, kept on the server. `download` asks the browser to save it. */
export function attachmentUrl(sessionId: string, attachmentId: string, download = false): string {
  return `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}${download ? "?download=1" : ""}`;
}

/** The picture of the canvas Askretes was shown on a turn. */
export function canvasPictureUrl(sessionId: string, messageId: string): string {
  return `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/canvas-picture`;
}

/** One picture that was on the canvas after Askretes' marks. */
export function boardFileUrl(sessionId: string, messageId: string, fileId: string): string {
  return `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/board-files/${encodeURIComponent(fileId)}`;
}

/** The canvas and file work on one assignment, counted in code by the server (backend work.ts). */
export type WorkSummary = {
  assignment_id: string;
  total_students: number;
  canvas: { students: number; turns: number; pictures: number };
  files: { students: number; count: number; by_kind: Record<string, number> };
  margin: { marks: number; drawings: number; writes: number; slides: number };
  concepts: { concept: string; turns: number; struggling_turns: number; students_struggling: number; percent_struggling: number }[];
  recent: {
    student_id: string;
    display_name: string;
    session_id: string;
    message_id: string;
    kind: "canvas" | "file";
    has_picture: boolean;
    file?: { id: string | null; name: string; kind: string };
    concept: string | null;
    struggle_type: StruggleType | null;
    margin: { marks: number; drawings: number; writes: number; notes: string[] };
    created_at: string;
  }[];
};

/** One line of the professor's conversation with Askretes' class analyst. Students appear as labels (S1, S2, ...); `names` maps them for display. */
export type AnalystTurn = { role: "professor" | "analyst"; content: string; tool_calls: { name: string; args: Record<string, unknown>; result: string }[]; created_at?: string };
export type AnalystNames = Record<string, { id: string; name: string }>;

/** A draft assignment the class chat made: the preview (never an answer), with the title and due date the professor asked for. */
export type ClassChatDraft = AssignmentDraft & { title: string; due_at: string | null };
export type ClassChatTurn = { role: "professor" | "analyst"; content: string; tool_calls: { name: string; args: Record<string, unknown>; result: string }[]; draft: ClassChatDraft | null };

export function questionPdfUrl(assignmentId: string): string {
  return `${API_BASE}/api/assignments/${encodeURIComponent(assignmentId)}/question-pdf`;
}

/** Not started is no session; in progress is a session; submitted is a session that pressed Submit on the last question. */
export type AssignmentStatus = "not_started" | "in_progress" | "submitted";

export type AssignmentListItem = {
  id: string;
  course_name: string;
  title: string;
  kind: AssignmentKind;
  concepts: string[];
  course_id: string | null;
  due_at?: string | null;
  margin_enabled?: boolean;
  status?: AssignmentStatus;
};

/** The accent tokens a class can use. Each is a theme token in globals.css (`--course-<name>`), never a colour value. */
export const COURSE_ACCENTS = ["red", "blue", "green", "amber", "teal", "slate"] as const;
export type CourseAccent = (typeof COURSE_ACCENTS)[number];

/** The fields every course card shows. */
export type CourseCard = { id: string; name: string; code: string; term: string; professor: string; description: string; accent: CourseAccent };

/** A class in the list: its card and how much is in it. */
export type CourseListItem = CourseCard & { assignments: number; lessons: number };

/** My courses for one student: the classes they joined, and the next five things due. */
export type MyCourses = { courses: (CourseCard & { due_this_week: number })[]; due_soon: (AssignmentListItem & { due_at: string })[] };

/** The professor's card: the class, its counts, and the weakest concept from its newest Thursday card, or null before any card. */
export type ProfCourseCard = CourseListItem & { weakest: { concept: string; percent_struggling: number | null; assignment_title: string } | null };


/** One class opened: its classroom notes, the files the professor added (stored as text), and everything to do or learn in it. */
export type Course = CourseCard & { notes: string; materials: { id: string; title: string; body: string }[]; items: AssignmentListItem[] };

/** One self-check question. The right answer is in the response, because the page checks it locally and nothing about a student's answers is stored. */
export type QuizQuestion = { concept: string; question: string; choices: string[]; answer: number; why: string };

/** What Askretes said about a picture on the canvas: one description, and up to five marks with a box each in 0-to-1 units from the picture's top left. */
export type Annotation = { description: string; marks: { label: string; note: string; box: { x: number; y: number; w: number; h: number } }[] };

export type GuardVerdict = {
  leaks: boolean;
  severity: "none" | "partial" | "full";
  /** Already scrubbed of the key and the canary by the server. The drawer shows it as received. */
  reason: string;
  layer: "deterministic" | "judge" | "fallback";
};

/** The reply to one student turn. */
/** A place on the canvas: an element by id, or a box in 0-to-1 units of the canvas picture the tutor was shown. */
export type CanvasTarget = { element?: string; box?: { x: number; y: number; w: number; h: number } };

/** One thing the tutor's tools asked the page to do. Every word in it was checked by the guard with the reply. */
export type CanvasAction =
  | { type: "diagram"; kind: "map" | "steps" | "summary"; title: string; items: { label: string; detail: string }[]; picture?: boolean; picture_id?: string }
  | { type: "mark"; target: CanvasTarget; shape: "circle" | "box" | "underline" | "arrow"; note?: string; tone?: "red" | "green" }
  | { type: "write"; text: string; latex: boolean; target?: CanvasTarget }
  | { type: "show_slide"; lecture: number; slide: number };

/** What the page tells the tutor about the canvas on a turn. `scene` is the board as shapes, sent with the picture for the professor's transcript. */
export type CanvasContext = { summary: string; image?: { mimeType: string; base64: string }; scene?: Record<string, unknown>[] };

/** A file read by the server for the next message: its id, what kind it was, and what was read or left out. */
export type AttachmentInfo = { id: string; name: string; kind: "pdf" | "image" | "text" | "document" | "archive"; chars: number; images: number; notes: string[] };

export type TurnReply = {
  reply: string;
  level: HintLevel;
  verdict: GuardVerdict;
  retries: number;
  /** Present on a turn where the tutor used a tool: what to do on the canvas or in the slide pane, and the tools' names. */
  actions?: CanvasAction[];
  tools?: string[];
  /** The tutor message's id, sent with actions, so the page can store the board as it looks after them. */
  message_id?: string;
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

export type SessionStart = { session_id: string; student_id: string; assignment_id: string; level: HintLevel; current_question?: number };

/** The two questions asked after the last question, with the student's answers so far. `what_if_index` is 0-based. */
export type Reflection = { why: string; what_if: string; what_if_index: number; answers: { why: string; what_if: string } };

/** Next or Finish. `done` false moves to `current_question`, with the ladder back at `level`. `done` true carries the reflection. No time is ever in it. */
export type FinishQuestion = { done: false; current_question: number; level: HintLevel } | { done: true; reflection: Reflection };

/** One student's session as the professor's timing table shows it. A null second count is a question still open or never reached. */
export type SessionTiming = {
  session_id: string;
  student_id: string;
  display_name: string;
  started_at: string;
  completed_at: string | null;
  current_question: number;
  seconds: (number | null)[];
  total_seconds: number | null;
  reflection: Reflection | null;
};

export type Timings = { questions: string[]; sessions: SessionTiming[] };

export type SessionMessages = {
  session_id: string;
  student_id: string;
  assignment_id: string;
  level: HintLevel;
  current_question?: number;
  completed?: boolean;
  reflection?: Reflection | null;
  messages: { role: "student" | "tutor"; content: string; hint_level: number | null; tools?: string[]; actions?: CanvasAction[]; canvas_shared?: boolean; attachments?: { id?: string | null; name: string; kind: string }[] }[];
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

/** Not started: enrolled, never opened it. In progress: opened, not submitted. Finished: pressed Submit on the last question. */
export type StudentStatus = "not_started" | "in_progress" | "finished";

export type StudentSummary = {
  student_id: string;
  display_name: string;
  status: StudentStatus;
  concept: string | null;
  struggle_type: StruggleType;
  last_hint_level: number | null;
  turns: number;
  /** The highest hint level any reply to this student reached. Null before any reply. */
  max_hint_level: number | null;
  /** Questions this student pressed Next or Finish on. */
  questions_done: number;
  /** Mean seconds over those questions, computed by the server. Null before the first. */
  average_seconds: number | null;
};

export type Roster = {
  assignment_id: string;
  students: StudentSummary[];
  guard: { answer_requests: number; drafts_held: number; replies: number };
  /** Class time, computed by the server from the per-question clock. Nulls until something has finished. */
  timing: { finished_students: number; average_total_seconds: number | null; average_seconds_per_question: number | null };
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
  /** The question this turn was on, 0-based, or null when the server could not place it. */
  question_index: number | null;
  /** The tutor's tool calls on this turn: the tool, its arguments, and what it answered. Absent from an older server. */
  tool_calls?: { name: string; args: Record<string, unknown>; result: string }[];
  /** On a student turn: the canvas was shared with the tutor, and whether a picture of it went too. */
  canvas?: { shared: boolean; picture: boolean } | null;
  /** On a student turn: the files attached, by id, name, and kind. The originals are served by attachmentUrl. */
  attachments?: { id: string | null; name: string; kind: string }[];
  /** On a student turn: the picture of the canvas Askretes was shown is stored (canvasPictureUrl). */
  canvas_picture?: boolean;
  /** The ids of the pictures on the stored board (boardFileUrl). */
  board_files?: string[];
  message_id?: string;
  /** The canvas as shapes: what the student shared, or the board after Askretes' marks. */
  board?: Record<string, unknown>[] | null;
  /** What Askretes' tools did, after the guard released it. */
  actions?: CanvasAction[];
};

/** One question as a student's work view heads it: the prompt and this student's seconds on it (null if not finished). */
export type TranscriptQuestion = { index: number; prompt: string; seconds: number | null };

/** The two look-back questions written after the last question, and the student's answers ("" if not written). */
export type TranscriptReflection = { why: string; what_if: string; what_if_index: number; answers: { why: string; what_if: string } };

export type Transcript = {
  student_id: string;
  display_name: string;
  questions: TranscriptQuestion[];
  turns: TranscriptTurn[];
  /** Null until the student finishes the last question. */
  reflection: TranscriptReflection | null;
};

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

/** One revision card, written from the professor's notes. `source` is the line of the notes it came from. */
export type StudyCard = { concept: string; question: string; answer: string; source: string };

/** What Askretes drew: a kind, a title, and up to six labelled items. The page lays it out. It is never an image and never code. */
export type Drawing = { kind: "map" | "steps" | "summary"; title: string; items: { label: string; detail: string }[]; /** Names this drawing for the picture route. */ picture_id?: string };

/** One lecture's slides. `unreadable_pages` counts pages with no text layer, which the tutor cannot cite. */
export type Lecture = {
  id: string;
  course_id: string;
  lecture_number: number;
  title: string;
  /** A calendar day, "2026-11-10", or null. */
  lecture_date: string | null;
  page_count: number;
  unreadable_pages: number;
  uploaded_at: string | null;
};

/** The largest lecture PDF the server accepts. Must equal MAX_PDF_BYTES in backend/src/slides.ts. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * Where the browser's own PDF viewer opens a lecture, at a page. `#page=` is
 * the open PDF fragment every built-in viewer understands. The file route
 * checks the lecture belongs to the class, so a link cannot reach another
 * class's slides.
 */
export function lectureFileUrl(courseId: string, lectureId: string, page?: number): string {
  return `${API_BASE}/api/courses/${encodeURIComponent(courseId)}/lectures/${encodeURIComponent(lectureId)}/file${page ? `#page=${page}` : ""}`;
}

export type ProfessorMessage = { id: string; body: string; created_at: string };

/** What the setup form posts. `answer_key` is left out on an edit to keep the stored key. */
export type AssignmentForm = {
  id?: string;
  course_name: string;
  title: string;
  prompt: string;
  kind: AssignmentKind;
  answer_key?: string;
  notes: string;
  concepts: string[];
  hint_ceiling: number;
  /** ISO time or null. Left out on an older form, the server stores null. */
  due_at?: string | null;
  margin_enabled?: boolean;
  /** Lectures of this class whose slides the level-2 pointer searches. */
  lecture_ids?: string[];
  /** Questions 2 and on. On an edit, `from` is the 1-based place a question had when the form loaded, and no `answer_key` keeps its stored key. */
  questions: { prompt: string; answer_key?: string; from?: number }[];
};

/**
 * A response the API answered with an error status.
 * `code` is the server's fixed error word, such as `no_struggles_yet`. The pages branch on it, because a 409 before anyone has struggled is an ordinary state to describe and not a failure to alarm about.
 */
export class ApiError extends Error {
  status: number;
  code: string;
  issues: { path: string; message: string }[];
  /** A sentence the server wrote for the person, when it sent one (a refused attachment says why). */
  detail: string | null;
  constructor(status: number, code: string, issues: { path: string; message: string }[] = [], detail: string | null = null) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
    this.detail = detail;
  }
}

/**
 * One JSON request.
 * A failed connection becomes `api_unreachable`, so a page can say the API is not running instead of showing a stack trace. `cache: "no-store"` is set because every screen shows live records, and a cached class summary would show yesterday's percent as today's.
 */
/**
 * The header that tells professor routes who is asking (backend prof-scope.ts). Sent only on /api/prof calls and only
 * when a professor profile is chosen; the server then refuses classes that are not this professor's. A label, not a login.
 */
function professorHeader(path: string): Record<string, string> {
  if (!path.startsWith("/api/prof")) return {};
  const name = browser.profProfile();
  return name ? { "x-margin-professor": encodeURIComponent(name) } : {};
}

async function request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, raw?: { type: string; data: Blob }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      cache: "no-store",
      // A raw body (a lecture PDF) is sent as its own bytes with its own type; everything else is JSON.
      headers: { ...(raw ? { "content-type": raw.type } : body === undefined ? {} : { "content-type": "application/json" }), ...professorHeader(path) },
      body: raw ? raw.data : body === undefined ? undefined : JSON.stringify(body),
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
    const err = (data ?? {}) as { error?: string; issues?: { path: string; message: string }[]; message?: string };
    throw new ApiError(res.status, err.error ?? "request_failed", err.issues ?? [], typeof err.message === "string" ? err.message : null);
  }
  return data as T;
}

const q = (id: string) => encodeURIComponent(id);

export const api = {
  health: () => request<{ ok: boolean; db: string }>("GET", "/health"),
  listAssignments: () => request<{ assignments: AssignmentListItem[] }>("GET", "/api/assignments"),
  /** The assignments the chosen professor teaches, for the dashboard and messages pickers. */
  profAssignments: () => request<{ assignments: AssignmentListItem[] }>("GET", "/api/prof/assignments"),
  assignment: (id: string) => request<Assignment>("GET", `/api/assignments/${q(id)}`),
  profAssignment: (id: string) => request<Assignment & { has_answer_key: boolean; lecture_ids?: string[] }>("GET", `/api/prof/assignments/${q(id)}`),
  /** The body is sent as JSON. The key is never placed in a URL, where it would land in history and server logs. */
  saveAssignment: (form: AssignmentForm) => request<{ _id: string }>("POST", "/api/prof/assignments", form),
  study: (id: string) => request<{ cards: StudyCard[] }>("GET", `/api/assignments/${q(id)}/study`),
  /** 422 `not_drawn` means the guard held the drawing or the model could not answer. The page then draws nothing. */
  canvas: (id: string, ask: string) => request<Drawing>("POST", `/api/assignments/${q(id)}/canvas`, { ask }),
  /** The generated picture of a drawing the canvas route just returned. It takes about fifteen seconds. A 404 means there is no picture, and the drawn layout stays. */
  canvasPicture: (pictureId: string) => request<{ mimeType: string; base64: string }>("GET", `/api/canvas/pictures/${q(pictureId)}`),
  /** The picture is sent as base64 with no data: prefix. It is not stored. 422 `not_drawn` means nothing safe could be said about it. */
  annotate: (id: string, image: { mimeType: string; base64: string }, ask: string) =>
    request<Annotation>("POST", `/api/assignments/${q(id)}/canvas/annotate`, { image, ask }),
  quiz: (id: string) => request<{ questions: QuizQuestion[] }>("GET", `/api/assignments/${q(id)}/quiz`),
  /** Speech for a reply already on screen, as a WAV file in base64. */
  speak: (text: string) => request<{ mimeType: string; base64: string }>("POST", "/api/speak", { text }),
  courses: () => request<{ courses: CourseListItem[] }>("GET", "/api/courses"),
  /** With `studentId`, each item carries that student's status. */
  course: (id: string, studentId?: string | null) => request<Course>("GET", `/api/courses/${q(id)}${studentId ? `?student_id=${q(studentId)}` : ""}`),
  myCourses: (studentId: string) => request<MyCourses>("GET", `/api/students/${q(studentId)}/courses`),
  /** A returning student sends their id; a first visit sends the name they typed, and the server creates the student. */
  joinCourse: (courseId: string, who: { student_id: string } | { display_name: string }) => request<{ student_id: string; course_id: string }>("POST", `/api/courses/${q(courseId)}/join`, who),
  lectures: (courseId: string) => request<{ lectures: Lecture[] }>("GET", `/api/courses/${q(courseId)}/lectures`),
  /** The PDF goes as raw bytes. The name only becomes the default title; the server stores the file under a random id. */
  uploadLecture: (courseId: string, file: File, meta: { title?: string; lecture_number?: number; lecture_date?: string }) => {
    const params = new URLSearchParams({ filename: file.name });
    if (meta.title) params.set("title", meta.title);
    if (meta.lecture_number !== undefined) params.set("lecture_number", String(meta.lecture_number));
    if (meta.lecture_date) params.set("lecture_date", meta.lecture_date);
    return request<Lecture>("POST", `/api/prof/courses/${q(courseId)}/lectures?${params}`, undefined, { type: "application/pdf", data: file });
  },
  updateLecture: (lectureId: string, fields: { title?: string; lecture_number?: number; lecture_date?: string }) => request<Lecture>("PATCH", `/api/prof/lectures/${q(lectureId)}`, fields),
  deleteLecture: (lectureId: string) => request<null>("DELETE", `/api/prof/lectures/${q(lectureId)}`),
  /** The student behind a named profile, found or created by name and enrolled in that class. */
  profileStudent: (displayName: string, courseName: string) =>
    request<{ student_id: string; course_id: string; display_name: string }>("POST", "/api/profiles/students", { display_name: displayName, course_name: courseName }),
  /**
   * Reads a Question PDF and an Answer key PDF into a draft, in two uploads:
   * the question sheet opens the draft, the answer key completes it and is
   * read with it. Returns the preview.
   */
  readAssignmentPdfs: async (courseId: string, questionPdf: File, answerPdf: File) => {
    const opened = await request<{ draft_id: string }>("POST", `/api/prof/courses/${q(courseId)}/assignment-drafts`, undefined, { type: "application/pdf", data: questionPdf });
    return request<AssignmentDraft>("POST", `/api/prof/assignment-drafts/${q(opened.draft_id)}/answer-key`, undefined, { type: "application/pdf", data: answerPdf });
  },
  /** Opens a draft from the questions, typed or as any file (PDF, Word, PowerPoint, Excel, CSV, Markdown, text, handwriting photo, zip). */
  draftFromSource: (courseId: string, questions: AssignmentSource) => request<{ draft_id: string; chars: number }>("POST", `/api/prof/courses/${q(courseId)}/assignment-drafts/source`, { questions }),
  /** Reads the draft with its answer key (optional, any source) into the preview. */
  readDraft: (draftId: string, answers?: AssignmentSource) => request<AssignmentDraft>("POST", `/api/prof/assignment-drafts/${q(draftId)}/read`, answers ? { answers } : {}),
  /** A new assignment in this class, from a read draft. `questions` is the preview's wording as the professor edited it. */
  createPdfAssignment: (courseId: string, fields: { draft_id: string; title: string; due_at: string | null; margin_enabled: boolean; questions?: string[] }) =>
    request<{ _id: string }>("POST", `/api/prof/courses/${q(courseId)}/assignments`, fields),
  /** Edits title, due date and the switch; with `draft_id`, also replaces the questions and keys. 400 `pdfs_required` for an assignment without PDFs. */
  editPdfAssignment: (assignmentId: string, fields: { draft_id?: string; title: string; due_at: string | null; margin_enabled: boolean; questions?: string[] }) =>
    request<{ _id: string }>("PATCH", `/api/prof/assignments/${q(assignmentId)}`, fields),
  profCourses: () => request<{ courses: ProfCourseCard[] }>("GET", "/api/prof/courses"),
  saveCourse: (course: { id?: string; name: string; description: string; notes: string; professor?: string; code?: string; term?: string; accent?: CourseAccent }) => request<{ id: string; name: string }>("POST", "/api/prof/courses", course),
  /** `text` for a text file, `file` for a PDF or a picture that the server reads into text once. */
  addMaterial: (courseId: string, material: { title: string; text?: string; file?: { mimeType: string; base64: string } }) =>
    request<{ id: string; title: string; body: string }>("POST", `/api/prof/courses/${q(courseId)}/materials`, material),
  startSession: (assignmentId: string, who: { student_id: string } | { display_name: string }) =>
    request<SessionStart>("POST", "/api/sessions", { assignment_id: assignmentId, ...who }),
  /** The "Try a smaller problem" control. `level` is the level of the example, 3 unless the guard held it. `session_level` is where the ladder still is. 409 means this assignment does not offer it. */
  smallerProblem: (sessionId: string) =>
    request<{ reply: string; level: HintLevel; session_level: HintLevel; verdict: GuardVerdict; retries: number }>("POST", `/api/sessions/${q(sessionId)}/smaller`),
  /** The student pressed Next or Finish. The server stops that question's clock; the page never sees a time. */
  finishQuestion: (sessionId: string) => request<FinishQuestion>("POST", `/api/sessions/${q(sessionId)}/finish-question`),
  saveReflection: (sessionId: string, answers: { why: string; what_if: string }) =>
    request<{ reflection: Reflection }>("PUT", `/api/sessions/${q(sessionId)}/reflection`, answers),
  sessionMessages: (sessionId: string) => request<SessionMessages>("GET", `/api/sessions/${q(sessionId)}/messages`),
  /** `attempt` is sent only when the student wrote one. There is no flag that claims an attempt. The server's scribe reads the words. */
  sendTurn: (sessionId: string, text: string, attempt?: string, canvas?: CanvasContext, attachments?: string[]) =>
    request<TurnReply>("POST", `/api/sessions/${q(sessionId)}/messages`, { text, ...(attempt ? { attempt } : {}), ...(canvas ? { canvas } : {}), ...(attachments?.length ? { attachments } : {}) }),
  /** One file for the next message, as base64. The server reads it within its limits and answers with an id, or a 400/413 whose `message` the tile shows. */
  uploadAttachment: (sessionId: string, file: { name: string; base64: string }) => request<AttachmentInfo>("POST", `/api/sessions/${q(sessionId)}/attachments`, file),
  /** The board after a reply's canvas actions, for the professor's transcript. */
  putBoard: (sessionId: string, messageId: string, scene: Record<string, unknown>[], files: { id: string; mimeType: string; base64: string }[] = []) =>
    request<null>("PUT", `/api/sessions/${q(sessionId)}/messages/${q(messageId)}/board`, { scene, ...(files.length ? { files } : {}) }),
  /** The photo as base64 without a data: prefix, in the type it was encoded as. */
  sendPhoto: (sessionId: string, image: { mimeType: string; base64: string }) =>
    request<PhotoReply>("POST", `/api/sessions/${q(sessionId)}/messages`, { image }),
  /** Without `concept`, the server picks this student's weakest concept from their own labels. */
  flashcards: (studentId: string, assignmentId: string, concept?: string) =>
    request<Flashcards>(
      "GET",
      `/api/students/${q(studentId)}/flashcards?assignment_id=${q(assignmentId)}${concept ? `&concept=${q(concept)}` : ""}`,
    ),
  ownNotes: (studentId: string, assignmentId: string) => request<{ body: string }>("GET", `/api/students/${q(studentId)}/notes?assignment_id=${q(assignmentId)}`),
  saveOwnNotes: (studentId: string, assignmentId: string, body: string) =>
    request<{ body: string }>("PUT", `/api/students/${q(studentId)}/notes?assignment_id=${q(assignmentId)}`, { body }),
  progress: (studentId: string) => request<StudentProgress>("GET", `/api/students/${q(studentId)}/progress`),
  /** The class's chat with Askretes. A message may carry files (base64); an answer may carry a draft assignment to review and post. */
  classChat: (courseId: string) => request<{ messages: ClassChatTurn[] }>("GET", `/api/prof/courses/${q(courseId)}/chat`),
  askClass: (courseId: string, text: string, files: { name: string; base64: string }[] = []) =>
    request<{ reply: string; tool_calls: ClassChatTurn["tool_calls"]; draft: ClassChatDraft | null }>("POST", `/api/prof/courses/${q(courseId)}/chat`, { text, ...(files.length ? { files } : {}) }),
  analystHistory: (assignmentId: string) => request<{ messages: AnalystTurn[]; names: AnalystNames }>("GET", `/api/prof/analyst?assignment_id=${q(assignmentId)}`),
  askAnalyst: (assignmentId: string, text: string) =>
    request<{ reply: string; tool_calls: AnalystTurn["tool_calls"]; names: AnalystNames }>("POST", `/api/prof/analyst?assignment_id=${q(assignmentId)}`, { text }),
  workSummary: (assignmentId: string) => request<WorkSummary>("GET", `/api/prof/work-summary?assignment_id=${q(assignmentId)}`),
  classSummary: (assignmentId: string) => request<ClassSummary>("GET", `/api/prof/class-summary?assignment_id=${q(assignmentId)}`),
  roster: (assignmentId: string) => request<Roster>("GET", `/api/prof/students?assignment_id=${q(assignmentId)}`),
  transcript: (studentId: string, assignmentId: string) =>
    request<Transcript>("GET", `/api/prof/students/${q(studentId)}/transcript?assignment_id=${q(assignmentId)}`),
  /** Time per question for every session on an assignment. A professor route; the student page never calls it. */
  timings: (assignmentId: string) => request<Timings>("GET", `/api/prof/timings?assignment_id=${q(assignmentId)}`),
  thursdayCard: (assignmentId: string) => request<ThursdayCard>("GET", `/api/prof/thursday-card?assignment_id=${q(assignmentId)}`),
  generateThursdayCard: (assignmentId: string) =>
    request<ThursdayCard>("POST", `/api/prof/thursday-card?assignment_id=${q(assignmentId)}`),
  profMessages: (assignmentId: string) =>
    request<{ assignment_id: string; messages: ProfessorMessage[] }>("GET", `/api/prof/messages?assignment_id=${q(assignmentId)}`),
};

/**
 * The study cards for an assignment, fetched once per page visit.
 * The Study tab and the concept map on the sketch pad both read them. Sharing one promise means opening both costs one request, and the server's own cache means that request is one model call per assignment.
 * A failed load is forgotten, so the next open tries again.
 */
const studyLoads = new Map<string, Promise<StudyCard[]>>();
export function loadStudy(assignmentId: string): Promise<StudyCard[]> {
  let load = studyLoads.get(assignmentId);
  if (!load) {
    load = api.study(assignmentId).then((r) => r.cards);
    load.catch(() => studyLoads.delete(assignmentId));
    studyLoads.set(assignmentId, load);
  }
  return load;
}

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
