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
  studentProfile: "margin.profile.student",
  profProfile: "margin.profile.prof",
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
  /** A different student than the one stored drops the profile label, so the header never shows one person's name over another's work. */
  setStudentId: (id: string) => {
    if (read(KEY.student) !== id) write(KEY.studentProfile, null);
    write(KEY.student, id);
  },
  sessionId: (assignmentId: string) => read(KEY.session(assignmentId)),
  setSessionId: (assignmentId: string, id: string | null) => write(KEY.session(assignmentId), id),
  /** The student's work in the editor, kept so a reload does not lose it. It is their own text, on their own machine. */
  code: (assignmentId: string) => read(KEY.code(assignmentId)) ?? "",
  setCode: (assignmentId: string, code: string) => write(KEY.code(assignmentId), code),
  /** The student's own words from the "Understand it" step, kept for the same reason as the code. */
  plan: (assignmentId: string) => read(KEY.plan(assignmentId)) ?? "",
  setPlan: (assignmentId: string, plan: string) => write(KEY.plan(assignmentId), plan),
  /** The name this person goes by, as a student and as a professor. They are labels on classes, since there is no login. */
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
  /** The name of the student or professor profile chosen in the header menu, or null when none has been chosen. */
  studentProfile: () => read(KEY.studentProfile),
  profProfile: () => read(KEY.profProfile),
  /**
   * Switches this browser to another student. Every per-assignment key is
   * dropped first: the open session, the drafted work, the "say what it
   * asks" text, and the canvas all belong to the student who made them, and a
   * session left behind would put the next student's turns on the previous
   * student's record. The database keeps everyone's sessions.
   */
  chooseStudent: (studentId: string, name: string) => {
    try {
      for (const k of Object.keys(window.localStorage)) {
        if (k.startsWith("margin.session.") || k.startsWith("margin.code.") || k.startsWith("margin.plan.") || k.startsWith("margin.canvas.")) window.localStorage.removeItem(k);
      }
    } catch {
      // Storage blocked: nothing was stored to clear.
    }
    // The canvas pictures are in IndexedDB, not localStorage, and go with the rest. The name matches CANVAS_DB in lib/whiteboard.ts.
    try {
      window.indexedDB.deleteDatabase("margin-canvas");
      // The files this student sent are kept in their browser too (lib/files.ts, FILES_DB), and go with them.
      window.indexedDB.deleteDatabase("margin-files");
    } catch {
      // IndexedDB blocked: nothing was stored there.
    }
    write(KEY.student, studentId);
    write(KEY.name, name);
    // Set after the id, so the label belongs to this student.
    write(KEY.studentProfile, name);
  },
  /** Chooses a professor profile. The name is also the professor label the class list sorts and filters by. */
  chooseProf: (name: string) => {
    write(KEY.profName, name);
    write(KEY.profProfile, name);
  },
};
