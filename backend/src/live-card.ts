// The Thursday card, kept current while students work.
//
// A professor should not have to press "Generate again" to see where the
// class is stuck today. But writing the card is a model call, and the class's
// numbers barely move turn to turn, so it is rewritten in batches: after at
// least BATCH_TURNS new student turns on the assignment, and no sooner than
// MIN_INTERVAL_MS after the last card. Between batches the dashboard's own
// numbers (heatmap, roster) are live already, counted in code on each read.
//
// The refresh runs in the background, after the student's reply has been
// sent, so a student never waits on it. One refresh per assignment at a time;
// a failure is logged and the next batch tries again. A background card is
// not sent as a professor message (coach.ts, `notify`).
//
// The counter lives in this process. A restart starts each assignment's count
// at zero, which only delays the next refresh by one batch.

import { generateThursdayCard } from "./coach.ts";
import type { TextGenerator } from "./llm.ts";
import { ThursdayCard } from "./models.ts";

/** New student turns that make a batch. */
export const BATCH_TURNS = 10;
/** The least time between two background cards for one assignment. */
export const MIN_INTERVAL_MS = 10 * 60 * 1000;

type State = { pending: number; running: boolean; lastAt: number | null };
const states = new Map<string, State>();

/**
 * Counts one student turn on the assignment, and starts a background refresh when a batch is due.
 * Returns the refresh's promise (for tests), or null when nothing was started. Never throws.
 */
export function noteStudentTurn(assignmentId: string, generate?: TextGenerator, now = Date.now()): Promise<void> | null {
  const state = states.get(assignmentId) ?? { pending: 0, running: false, lastAt: null };
  states.set(assignmentId, state);
  state.pending += 1;
  if (state.running || state.pending < BATCH_TURNS) return null;
  state.running = true;
  return (async () => {
    try {
      // The last card's time is read from the database the first time, so a restart does not make a card early.
      if (state.lastAt === null) {
        const last = await ThursdayCard.findOne({ assignment_id: assignmentId }).sort({ generated_at: -1 }).select("generated_at").lean();
        state.lastAt = last ? new Date(last.generated_at as Date).getTime() : 0;
      }
      if (now - state.lastAt < MIN_INTERVAL_MS) return;
      const result = await generateThursdayCard(assignmentId, generate, false);
      state.lastAt = now;
      state.pending = 0;
      if (!result.ok && result.reason !== "no_struggles_yet") console.error("live card not written:", result.reason);
    } catch (error) {
      console.error("live card failed:", (error as Error).name);
    } finally {
      state.running = false;
    }
  })();
}

/** For tests: forget every assignment's count. */
export function resetLiveCards(): void {
  states.clear();
}
