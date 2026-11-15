"use client";

import { Button, Label, ListBox, SearchField, Select, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { conceptLabel, type StudentStatus, type StudentSummary } from "@/lib/api";

/**
 * What the professor has narrowed the student list to.
 *
 * Every filter is a question a teacher asks before office hours ("who hasn't
 * started?", "who is stuck on recursion?", "who needed the slides?"), never a
 * ranking: there is no sort by speed or by struggle, and the list keeps the
 * order students started in. All of it runs on the roster the page already
 * has, so filtering sends nothing anywhere.
 */
export type StudentFilter = {
  query: string;
  status: "all" | StudentStatus;
  struggle: "any" | "struggling" | "none";
  concept: string;
  /** 0 is any. 2 means the student reached the slides or above; 3, the worked example. */
  minLevel: 0 | 2 | 3;
};

export const NO_FILTER: StudentFilter = { query: "", status: "all", struggle: "any", concept: "all", minLevel: 0 };

/** True when this student matches every part of the filter. */
export function matches(s: StudentSummary, f: StudentFilter): boolean {
  if (f.query.trim() && !s.display_name.toLowerCase().includes(f.query.trim().toLowerCase())) return false;
  if (f.status !== "all" && s.status !== f.status) return false;
  const struggling = s.concept !== null && s.struggle_type !== "none";
  if (f.struggle === "struggling" && !struggling) return false;
  if (f.struggle === "none" && (struggling || s.status === "not_started")) return false;
  if (f.concept !== "all" && s.concept !== f.concept) return false;
  if (f.minLevel > 0 && (s.max_hint_level ?? 0) < f.minLevel) return false;
  return true;
}

const STATUS: { id: StudentFilter["status"]; label: string }[] = [
  { id: "all", label: "All" },
  { id: "not_started", label: "Not started" },
  { id: "in_progress", label: "In progress" },
  { id: "finished", label: "Finished" },
];

/**
 * The search box and filters above the student cards. The count beside it
 * says how many of the class are shown, so an empty result reads as "nobody
 * matches", not as a broken page.
 */
export function StudentFilters({
  filter,
  onChange,
  concepts,
  students,
}: {
  filter: StudentFilter;
  onChange: (f: StudentFilter) => void;
  concepts: string[];
  students: StudentSummary[];
}) {
  const set = <K extends keyof StudentFilter>(key: K, value: StudentFilter[K]) => onChange({ ...filter, [key]: value });
  const shown = students.filter((s) => matches(s, filter)).length;
  const count = (status: StudentFilter["status"]) => (status === "all" ? students.length : students.filter((s) => s.status === status).length);
  const active = JSON.stringify(filter) !== JSON.stringify(NO_FILTER);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <SearchField value={filter.query} onChange={(v) => set("query", v)} className="w-full sm:w-64">
          <Label>Search students</Label>
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Name" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        {/* On a phone the four filters are wider than the screen; the group scrolls sideways inside its own width instead of pushing the whole panel wider. */}
        <ToggleButtonGroup
          aria-label="Progress"
          className="max-w-full overflow-x-auto [scrollbar-width:none]"
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[filter.status]}
          onSelectionChange={(keys) => set("status", ([...keys][0] ?? "all") as StudentFilter["status"])}
          size="sm"
        >
          {STATUS.map((s) => (
            <ToggleButton key={s.id} id={s.id}>
              {s.label} <span className="tabular-nums text-muted">{count(s.id)}</span>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label="Struggle"
          value={filter.struggle}
          onChange={(v) => set("struggle", v as StudentFilter["struggle"])}
          options={[
            ["any", "Any"],
            ["struggling", "Struggling"],
            ["none", "No struggle"],
          ]}
        />
        <FilterSelect
          label="Concept"
          value={filter.concept}
          onChange={(v) => set("concept", v)}
          options={[["all", "All concepts"], ...concepts.map((c) => [c, conceptLabel(c)] as [string, string])]}
        />
        <FilterSelect
          label="Hint level reached"
          value={String(filter.minLevel)}
          onChange={(v) => set("minLevel", Number(v) as StudentFilter["minLevel"])}
          options={[
            ["0", "Any"],
            ["2", "Level 2+ (the slides)"],
            ["3", "Level 3 (worked example)"],
          ]}
        />
        <p className="pb-2 text-sm text-muted" role="status">
          Showing <span className="tabular-nums">{shown}</span> of <span className="tabular-nums">{students.length}</span>
        </p>
        {active ? (
          <Button size="sm" variant="ghost" className="mb-1" onPress={() => onChange(NO_FILTER)}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** One labelled HeroUI select over a fixed list of [value, label] pairs. */
function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <Select value={value} onChange={(key) => key !== null && onChange(String(key))} className="w-full sm:w-52">
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map(([id, text]) => (
            <ListBox.Item key={id} id={id} textValue={text}>
              {text}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
