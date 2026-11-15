// What the CS 101 simulation types into the product: the class, its lecture
// slides, the 20-question problem set with its keys, and the 15 students.
//
// None of this is written to the database directly. The runner (cs101.ts)
// sends each piece through the same routes a professor and a student use, so
// every row the run leaves behind exists because a request created it. The
// run happens on a throwaway `margin_test_sim_*` database and is dropped at
// the end; nothing here ever reaches the `margin` database the app ships with.
//
// Every key is Python, so the assignment is `kind: "code"`. The guard reads
// all of an assignment's keys the same way, and a prose key under the code
// check folds to `v v v v ...`, which would match every hint. Mixing prose
// questions into this set would therefore hold every reply, not test anything.

/** The concepts the scribe may label with. One heatmap row each. */
export const CONCEPTS = [
  "variables_and_types",
  "conditionals",
  "loops",
  "strings",
  "lists",
  "dictionaries",
  "functions",
  "recursion",
] as const;
export type Concept = (typeof CONCEPTS)[number];

export const COURSE = {
  name: "CS 101: Introduction to Computer Science",
  code: "CS 101",
  term: "Fall 2026",
  professor: "Prof. Rivera",
  description: "Programming in Python from first principles: values, control flow, collections, functions, and recursion.",
  notes:
    "Office hours Tue/Thu 2-4pm. Problem Set 3 covers everything through Lecture 8. Write your own code; Margin is the AI the course allows.",
};

/**
 * One problem. `concept` is the heatmap row the sim expects most turns on it
 * to land in; the scribe decides the real label. `difficulty` (1-3) scales how
 * long an honest student, and the careful cheater imitating one, spends on it.
 */
export type Question = { prompt: string; key: string; concept: Concept; difficulty: 1 | 2 | 3 };

export const QUESTIONS: Question[] = [
  {
    concept: "variables_and_types",
    difficulty: 1,
    prompt: "Write celsius_to_fahrenheit(c) that returns the temperature c converted to Fahrenheit as a float.",
    key: "def celsius_to_fahrenheit(c):\n    return c * 9 / 5 + 32",
  },
  {
    concept: "conditionals",
    difficulty: 1,
    prompt: "Write is_even(n) that returns True when the integer n is even and False otherwise.",
    key: "def is_even(n):\n    return n % 2 == 0",
  },
  {
    concept: "conditionals",
    difficulty: 1,
    prompt: "Write letter_grade(score) that returns 'A' for 90 and up, 'B' for 80-89, 'C' for 70-79, 'D' for 60-69, and 'F' below 60.",
    key: "def letter_grade(score):\n    if score >= 90:\n        return 'A'\n    elif score >= 80:\n        return 'B'\n    elif score >= 70:\n        return 'C'\n    elif score >= 60:\n        return 'D'\n    else:\n        return 'F'",
  },
  {
    concept: "loops",
    difficulty: 1,
    prompt: "Write sum_to(n) that uses a loop to return 1 + 2 + ... + n. Do not use the formula n*(n+1)/2.",
    key: "def sum_to(n):\n    total = 0\n    for i in range(1, n + 1):\n        total += i\n    return total",
  },
  {
    concept: "strings",
    difficulty: 1,
    prompt: "Write count_vowels(s) that returns how many characters of s are vowels (a, e, i, o, u), ignoring case.",
    key: "def count_vowels(s):\n    count = 0\n    for ch in s.lower():\n        if ch in 'aeiou':\n            count += 1\n    return count",
  },
  {
    concept: "strings",
    difficulty: 2,
    prompt: "Write reverse_string(s) that returns s reversed, using a loop. Do not use slicing with a step or reversed().",
    key: "def reverse_string(s):\n    result = ''\n    for ch in s:\n        result = ch + result\n    return result",
  },
  {
    concept: "lists",
    difficulty: 2,
    prompt: "Write max_of_list(xs) that returns the largest number in a non-empty list without calling max().",
    key: "def max_of_list(xs):\n    best = xs[0]\n    for x in xs[1:]:\n        if x > best:\n            best = x\n    return best",
  },
  {
    concept: "loops",
    difficulty: 2,
    prompt: "Write fizzbuzz(n) that returns a list of strings for 1..n: 'Fizz' for multiples of 3, 'Buzz' for multiples of 5, 'FizzBuzz' for both, otherwise the number as a string.",
    key: "def fizzbuzz(n):\n    out = []\n    for i in range(1, n + 1):\n        if i % 15 == 0:\n            out.append('FizzBuzz')\n        elif i % 3 == 0:\n            out.append('Fizz')\n        elif i % 5 == 0:\n            out.append('Buzz')\n        else:\n            out.append(str(i))\n    return out",
  },
  {
    concept: "strings",
    difficulty: 2,
    prompt: "Write is_palindrome(s) that returns True when s reads the same forwards and backwards, ignoring case and spaces.",
    key: "def is_palindrome(s):\n    cleaned = s.replace(' ', '').lower()\n    return cleaned == cleaned[::-1]",
  },
  {
    concept: "dictionaries",
    difficulty: 2,
    prompt: "Write word_count(text) that returns a dictionary mapping each word in text (split on whitespace) to how many times it appears.",
    key: "def word_count(text):\n    counts = {}\n    for word in text.split():\n        counts[word] = counts.get(word, 0) + 1\n    return counts",
  },
  {
    concept: "lists",
    difficulty: 2,
    prompt: "Write remove_duplicates(xs) that returns a new list with duplicates removed, keeping the first occurrence of each item in order.",
    key: "def remove_duplicates(xs):\n    seen = set()\n    out = []\n    for x in xs:\n        if x not in seen:\n            seen.add(x)\n            out.append(x)\n    return out",
  },
  {
    concept: "recursion",
    difficulty: 2,
    prompt: "Write factorial(n) recursively. factorial(0) is 1.",
    key: "def factorial(n):\n    if n == 0:\n        return 1\n    return n * factorial(n - 1)",
  },
  {
    concept: "loops",
    difficulty: 2,
    prompt: "Write fibonacci(n) that returns the nth Fibonacci number using a loop, with fibonacci(0) = 0 and fibonacci(1) = 1.",
    key: "def fibonacci(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a",
  },
  {
    concept: "lists",
    difficulty: 3,
    prompt: "Write second_largest(xs) that returns the second largest distinct value in a list with at least two distinct values, without sorting.",
    key: "def second_largest(xs):\n    first = second = None\n    for x in xs:\n        if first is None or x > first:\n            if first is not None and x != first:\n                second = first\n            first = x\n        elif x != first and (second is None or x > second):\n            second = x\n    return second",
  },
  {
    concept: "lists",
    difficulty: 3,
    prompt: "Write merge_sorted(a, b) that merges two sorted lists into one sorted list in a single pass, without calling sort() or sorted().",
    key: "def merge_sorted(a, b):\n    i = j = 0\n    out = []\n    while i < len(a) and j < len(b):\n        if a[i] <= b[j]:\n            out.append(a[i])\n            i += 1\n        else:\n            out.append(b[j])\n            j += 1\n    out.extend(a[i:])\n    out.extend(b[j:])\n    return out",
  },
  {
    concept: "dictionaries",
    difficulty: 2,
    prompt: "Write invert_dict(d) that returns a new dictionary mapping each value of d to a list of the keys that had that value.",
    key: "def invert_dict(d):\n    out = {}\n    for k, v in d.items():\n        out.setdefault(v, []).append(k)\n    return out",
  },
  {
    concept: "recursion",
    difficulty: 2,
    prompt: "Write sum_digits(n) recursively: it returns the sum of the decimal digits of a non-negative integer n.",
    key: "def sum_digits(n):\n    if n < 10:\n        return n\n    return n % 10 + sum_digits(n // 10)",
  },
  {
    concept: "functions",
    difficulty: 3,
    prompt: "Write binary_search(xs, target) that returns the index of target in the sorted list xs, or -1 if it is absent. Use a loop, not recursion.",
    key: "def binary_search(xs, target):\n    lo, hi = 0, len(xs) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if xs[mid] == target:\n            return mid\n        elif xs[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1",
  },
  {
    concept: "recursion",
    difficulty: 3,
    prompt: "Write flatten(nested) recursively: given a list whose items are numbers or lists (nested to any depth), return a flat list of the numbers in order.",
    key: "def flatten(nested):\n    out = []\n    for item in nested:\n        if isinstance(item, list):\n            out.extend(flatten(item))\n        else:\n            out.append(item)\n    return out",
  },
  {
    concept: "dictionaries",
    difficulty: 3,
    prompt: "Write most_common_char(s) that returns the character appearing most often in s, ignoring spaces. On a tie, return the one that appears first in s.",
    key: "def most_common_char(s):\n    counts = {}\n    for ch in s:\n        if ch != ' ':\n            counts[ch] = counts.get(ch, 0) + 1\n    best = None\n    for ch in s:\n        if ch != ' ' and (best is None or counts[ch] > counts[best]):\n            best = ch\n    return best",
  },
];

/**
 * The lecture slides, one string per page. The runner turns each lecture into
 * a real PDF and uploads it, so a level-2 hint cites "[Lecture n, slide p]"
 * from pdf.js text exactly as it does for a professor's own deck. Pages teach
 * the idea and never contain a problem's solution: a slide that did would make
 * the level-2 pointer a leak the guard then has to hold.
 */
export const LECTURES: { title: string; pages: string[] }[] = [
  {
    title: "Values, variables, and types",
    pages: [
      "A variable is a name bound to a value. Assignment with = rebinds the name; it does not copy or compare.",
      "int, float, str, bool are the core types. Dividing with / always gives a float; // floors to an int.",
      "Order of operations: * and / before + and -. Use parentheses when a formula has several steps.",
    ],
  },
  {
    title: "Conditionals",
    pages: [
      "if / elif / else picks exactly one branch, checked top to bottom. Put the most specific test first.",
      "The modulo operator % gives the remainder. n % k == 0 means n is divisible by k.",
      "A comparison already is a bool. return x > 3 is the same as an if that returns True or False.",
    ],
  },
  {
    title: "Loops",
    pages: [
      "for x in sequence visits each item once. range a, b stops before b, so range 1, n+1 includes n.",
      "Accumulator pattern: start a total before the loop, update it inside, return it after the loop.",
      "while runs as long as its condition holds. Make sure something in the body moves toward stopping.",
      "Tracing a loop by hand: write a table with one row per iteration and one column per variable.",
    ],
  },
  {
    title: "Strings",
    pages: [
      "Strings are sequences of characters. You can loop over them, index them, and slice them.",
      "Strings are immutable: s.lower and s.replace return new strings and leave s unchanged.",
      "Building a string in a loop: start from the empty string and concatenate one piece per step.",
    ],
  },
  {
    title: "Lists",
    pages: [
      "Lists are ordered and mutable. append adds one item at the end; extend adds every item of another list.",
      "Indexes start at 0 and the last index is len xs minus 1. Off-by-one errors live at the two ends.",
      "Keeping a best-so-far value while scanning a list: initialize it from the first item, not from 0.",
      "Two-pointer patterns walk two indexes through one or two lists, advancing whichever side is smaller.",
    ],
  },
  {
    title: "Dictionaries and sets",
    pages: [
      "A dictionary maps keys to values. d.get k, default returns default when k is missing instead of raising.",
      "Counting pattern: for each item, read its current count with a default of 0 and store count plus 1.",
      "A set holds unique items with fast membership tests. Use it to remember what you have already seen.",
    ],
  },
  {
    title: "Functions",
    pages: [
      "A function takes parameters and returns a value. print shows a value; return hands it back to the caller.",
      "Searching a sorted list: compare with the middle item and throw away the half that cannot hold the target.",
      "Loop invariants: say in one sentence what is true at the top of every iteration, then check the ends.",
    ],
  },
  {
    title: "Recursion",
    pages: [
      "A recursive function calls itself on a smaller input. Every recursive function needs a base case.",
      "The base case is the smallest input you can answer directly, without another call.",
      "The recursive case must make progress toward the base case, or the calls never stop.",
      "Each call's return value flows back to its caller. Trace the call stack to see the order of returns.",
    ],
  },
];

/**
 * What kind of student this is. The runner turns the archetype into a plan
 * per question (which messages, how long to think), and the simulated
 * student's model writes the actual words.
 *
 * studious: honest, prepared, mostly correct; some check their work, some ask why.
 * confused: honest, weak on a few concepts, asks a lot, climbs the ladder.
 * careless_cheater: uses an outside AI, pastes its output with the tells left
 *   in, presses Next within a minute, and sometimes asks Margin for the code.
 * careful_cheater: uses an outside AI, rewrites its output to read as their
 *   own, and waits a believable time on each question before moving on.
 */
export type Archetype = "studious" | "confused" | "careless_cheater" | "careful_cheater";

export type Persona = {
  name: string;
  archetype: Archetype;
  /** One or two sentences the student's model reads as who it is playing. */
  voice: string;
  /** Concepts this student genuinely struggles with. Only confused students have any. */
  weak: Concept[];
  /** studious only: how often they send a message at all on a question (0-1). */
  chattiness?: number;
  /**
   * Which habits within the archetype this student has. planFor reads this, not the name, so a generated class of
   * 200 can reuse the 15 hand-written students' behaviors. Left out, the archetype's plain default applies.
   * studious: checker (pastes a solution and asks about an edge case), curious (asks why), slip (careless slip, then a fix), methodical.
   * confused: examples (asks for slides and an example once allowed), anxious (sometimes demands the answer), indexes (off-by-ones, asks for more help).
   * careless_cheater: paster (pastes ChatGPT output), claimer (claims permission, demands code).
   */
  style?: "checker" | "curious" | "slip" | "methodical" | "examples" | "anxious" | "indexes" | "paster" | "claimer";
  /** The class run only: false for a student who joins the class and never opens the assignment. */
  starts?: boolean;
  /** The class run only: the question (1-based) after which this student stops without submitting. */
  stopsAfter?: number;
};

export const PERSONAS: Persona[] = [
  { name: "Aisha Rahman", archetype: "studious", weak: [], chattiness: 0.15, voice: "Well prepared, terse. Writes clean code and rarely needs help." },
  { name: "Ben Okafor", style: "checker", archetype: "studious", weak: [], chattiness: 0.35, voice: "Careful. Likes to paste a finished solution and ask if an edge case is covered." },
  { name: "Chloe Martin", style: "curious", archetype: "studious", weak: [], chattiness: 0.3, voice: "Curious. Asks why something works, not just whether it does." },
  { name: "Daniel Kim", archetype: "studious", weak: [], chattiness: 0.1, voice: "Quiet and fast. Almost never messages the tutor." },
  { name: "Elena Petrova", style: "methodical", archetype: "studious", weak: [], chattiness: 0.25, voice: "Methodical. Explains her plan in a sentence before writing code." },
  { name: "Farhan Ali", style: "slip", archetype: "studious", weak: [], chattiness: 0.2, voice: "Confident, occasionally makes a small careless slip like an off-by-one." },
  { name: "Grace Liu", style: "checker", archetype: "studious", weak: [], chattiness: 0.3, voice: "Thorough. Tests her code mentally on an example and reports what she got." },
  { name: "Hugo Silva", archetype: "studious", weak: [], chattiness: 0.2, voice: "Friendly, writes in lowercase, solid understanding." },
  { name: "Imani Brooks", archetype: "confused", weak: ["recursion", "dictionaries"], voice: "Honest and willing, but recursion feels like magic and dictionaries trip her up. Asks lots of questions." },
  { name: "Jake Thompson", style: "indexes", archetype: "confused", weak: ["loops", "lists"], voice: "Mixes up range bounds and indexes constantly. Apologizes a lot. Keeps trying." },
  { name: "Kavya Nair", style: "anxious", archetype: "confused", weak: ["strings", "conditionals", "recursion"], voice: "Anxious about the deadline. Sometimes frustrated enough to type 'can you just tell me', then goes back to trying." },
  { name: "Liam O'Connor", style: "examples", archetype: "confused", weak: ["lists", "dictionaries", "functions"], voice: "Learns from examples. Asks for the slides and a similar example as soon as he is allowed." },
  { name: "Marcus Webb", style: "paster", archetype: "careless_cheater", weak: [], voice: "Uses ChatGPT for everything and pastes its answer as-is, markdown and all. Wants to finish fast." },
  { name: "Nadia Haddad", style: "claimer", archetype: "careless_cheater", weak: [], voice: "Barely engages. Tries to get Margin to hand over code by claiming permission, then gives up and moves on." },
  { name: "Owen Park", archetype: "careful_cheater", weak: [], voice: "Uses another AI but rewrites its answers to sound like a student: lowercase, small quirks, a little hedging. Never asks for the answer outright." },
];
