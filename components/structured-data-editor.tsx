"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FaqEntry } from "@/lib/posts/structured-data";

// Structured data the operator authors. Today that is FAQ and nothing else.
//
// Article is deliberately absent from this panel: it is composed from the post's
// own fields at read time, so there is nothing here to fill in and a form
// section for it would only invite someone to enter a headline that then drifts
// from the title. The note above says so rather than leaving it a mystery.
//
// Rows travel to the server as one JSON hidden input rather than indexed field
// names, because the row count is dynamic and reassembling faq_question_0,
// faq_answer_0 ... server-side is more moving parts for the same result.

const fieldInputClass =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function StructuredDataEditor({
  entries,
  onChange,
}: {
  entries: FaqEntry[];
  onChange: (entries: FaqEntry[]) => void;
}) {
  const update = (index: number, patch: Partial<FaqEntry>) => {
    onChange(
      entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
    );
  };

  return (
    <div className="space-y-3 rounded-card border bg-card p-4">
      <input
        type="hidden"
        name="faq"
        value={JSON.stringify(
          entries.filter(
            (entry) => entry.question.trim() && entry.answer.trim()
          )
        )}
      />

      <div>
        <p className="text-sm font-medium">Structured data</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Article markup is added automatically from this post&rsquo;s title,
          description, image and dates. Nothing to fill in for it.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          FAQ <span className="font-normal">(optional)</span>
        </p>
        {/*
          THE HONEST VERSION. Google restricted FAQ rich results to recognised
          health and government sites in 2023, so for these clients this markup
          will not produce the expandable questions in search results. It is
          worth having as structure and nothing more, and saying so here is the
          difference between a tool and a sales pitch.
        */}
        <p className="text-xs text-muted-foreground">
          This describes the page accurately for anything reading it as data. It
          will <span className="font-medium">not</span> show as rich results:
          Google restricted those to health and government sites in 2023. Add it
          if the post genuinely answers questions, not for traffic.
        </p>

        {entries.length === 0 ? null : (
          <ul className="space-y-3">
            {entries.map((entry, index) => (
              <li key={index} className="space-y-1.5 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Question {index + 1}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onChange(entries.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">Remove question {index + 1}</span>
                  </Button>
                </div>
                <input
                  value={entry.question}
                  onChange={(event) =>
                    update(index, { question: event.target.value })
                  }
                  placeholder="How long does balayage last?"
                  className={fieldInputClass}
                  aria-label={`Question ${index + 1}`}
                />
                <textarea
                  value={entry.answer}
                  onChange={(event) =>
                    update(index, { answer: event.target.value })
                  }
                  rows={2}
                  placeholder="Three to four months, depending on how often you wash it."
                  className={fieldInputClass}
                  aria-label={`Answer ${index + 1}`}
                />
              </li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...entries, { question: "", answer: "" }])}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Add a question
        </Button>
      </div>
    </div>
  );
}
