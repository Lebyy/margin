// Level-2 citation search over the professor's pasted notes (D-R3).
//
// At level 2 the tutor points the student at the professor's own material:
// "Lecture 7, slides 12-16". The deepagent's cite_notes tool calls this with
// the concept the student is stuck on, and cites what comes back.
//
// The search is MiniSearch, an in-memory full-text index: ranked results,
// prefix matching ("recurs" finds "recursive" and "recursion"), and a small
// edit-distance allowance for typos. It is a string match over the notes the
// professor pasted, so there is no vector database, no embeddings service,
// and no model call (board: D-R3 "Do not").
//
// What gets indexed is a passage, not a line. Professors write a heading
// such as "Lecture 7, slides 12-16" and put the explanation under it; a
// line-by-line match returns the explanation without the slide numbers, and
// the tutor then has nothing to cite. A short section is one passage, heading
// included. A long paste (D-R5) is cut into passages that each carry their
// lecture and heading name, so the citation survives however deep the match is.

import MiniSearch from "minisearch";

/** Sent when nothing matches, so the model cannot read silence as permission to invent a citation. */
export const NO_MATCH = "No matching line in the notes.";

/** How many sections one search returns. Enough for a heading and its neighbour, short enough for the prompt. */
const MAX_SECTIONS = 3;

/** A returned section longer than this is cut. The citation sits at the start of a section, and the notes go into a model prompt. */
const MAX_SECTION_CHARS = 800;

/**
 * A line that starts a new part of the notes: "Lecture 7", "Slides 12-16",
 * "Week 3", "Chapter 2", "Section 4.1", or a markdown heading. Blank lines
 * split sections too.
 */
const HEADING = /^\s*(#+\s|(lecture|lec|slides?|week|chapter|section|unit|topic)\b)/i;

/**
 * A heading that names a whole lecture (or week, chapter, unit). Slide and
 * section headings under it are lower-level: a pasted lecture usually reads
 * "Lecture 7" once and then "Slide 12", "Slide 13". Each slide is its own
 * section, and without the lecture's name the tutor could only cite "Slide 13".
 */
const TOP_HEADING = /^\s*(#\s|(lecture|lec|week|chapter|unit)\b)/i;

/** A passage of a long section, kept under the clip so the matching sentence is not cut off. */
const PASSAGE_CHARS = 600;

/**
 * The short name in a heading line: "Lecture 7, slides 12-16" from
 * "Lecture 7, slides 12-16: recursion. Every recursive function ...". Only
 * this goes in front of later passages, not the whole first line.
 */
function headingName(line: string): string {
  const cut = line.search(/[:.]\s/);
  return (cut === -1 ? line : line.slice(0, cut)).slice(0, 80).trim();
}

/**
 * The notes as searchable passages.
 *
 * 1. Sections: split at blank lines and at heading lines, each heading kept
 *    with the lines under it.
 * 2. A section under a lecture heading that does not start with it (a slide,
 *    a sub-section, a paragraph after a blank line) gets the lecture's short
 *    name in front, so a match anywhere in Lecture 7 can be cited as Lecture 7.
 * 3. A section longer than PASSAGE_CHARS is split at sentence ends into
 *    passages, each with the section's heading name in front. A long paste
 *    often has no blank lines at all, and clipping it from the start would
 *    drop the sentence that matched.
 */
export function noteSections(notes: string): string[] {
  const sections: string[][] = [];
  let current: string[] = [];
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || HEADING.test(line)) {
      if (current.length > 0) sections.push(current);
      current = [];
    }
    if (line.length > 0) current.push(line);
  }
  if (current.length > 0) sections.push(current);

  const passages: string[] = [];
  let lecture: string | null = null;
  for (const lines of sections) {
    if (TOP_HEADING.test(lines[0])) lecture = headingName(lines[0]);
    const own = HEADING.test(lines[0]) ? headingName(lines[0]) : null;
    const context = [lecture && !lines[0].startsWith(lecture) ? lecture : null, own].filter(Boolean).join(", ");
    const text = lines.join("\n");
    const prefix = lecture && !lines[0].startsWith(lecture) ? `${lecture}, ` : "";
    if (text.length + prefix.length <= PASSAGE_CHARS) {
      passages.push(prefix + text);
      continue;
    }
    // Sentences, grouped up to PASSAGE_CHARS. The first passage starts with
    // the section's own first line; later ones are labelled with its heading.
    const sentences = text.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? [text];
    let chunk = "";
    let first = true;
    const flush = () => {
      if (chunk.trim().length === 0) return;
      const label = first ? prefix : context ? `${context}, ` : "";
      passages.push(label + chunk.trim());
      chunk = "";
      first = false;
    };
    for (const sentence of sentences) {
      if (chunk.length + sentence.length > PASSAGE_CHARS) flush();
      chunk += sentence;
    }
    flush();
  }
  return passages;
}

/**
 * The notes sections that best match the query, best first, or NO_MATCH.
 *
 * Words are split on anything that is not a letter or digit, so the
 * scribe's `base_case` and a typed "base case" are the same query. Terms are
 * OR-ed and ranked by MiniSearch's BM25 score, so a section that mentions
 * both "base" and "case" outranks one that only says "case". Fuzzy matching
 * is limited to words of 5 letters or more: a typo allowance on short words
 * would make "list" match "last" and return unrelated sections.
 */
export function searchNotes(notes: string, query: string): string {
  const sections = noteSections(notes);
  if (sections.length === 0 || query.trim().length === 0) return NO_MATCH;

  const index = new MiniSearch<{ id: number; text: string }>({
    fields: ["text"],
    storeFields: ["text"],
    tokenize: (text) => text.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0),
    processTerm: (term) => (term.length < 2 ? null : term.toLowerCase()),
    searchOptions: {
      prefix: (term) => term.length >= 4,
      fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
      combineWith: "OR",
    },
  });
  index.addAll(sections.map((text, id) => ({ id, text })));

  const hits = index.search(query).slice(0, MAX_SECTIONS);
  if (hits.length === 0) return NO_MATCH;
  return hits.map((hit) => clip(hit.text as string)).join("\n\n");
}

function clip(text: string): string {
  return text.length <= MAX_SECTION_CHARS ? text : `${text.slice(0, MAX_SECTION_CHARS)}...`;
}
