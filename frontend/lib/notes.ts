// A keyword search over the professor's pasted notes, on the student's own
// machine (Cortex's "search the source", with no search service). Revision
// cards used to be cut here too; they now come from the server (D-R4), which
// can run the guard's check against the answer key before a card is shown.
//
// The notes are in the student-safe assignment body, so nothing here asks the
// server for more.

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
