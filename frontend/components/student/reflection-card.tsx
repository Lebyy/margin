"use client";

import { Button, Card, Label, TextArea, TextField } from "@heroui/react";
import { Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { api, type Reflection } from "@/lib/api";

/**
 * The two questions after the last question: one "why did you do it this
 * way", and one "what if" about one of the problems.
 *
 * The server wrote them when the student pressed Finish, checked them against
 * every answer key, and stored them, so this card only shows and saves. The
 * answers are formative: the professor reads them on the dashboard, and
 * nothing scores them. A save replaces the earlier answer, so the student can
 * come back and revise. The card fades in because it appears in response to
 * Finish; with reduced motion it simply appears.
 */
export function ReflectionCard({ sessionId, reflection, questionCount }: { sessionId: string; reflection: Reflection; questionCount: number }) {
  const [why, setWhy] = useState(reflection.answers.why);
  const [whatIf, setWhatIf] = useState(reflection.answers.what_if);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(reflection.answers.why.length > 0 || reflection.answers.what_if.length > 0);
  const [error, setError] = useState<string | null>(null);
  const reduce = useReducedMotion();

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.saveReflection(sessionId, { why, what_if: whatIf });
      setSaved(true);
    } catch {
      setError("Not saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Card>
        <Card.Content className="flex flex-col gap-4">
          <div>
            <h2 className="font-serif text-2xl font-semibold tracking-tight">Look back</h2>
            <p className="text-sm text-muted">You finished. Two questions about how you got there. Your professor reads your answers; they are not graded.</p>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <TextField
              value={why}
              onChange={(v) => {
                setWhy(v);
                setSaved(false);
              }}
              fullWidth
              name="reflection_why"
            >
              <Label className="font-serif text-lg leading-7">{reflection.why}</Label>
              <TextArea rows={3} maxLength={2000} />
            </TextField>
            <TextField
              value={whatIf}
              onChange={(v) => {
                setWhatIf(v);
                setSaved(false);
              }}
              fullWidth
              name="reflection_what_if"
            >
              <Label className="font-serif text-lg leading-7">
                {questionCount > 1 ? <span className="mr-1.5 text-sm font-normal text-muted">Question {reflection.what_if_index + 1}.</span> : null}
                {reflection.what_if}
              </Label>
              <TextArea rows={3} maxLength={2000} />
            </TextField>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" isPending={saving} isDisabled={saving || (why.trim().length === 0 && whatIf.trim().length === 0)}>
                Save answers
              </Button>
              {saved && !saving ? (
                <span className="inline-flex items-center gap-1 text-sm text-muted" role="status">
                  <Check className="size-4 text-margin-green" aria-hidden /> Saved
                </span>
              ) : null}
              {error ? <span className="text-sm text-danger" role="alert">{error}</span> : null}
            </div>
          </form>
        </Card.Content>
      </Card>
    </motion.div>
  );
}
