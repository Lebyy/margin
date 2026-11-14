"use client";

import { Button, Chip, Spinner } from "@heroui/react";
import { Check, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { api, conceptLabel, type QuizQuestion } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A self-check quiz written from the class notes.
 *
 * It loads when the student asks for it, so a student who never quizzes
 * spends no model call. Each answer is checked here, on the student's own
 * machine, and the reason is shown at once. Nothing about how they did is
 * sent anywhere or stored: this is practice, and a quiz that reported a score
 * to the professor would be a grade.
 *
 * The count at the end is this student's own, shown only to them.
 */
export function Quiz({ assignmentId }: { assignmentId: string }) {
  const [questions, setQuestions] = useState<QuizQuestion[] | "loading" | null>(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [right, setRight] = useState(0);

  async function start() {
    setQuestions("loading");
    setIndex(0);
    setPicked(null);
    setRight(0);
    try {
      setQuestions((await api.quiz(assignmentId)).questions);
    } catch {
      setQuestions([]);
    }
  }

  if (questions === null) {
    return (
      <Button variant="secondary" className="mt-5 w-full" onPress={() => void start()}>
        Quiz me
      </Button>
    );
  }
  if (questions === "loading") {
    return (
      <div className="mt-5 flex items-center justify-center gap-2 py-6 text-sm text-muted">
        <Spinner size="sm" /> Writing your quiz
      </div>
    );
  }
  if (questions.length === 0) return <p className="mt-5 text-sm text-muted">No quiz yet. The notes do not cover enough.</p>;

  if (index >= questions.length) {
    return (
      <div className="mt-5 rounded-2xl border border-border px-4 py-6 text-center">
        <p className="font-serif text-4xl font-semibold text-margin-red">
          {right} / {questions.length}
        </p>
        <p className="mt-1 text-sm text-muted">Only you see this.</p>
        <Button variant="ghost" className="mt-3" onPress={() => void start()}>
          <RotateCcw className="size-4" aria-hidden /> Again
        </Button>
      </div>
    );
  }

  const q = questions[index];
  return (
    <section aria-label="Quiz" className="mt-5 rounded-2xl border border-border px-4 py-4">
      <div className="mb-2 flex items-center justify-between">
        <Chip size="sm" variant="soft" color="accent">
          {conceptLabel(q.concept)}
        </Chip>
        <span className="text-xs tabular-nums text-muted">
          {index + 1} / {questions.length}
        </span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={index} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}>
          <p className="font-serif text-lg leading-7">{q.question}</p>
          <div className="mt-3 flex flex-col gap-2">
            {q.choices.map((choice, i) => {
              const isRight = i === q.answer;
              const shown = picked !== null;
              return (
                <Button
                  key={i}
                  variant="outline"
                  isDisabled={shown}
                  className={cn("h-auto justify-start whitespace-normal px-3 py-2.5 text-left", shown && isRight && "border-margin-green bg-margin-green-soft opacity-100", shown && picked === i && !isRight && "border-margin-red bg-margin-red-soft opacity-100")}
                  onPress={() => {
                    setPicked(i);
                    if (isRight) setRight((n) => n + 1);
                  }}
                >
                  {shown && isRight ? <Check className="size-4 shrink-0 text-margin-green" aria-label="Right answer" /> : null}
                  {shown && picked === i && !isRight ? <X className="size-4 shrink-0 text-margin-red" aria-label="Your answer" /> : null}
                  {choice}
                </Button>
              );
            })}
          </div>
          {picked !== null ? (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3">
              <p className="text-sm leading-6 text-muted">{q.why}</p>
              <Button
                variant="primary"
                className="mt-3"
                onPress={() => {
                  setIndex(index + 1);
                  setPicked(null);
                }}
              >
                {index + 1 === questions.length ? "Finish" : "Next"}
              </Button>
            </motion.div>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
