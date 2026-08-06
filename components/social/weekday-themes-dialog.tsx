"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { fieldInputClass } from "@/components/form-field";
import { updateWeekdayThemes } from "@/lib/clients/settings-actions";
import {
  MAX_THEME_LENGTH,
  WEEKDAY_NAMES,
  normaliseThemes,
} from "@/lib/calendar/weekday-themes";

// The weekday theme editor, opened from the social calendar's own header.
//
// SEVEN INPUTS AND ONE SAVE, not a row of inline-editable headers. Themes are
// set as a set -- you are describing a week, and the useful question is "what
// does the whole week look like", which you cannot see while editing one column
// at a time. It is also a rare edit: decided once, adjusted occasionally.
//
// Opens with the saved values, discards on cancel, and only the save round-trips
// to the server, so a half-typed week is never written.
export function WeekdayThemesDialog({
  clientId,
  clientSlug,
  themes,
}: {
  clientId: string;
  clientSlug: string;
  themes: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(themes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each open starts from what is saved, so closing without saving really does
  // discard: without this the component would keep the last abandoned draft for
  // the life of the page.
  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft(themes);
      setError(null);
    }
    setOpen(next);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const result = await updateWeekdayThemes(
      clientId,
      clientSlug,
      normaliseThemes(draft)
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Could not save the themes.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => handleOpenChange(true)}
        className="text-muted-foreground"
      >
        <CalendarRange />
        Themes
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <div className="space-y-1">
            <DialogTitle>Weekday themes</DialogTitle>
            <DialogDescription>
              What each day of the week is for, shown above the calendar
              columns. Leave a day blank if it has no theme. Changing one
              relabels every week, past ones included, because a theme describes
              what a day is for rather than what went out on it.
            </DialogDescription>
          </div>

          <div className="space-y-2">
            {WEEKDAY_NAMES.map((name, index) => (
              <label key={name} className="flex items-center gap-3 text-sm">
                <span className="w-20 shrink-0 text-muted-foreground">
                  {name}
                </span>
                <input
                  // Named explicitly rather than leaning on the wrapping
                  // label: every one of the seven shares the "No theme"
                  // placeholder, and that is what the accessibility tree was
                  // reading out -- seven identical fields.
                  aria-label={`${name} theme`}
                  value={draft[index] ?? ""}
                  maxLength={MAX_THEME_LENGTH}
                  onChange={(event) =>
                    setDraft((current) =>
                      current.map((theme, slot) =>
                        slot === index ? event.target.value : theme
                      )
                    )
                  }
                  placeholder="No theme"
                  className={fieldInputClass}
                />
              </label>
            ))}
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving" : "Save themes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
