"use client";

import { Button, Card } from "@heroui/react";
import { browser } from "@/lib/browser";
import { PROF_PROFILES } from "@/lib/profiles";

/**
 * What a professor page shows before a professor profile is chosen.
 *
 * Without a profile there is no "my classes", and showing every class would
 * put one professor's students in front of another. So the page asks first,
 * offering the same profiles as the header menu. Choosing one is a label this
 * browser remembers, not a login (there is no real auth this weekend), and the
 * page reloads so nothing read under no profile stays on screen.
 */
export function ChooseProfessor({ reason = "Choose who you are to see the classes you teach." }: { reason?: string }) {
  return (
    <Card className="mx-auto mt-10 w-full max-w-xl">
      <Card.Header>
        <Card.Title>Which professor are you?</Card.Title>
        <Card.Description>{reason}</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2">
        {PROF_PROFILES.map((p) => (
          <Button
            key={p.name}
            variant="secondary"
            className="justify-between"
            onPress={() => {
              browser.chooseProf(p.name);
              window.location.reload();
            }}
          >
            <span className="font-medium">{p.name}</span>
            <span className="text-sm text-muted">{p.courseName}</span>
          </Button>
        ))}
      </Card.Content>
    </Card>
  );
}
