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

/** The most questions one assignment may have, question 1 included. Must equal MAX_QUESTIONS in backend/src/routes.ts. */
export const MAX_QUESTIONS = 10;

/** The longest notes paste the server saves. Must equal MAX_NOTES_CHARS in backend/src/routes.ts, or the form would allow a paste the save refuses. */
export const MAX_NOTES_CHARS = 200_000;

export type HintLevel = 1 | 2 | 3;

/** What kind of work an assignment is. A `topic` is material to learn: it has no answer key and Margin teaches it. */
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
  /** False when the professor has not turned Margin on for this assignment. Every tutor route then answers 403. */
  margin_enabled?: boolean;
};

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

/** One post in a class discussion. `parent_id` is null on a question. A post by Margin has role "margin". */
export type Post = { id: string; parent_id: string | null; author: string; role: "student" | "prof" | "margin"; body: string; created_at: string };

/** One class opened: its classroom notes, the files the professor added (stored as text), and everything to do or learn in it. */
export type Course = CourseCard & { notes: string; materials: { id: string; title: string; body: string }[]; items: AssignmentListItem[] };

/** One self-check question. The right answer is in the response, because the page checks it locally and nothing about a student's answers is stored. */
export type QuizQuestion = { concept: string; question: string; choices: string[]; answer: number; why: string };

/** What Margin said about a picture on the canvas: one description, and up to five marks with a box each in 0-to-1 units from the picture's top left. */
export type Annotation = { description: string; marks: { label: string; note: string; box: { x: number; y: number; w: number; h: number } }[] };

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

/** One revision card, written from the professor's notes. `source` is the line of the notes it came from. */
export type StudyCard = { concept: string; question: string; answer: string; source: string };

/** What Margin drew: a kind, a title, and up to six labelled items. The page lays it out. It is never an image and never code. */
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
async function request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, raw?: { type: string; data: Blob }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      cache: "no-store",
      // A raw body (a lecture PDF) is sent as its own bytes with its own type; everything else is JSON.
      headers: raw ? { "content-type": raw.type } : body === undefined ? undefined : { "content-type": "application/json" },
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
  profCourses: () => request<{ courses: ProfCourseCard[] }>("GET", "/api/prof/courses"),
  posts: (courseId: string) => request<{ posts: Post[] }>("GET", `/api/courses/${q(courseId)}/posts`),
  addPost: (courseId: string, post: { author: string; role: "student" | "prof"; body: string; parent_id?: string }) => request<{ id: string }>("POST", `/api/courses/${q(courseId)}/posts`, post),
  /** Asks Margin to answer a question in the discussion. 422 `held` means the answer was checked against the class's answer keys and not posted. */
  askMarginOnPost: (courseId: string, postId: string) => request<{ id: string }>("POST", `/api/courses/${q(courseId)}/posts/${q(postId)}/margin`),
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
  ownNotes: (studentId: string, assignmentId: string) => request<{ body: string }>("GET", `/api/students/${q(studentId)}/notes?assignment_id=${q(assignmentId)}`),
  saveOwnNotes: (studentId: string, assignmentId: string, body: string) =>
    request<{ body: string }>("PUT", `/api/students/${q(studentId)}/notes?assignment_id=${q(assignmentId)}`, { body }),
  progress: (studentId: string) => request<StudentProgress>("GET", `/api/students/${q(studentId)}/progress`),
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
