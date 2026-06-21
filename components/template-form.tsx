"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormField, fieldInputClass } from "@/components/form-field";
import { SectionCard } from "@/components/section-card";
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABELS,
} from "@/lib/templates/schemas";
import { extractTokens, fillTemplate } from "@/lib/templates/fill";
import { MERGE_FIELDS, MERGE_FIELD_TOKENS, SAMPLE_CONTEXT } from "@/lib/templates/merge-fields";
import type { FormState } from "@/lib/form-state";

type TemplateFormValues = {
  name?: string | null;
  category?: string | null;
  subject?: string | null;
  body?: string | null;
};

// One form for create and edit. The subject and body are controlled so the live
// preview can fill them with the catalogue's sample data using the same fill
// engine the send path will use, and so a gentle warning can flag any
// well-formed token that is not a known merge field (a likely typo). The token
// list inserts {{token}} at the cursor. The action still submits the controlled
// fields by their name attributes.
export function TemplateForm({
  action,
  ariaLabel,
  submitLabel,
  initial = {},
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  ariaLabel: string;
  submitLabel: string;
  initial?: TemplateFormValues;
  cancelHref?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [name, setName] = useState(initial.name ?? "");
  const [category, setCategory] = useState(initial.category ?? "general");
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [body, setBody] = useState(initial.body ?? "");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const preview = fillTemplate({ subject: subject || null, body }, SAMPLE_CONTEXT);

  const unknownTokens = useMemo(() => {
    const used = extractTokens(`${subject}\n${body}`);
    return used.filter((token) => !MERGE_FIELD_TOKENS.includes(token));
  }, [subject, body]);

  function insertToken(token: string) {
    const snippet = `{{${token}}}`;
    const textarea = bodyRef.current;
    if (!textarea) {
      setBody((current) => current + snippet);
      return;
    }
    const start = textarea.selectionStart ?? body.length;
    const end = textarea.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + snippet + body.slice(end));
    requestAnimationFrame(() => {
      const caret = start + snippet.length;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  }

  return (
    <form action={formAction} aria-label={ariaLabel} className="space-y-6">
      {state?.formError ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.formError}
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <FormField label="Name" name="name" errors={state?.fieldErrors?.name}>
            <input
              id="name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={fieldInputClass}
            />
          </FormField>

          <FormField
            label="Category"
            name="category"
            errors={state?.fieldErrors?.category}
          >
            <select
              id="category"
              name="category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className={fieldInputClass}
            >
              {TEMPLATE_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {TEMPLATE_CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </FormField>

          <FormField
            label="Subject"
            name="subject"
            errors={state?.fieldErrors?.subject}
          >
            <input
              id="subject"
              name="subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className={fieldInputClass}
            />
          </FormField>

          <FormField label="Body" name="body" errors={state?.fieldErrors?.body}>
            <textarea
              id="body"
              name="body"
              ref={bodyRef}
              rows={10}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className={fieldInputClass}
            />
          </FormField>

          {unknownTokens.length ? (
            <p
              role="status"
              className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-300"
            >
              Unrecognised{" "}
              {unknownTokens.length === 1 ? "placeholder" : "placeholders"}:{" "}
              {unknownTokens.map((token) => `{{${token}}}`).join(", ")}. These are
              not known merge fields and will be empty when the template is used,
              so check for a typo.
            </p>
          ) : null}
        </div>

        <div className="space-y-6">
          <SectionCard title="Preview">
            <p className="text-xs text-muted-foreground">
              Filled with sample data, using the same engine the send path uses.
            </p>
            <div className="space-y-3 rounded-lg bg-muted/40 p-4 text-sm">
              <div className="space-y-1">
                <p className="text-xs uppercase text-muted-foreground">Subject</p>
                <p className="font-medium">
                  {preview.subject || (
                    <span className="font-normal text-muted-foreground">
                      No subject
                    </span>
                  )}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase text-muted-foreground">Body</p>
                <p className="whitespace-pre-wrap">
                  {preview.body || (
                    <span className="text-muted-foreground">Nothing yet</span>
                  )}
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Placeholders">
            <p className="text-xs text-muted-foreground">
              Click to insert a placeholder into the body.
            </p>
            <ul className="space-y-1">
              {MERGE_FIELDS.map((field) => (
                <li
                  key={field.token}
                  className="flex flex-wrap items-baseline gap-2"
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Insert ${field.token}`}
                    onClick={() => insertToken(field.token)}
                  >
                    {`{{${field.token}}}`}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {field.description}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : submitLabel}
        </Button>
        {cancelHref ? (
          <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
            Cancel
          </Link>
        ) : null}
      </div>
    </form>
  );
}
