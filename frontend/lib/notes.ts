// Two things built from the professor's pasted notes, both on the student's
// own machine: a keyword search (Cortex's "search the source", with no search
// service) and revision cards (MindPad's revise loop, without the answer).
//
// The notes are in the student-safe assignment body, so nothing here asks the
// server for more. The answer key is not in that body, which is why a card can
// never show a solution line: the only text it can draw from is text the
// professor chose to show the class.

/** One line of the notes that matched a search, with the words that matched. */
export type NoteHit = { line: string; index: number; terms: string[] };

/** Words worth matching. Two-letter words match half the notes and tell the student nothing. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/**
 * Lines of the notes that share a word with the query, in the notes' own order.
 * The order is the lecture's order, not a relevance score. A student looking for "base case" should land on the first place the professor introduced it.
 */
export function searchNotes(notes: string, query: string): NoteHit[] {
  const wanted = words(query);
  if (wanted.length === 0) return [];
  const hits: NoteHit[] = [];
  notes.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const lower = line.toLowerCase();
    const terms = wanted.filter((w) => lower.includes(w));
    if (terms.length > 0) hits.push({ line, index, terms });
  });
  return hits;
}

/** A revision card: a line of the notes with one term hidden, and that term. */
export type Flashcard = { id: string; concept: string; before: string; hidden: string; after: string };

/**
 * Cards for one concept, made by hiding that concept's words in the notes.
 *
 * `base_case` looks for "base case" (and "base cases") in each line. A line
 * that mentions it becomes a card with the phrase blanked. The student
 * recalls the term, then flips the card to check against the professor's own
 * sentence.
 *
 * No model writes these. A generated card could state something the professor
 * never taught, or drift toward the assignment's answer. A card cut from the
 * notes can do neither. When the notes do not mention the concept, there are
 * no cards, and the panel says so instead of inventing one.
 */
export function flashcards(notes: string, concept: string): Flashcard[] {
  const phrase = concept.replace(/_/g, " ").trim();
  if (!phrase) return [];
  // The phrase, allowing any spacing or hyphen between its words and a plural ending.
  const pattern = new RegExp(phrase.split(/\s+/).map(escape).join("[\\s-]+") + "(?:e?s)?", "i");
  const cards: Flashcard[] = [];
  notes.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    const match = pattern.exec(line);
    if (!match) return;
    cards.push({
      id: `${concept}-${index}`,
      concept,
      before: line.slice(0, match.index),
      hidden: match[0],
      after: line.slice(match.index + match[0].length),
    });
  });
  return cards;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
