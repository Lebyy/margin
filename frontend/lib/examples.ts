// Example assignments a professor can start from on the setup page.
//
// Choosing one fills the form. It does not save anything: the professor reads
// it, changes it, and presses save, so every assignment in the database is
// still one a person saved through the form. These are course content written
// for the form, in the shape a professor would type. They are not records of
// any class, and they contain no student, turn, or number.
//
// Each key is a real solution to its prompt, because the guard checks hints
// against it. A wrong key here would teach the guard to hold the wrong thing.

import type { AssignmentKind } from "@/lib/api";

export type Example = {
  kind: AssignmentKind;
  course_name: string;
  title: string;
  prompt: string;
  answer_key: string;
  notes: string;
  concepts: string[];
  hint_ceiling: number;
};

export const EXAMPLES: Example[] = [
  {
    kind: "code",
    course_name: "Intro CS, Python recursion",
    title: "Write sum_list(xs) recursively",
    prompt: "Write a recursive function sum_list(xs) that returns the sum of the numbers in the list xs. Do not use a loop or the built-in sum().",
    answer_key: "def sum_list(xs):\n    if not xs:\n        return 0\n    return xs[0] + sum_list(xs[1:])",
    notes: "Lecture 7, slides 12-16: base cases and recursive calls.\nEvery recursive function needs a base case, the input small enough to answer without another call.\nEach recursive call must make progress toward the base case.\nLecture 8, slides 3-9: tracing the call stack and how a return value travels back up.",
    concepts: ["base_case", "recursive_call_progress", "return_value_propagation", "call_stack_tracing"],
    hint_ceiling: 3,
  },
  {
    kind: "code",
    course_name: "Data Structures",
    title: "Binary search on a sorted list",
    prompt: "Write binary_search(xs, target) that returns the index of target in the sorted list xs, or -1 if it is not there. It must run in O(log n) time, so do not scan the list.",
    answer_key: "def binary_search(xs, target):\n    lo, hi = 0, len(xs) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if xs[mid] == target:\n            return mid\n        if xs[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1",
    notes: "Lecture 11, slides 4-10: binary search keeps a window of indexes that could still hold the target.\nThe loop invariant: if the target is in the list, it is inside the window.\nEach step must shrink the window, or the loop never ends.\nLecture 11, slides 11-14: off-by-one errors come from mixing inclusive and exclusive bounds.\nLecture 12, slides 2-6: halving the window each step gives logarithmic time.",
    concepts: ["loop_invariant", "window_bounds", "termination", "time_complexity"],
    hint_ceiling: 3,
  },
  {
    kind: "math",
    course_name: "Calculus I",
    title: "Differentiate with the chain rule",
    prompt: "Find the derivative of f(x) = (3x^2 + 1)^4. Show each step.",
    answer_key: "24x(3x^2 + 1)^3",
    notes: "Lecture 9, pages 3-6: the chain rule differentiates a function inside another function.\nName the outer function and the inner function before you differentiate anything.\nDifferentiate the outer function, leave the inner function untouched inside it, then multiply by the derivative of the inner function.\nLecture 9, page 7: the power rule brings the exponent down and lowers it by one.\nLecture 10, page 2: simplify by multiplying the constants together at the end.",
    concepts: ["identify_inner_outer", "power_rule", "multiply_by_inner_derivative", "simplify"],
    hint_ceiling: 3,
  },
  {
    kind: "written",
    course_name: "Modern European History",
    title: "Why did the French Revolution begin in 1789?",
    prompt: "In one paragraph of about 150 words, explain why the French Revolution began in 1789. Make one clear claim and support it with at least two pieces of evidence from the lectures.",
    answer_key: "The French Revolution began in 1789 because a royal financial crisis collided with a food crisis and gave a newly confident Third Estate the chance to claim power. Decades of war debt left the crown unable to borrow, which forced Louis XVI to summon the Estates General for the first time since 1614. The failed harvest of 1788 doubled the price of bread in Paris, so ordinary people were hungry and angry just as the delegates gathered. When the king refused voting by head, the Third Estate declared itself the National Assembly and swore the Tennis Court Oath, turning a tax dispute into a contest over who held sovereignty.",
    notes: "Lecture 4, slides 2-8: the crown's debt after the Seven Years War and the American war.\nLecture 4, slides 9-12: the Estates General had not met since 1614, and calling it was an admission of bankruptcy.\nLecture 5, slides 1-6: the harvest of 1788 failed and bread prices in Paris doubled by the spring of 1789.\nLecture 5, slides 7-11: the dispute over voting by order or by head, and the Tennis Court Oath.\nLecture 6, slides 1-4: a strong paragraph makes one claim, then gives evidence, then says how the evidence supports the claim.",
    concepts: ["making_a_claim", "using_evidence", "cause_and_effect", "paragraph_structure"],
    hint_ceiling: 2,
  },
  {
    kind: "topic",
    course_name: "Intro CS, Python recursion",
    title: "How recursion works",
    prompt: "Learn how a recursive function calls itself, how it knows when to stop, and how the answers travel back.",
    answer_key: "",
    notes: "Lecture 7, slides 2-6: a recursive function solves a small piece of a problem and calls itself on the rest.\nLecture 7, slides 12-16: the base case is the input small enough to answer without another call.\nEach recursive call must make progress toward the base case, or the calls never end.\nLecture 8, slides 3-9: each call waits on the call stack until the one it made returns.\nA return value travels back up the stack, one waiting call at a time.\nLecture 8, slides 10-12: to trace a recursive function, write one line per call and fill in the return values from the bottom up.",
    concepts: ["what_recursion_is", "base_case", "call_stack", "tracing_by_hand"],
    hint_ceiling: 3,
  },
  {
    kind: "topic",
    course_name: "Statistics 101",
    title: "What a p-value does and does not tell you",
    prompt: "Learn what a p-value measures, how to read one, and the common ways it is misread.",
    answer_key: "",
    notes: "Lecture 14, slides 3-7: the null hypothesis is the claim that nothing is going on.\nA p-value is the chance of seeing data at least this extreme if the null hypothesis were true.\nLecture 14, slides 8-11: a small p-value means the data would be surprising under the null hypothesis.\nA p-value is not the probability that the null hypothesis is true.\nLecture 15, slides 1-5: the 0.05 threshold is a convention, and a result just under it is not much stronger than one just over it.\nLecture 15, slides 6-9: a tiny effect can have a tiny p-value when the sample is very large, so always report the effect size too.",
    concepts: ["null_hypothesis", "what_a_p_value_measures", "common_misreadings", "effect_size"],
    hint_ceiling: 3,
  },
];
