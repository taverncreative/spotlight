"use client";

import { useActionState, useEffect, useState } from "react";
import { Copy, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldInputClass } from "@/components/form-field";
import { cn } from "@/lib/utils";
import type { TemplateStyle } from "@/lib/social/render-template-style";
import {
  createTemplate,
  duplicateTemplate,
  updateTemplateStyle,
  type TemplateActionState,
} from "@/lib/social/template-actions";

// Choosing, copying and creating templates, from inside the editor.
//
// Here rather than on a settings page because a template is a look, and a look
// is judged against a picture. Somewhere you can only see a list of names is
// where templates go stale.
//
// THREE ACTIONS, and only one of them changes how other posts look. Picking a
// template and then moving sliders never writes back -- that falls out of a
// recipe storing only its diff against the template -- so "Update this
// template" is deliberately separate, named, and tells you how many posts it
// reaches before you press it.

export type ControlTemplate = {
  id: string;
  name: string;
  style: Partial<TemplateStyle>;
  // How many saved recipes point at this template, so updating it can say what
  // it is about to affect rather than asking for trust.
  usedBy: number;
};

// These forms sit inside the editor's own form, and forms cannot nest. Each one
// is declared empty here and its fields point back at it by id.
function ActionForm({
  id,
  action,
  fields,
}: {
  id: string;
  action: (formData: FormData) => void;
  fields: Record<string, string>;
}) {
  return (
    <>
      <form id={id} action={action} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} form={id} />
      ))}
    </>
  );
}

export function TemplateControls({
  templates,
  templateId,
  style,
  clientSlug,
  postId,
  onPick,
}: {
  templates: ControlTemplate[];
  templateId: string;
  style: TemplateStyle;
  clientSlug: string;
  postId: string;
  onPick: (templateId: string, style: Partial<TemplateStyle>) => void;
}) {
  const [newName, setNewName] = useState("");
  const [showSaveAs, setShowSaveAs] = useState(false);

  const [createState, createAction, creating] = useActionState<
    TemplateActionState,
    FormData
  >(createTemplate, null);
  const [dupState, dupAction, duplicating] = useActionState<
    TemplateActionState,
    FormData
  >(duplicateTemplate, null);
  const [updateState, updateAction, updating] = useActionState<
    TemplateActionState,
    FormData
  >(updateTemplateStyle, null);

  // DERIVED, not an effect that resets state. React rightly objects to
  // setState inside an effect, and the panel closing after a successful create
  // is a fact about the action's result rather than a separate piece of state
  // that has to be kept in step with it.
  const justCreated = Boolean(createState?.ok);
  const saveAsOpen = showSaveAs && !justCreated;

  const current = templates.find((t) => t.id === templateId);
  const styleJson = JSON.stringify(style);

  // A new or copied template becomes the one being edited, because making one
  // and then having to go and find it is the sort of step that gets skipped.
  // The page revalidates, so by the time this fires the row is in `templates`.
  const created = createState?.ok ? createState.templateId : null;
  const copied = dupState?.ok ? dupState.templateId : null;
  useEffect(() => {
    const id = created ?? copied;
    if (!id || id === templateId) return;
    const next = templates.find((t) => t.id === id);
    if (next) onPick(id, next.style);
    // onPick is stable enough for this: it only ever sets state in the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [created, copied, templates]);

  return (
    <div className="space-y-2 rounded-card border bg-card p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1 space-y-1">
          <span className="text-sm font-medium">Template</span>
          <select
            value={templateId}
            onChange={(event) => {
              const next = templates.find((t) => t.id === event.target.value);
              // Re-resolve from the NEW template's style, so its look actually
              // arrives instead of being masked by the previous one's values
              // carried across as if they had been chosen.
              if (next) onPick(next.id, next.style);
            }}
            className={fieldInputClass}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>

        <ActionForm
          id="duplicate-template-form"
          action={dupAction}
          fields={{
            template_id: templateId,
            client_slug: clientSlug,
            post_id: postId,
          }}
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          form="duplicate-template-form"
          disabled={duplicating || !templateId}
        >
          <Copy aria-hidden="true" className="size-3.5" />
          {duplicating ? "Copying…" : "Duplicate"}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowSaveAs((open) => !open)}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Save as new
        </Button>
      </div>

      {saveAsOpen ? (
        <div className="flex flex-wrap items-end gap-2 border-t pt-2">
          <label className="min-w-48 flex-1 space-y-1">
            <span className="text-xs font-medium">New template name</span>
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Condensed headline, dark"
              className={fieldInputClass}
            />
          </label>
          <ActionForm
            id="create-template-form"
            action={createAction}
            fields={{
              name: newName,
              style: styleJson,
              client_slug: clientSlug,
              post_id: postId,
            }}
          />
          <Button
            type="submit"
            size="sm"
            form="create-template-form"
            disabled={creating || newName.trim().length === 0}
          >
            {creating ? "Saving…" : "Create"}
          </Button>
          <p className="w-full text-xs text-muted-foreground">
            Saves what is on screen as a new look. Nothing else changes.
          </p>
        </div>
      ) : null}

      {/* The only action that changes other posts, so it says so and says how
          many, rather than asking to be trusted. */}
      {current ? (
        <div className="space-y-1 border-t pt-2">
          <ActionForm
            id="update-template-form"
            action={updateAction}
            fields={{
              template_id: templateId,
              style: styleJson,
              client_slug: clientSlug,
              post_id: postId,
            }}
          />
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            form="update-template-form"
            disabled={updating}
          >
            <Save aria-hidden="true" className="size-3.5" />
            {updating ? "Updating…" : `Update “${current.name}”`}
          </Button>
          <p className={cn("text-xs", current.usedBy > 1 ? "text-status-warn" : "text-muted-foreground")}>
            {current.usedBy > 1
              ? `Changes this look everywhere it is used — ${current.usedBy} posts. Already published images are not affected.`
              : "Changes the template itself. Your per-post adjustments stay as they are."}
          </p>
        </div>
      ) : null}

      {justCreated ? (
        <p className="text-sm text-counter-ok">
          Template created, and this post is now using it.
        </p>
      ) : null}

      {createState?.error || dupState?.error || updateState?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {createState?.error ?? dupState?.error ?? updateState?.error}
        </p>
      ) : null}
      {updateState?.ok ? (
        <p className="text-sm text-counter-ok">Template updated.</p>
      ) : null}
    </div>
  );
}
