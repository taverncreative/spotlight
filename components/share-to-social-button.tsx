"use client";

import { useFormStatus } from "react-dom";
import { Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// The submit button for the blog card's Share-to-social form. Lives in its own
// client component so useFormStatus can read the enclosing form's pending state:
// the shareToSocial action copies the featured image (~a second or two) before
// redirecting, so without this the button gives no feedback and feels broken.
// Matches the app's pending convention: disable and swap to a "Sharing…" state.
export function ShareToSocialButton({ title }: { title: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      aria-label={
        pending
          ? `Sharing "${title}" to social…`
          : `Share "${title}" to social`
      }
      title={pending ? "Sharing…" : "Share to social"}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Share2 />}
    </Button>
  );
}
