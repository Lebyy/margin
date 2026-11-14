// What the browser remembers between page loads. Ids only.
//
// There is no account system. The two sign-ins are the hard-coded words
// `student` and `prof`, and choosing a side on the home page is the whole
// sign-in. What is kept here is what a reload needs: which session this
// browser started, and which assignment the professor last saved.
//
// The answer key is never written here. The setup form holds it in component
// state until the save request is sent, and then lets it go.

const KEY = {
  student: "margin.student_id",
  session: (assignmentId: string) => `margin.session.${assignmentId}`,
  profAssignment: "margin.prof.assignment_id",
  code: (assignmentId: string) => `margin.code.${assignmentId}`,
  name: "margin.name",
  profName: "margin.prof.name",
  plan: (assignmentId: string) => `margin.plan.${assignmentId}`,
};

/** localStorage throws in a private window with storage blocked. A page that could not remember an id should still work, so a failure reads as "nothing stored". */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do. The page keeps the value in memory for this visit.
  }
}

export const browser = {
  studentId: () => read(KEY.student),
  setStudentId: (id: string) => write(KEY.student, id),
  sessionId: (assignmentId: string) => read(KEY.session(assignmentId)),
  setSessionId: (assignmentId: string, id: string | null) => write(KEY.session(assignmentId), id),
  /** The student's work in the editor, kept so a reload does not lose it. It is their own text, on their own machine. */
  code: (assignmentId: string) => read(KEY.code(assignmentId)) ?? "",
  setCode: (assignmentId: string, code: string) => write(KEY.code(assignmentId), code),
  /** The student's own words from the "Understand it" step, kept for the same reason as the code. */
  plan: (assignmentId: string) => read(KEY.plan(assignmentId)) ?? "",
  setPlan: (assignmentId: string, plan: string) => write(KEY.plan(assignmentId), plan),
  /** The name this person goes by, as a student and as a professor. They are labels on posts and classes, since there is no login. */
  name: () => read(KEY.name) ?? "",
  setName: (name: string) => write(KEY.name, name),
  profName: () => read(KEY.profName) ?? "",
  setProfName: (name: string) => write(KEY.profName, name),
  profAssignmentId: () => read(KEY.profAssignment),
  setProfAssignmentId: (id: string) => write(KEY.profAssignment, id),
  /** Forget this browser's student, for "I am someone else". The records stay in the database, since they are a real person's sessions. */
  forgetStudent: () => {
    write(KEY.student, null);
  },
};
