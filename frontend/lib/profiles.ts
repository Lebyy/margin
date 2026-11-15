// The named profiles in the header's profile menu.
//
// These replace the bare `student` and `prof` logins for the demo: a fixed
// list of people, each tied to one class by its exact name. There is still no
// password and no account system; a profile is a label this browser
// remembers. A student profile is found or created on the server by name and
// enrolled in its class when chosen (POST /api/profiles/students). A
// professor profile is the instructor name already on that class, and only
// narrows the professor's class list to theirs.
//
// The menu shows student profiles on the student side and professor profiles
// only on the "I teach" side (any /prof page), so the two never sit in one list.

export type StudentProfile = { kind: "student"; name: string; courseName: string };
export type ProfProfile = { kind: "prof"; name: string; courseName: string };
export type Profile = StudentProfile | ProfProfile;

export const STUDENT_PROFILES: StudentProfile[] = [
  { kind: "student", name: "Grace McKinney", courseName: "Undergraduate Electrostatics 101" },
  { kind: "student", name: "John Horowitz", courseName: "ME 201: Engineering Statics" },
  { kind: "student", name: "Ha-eun Park", courseName: "CS 251: Data Structures and Algorithms" },
];

export const PROF_PROFILES: ProfProfile[] = [
  { kind: "prof", name: "Dr. Samuel Ortiz", courseName: "Undergraduate Electrostatics 101" },
  { kind: "prof", name: "Dr. Grace Adeyemi", courseName: "ME 201: Engineering Statics" },
  { kind: "prof", name: "Dr. Nadia Rahman", courseName: "CS 251: Data Structures and Algorithms" },
  { kind: "prof", name: "Dr. Elena Rivera", courseName: "CS 101: Introduction to Computer Science" },
];

/** "GM" for Grace McKinney, "NR" for Dr. Nadia Rahman: the title is skipped so two doctors do not both read "D". */
export function initials(name: string): string {
  return name
    .replace(/^(dr|prof)\.?\s+/i, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
