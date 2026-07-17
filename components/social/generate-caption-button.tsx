"use client";

import { useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateCaption } from "@/lib/social/caption";

// "Generate caption" for the composer's caption field: rewrites whatever is in
// the box into a hook/teaser/CTA caption and replaces it outright, no confirm.
//
// Calls the action inside a transition rather than a form, because the composer
// is already one and nesting forms is invalid — which is also why the button
// must be type="button", or it would submit the composer instead. The caption
// box is the only context the generator gets, so an empty one has nothing to
// rewrite and the button disables.
//
// A failure never touches the caption: the error is handed up to the composer to
// render under the textarea (where every other field error in this form lives),
// and the box keeps whatever the operator had.
export function GenerateCaptionButton({
  value,
  onGenerated,
  onError,
}: {
  value: string;
  onGenerated: (caption: string) => void;
  onError: (error: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();
  const empty = value.trim() === "";

  function generate() {
    onError(null);
    startTransition(async () => {
      const result = await generateCaption(value);
      if (result.ok) onGenerated(result.caption);
      else onError(result.error);
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={generate}
      disabled={pending || empty}
      title={
        empty
          ? "Add a topic or notes first"
          : "Rewrite this into a social caption"
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {pending ? "Generating…" : "Generate caption"}
    </Button>
  );
}
