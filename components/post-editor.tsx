"use client";

import { useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import LinkExtension from "@tiptap/extension-link";
import ImageExtension from "@tiptap/extension-image";
import { Markdown } from "tiptap-markdown";
import {
  Bold,
  Italic,
  Heading2,
  Heading3,
  Quote,
  List,
  ListOrdered,
  Link2,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadPostImage } from "@/lib/posts/image-upload";

// WYSIWYG body editor (Tiptap) that stores and round-trips clean Markdown via
// tiptap-markdown. immediatelyRender: false avoids SSR/hydration mismatch under
// Next 16 (the editor mounts client-side after first paint).
export function PostEditor({
  clientId,
  initialMarkdown,
  onChange,
}: {
  clientId: string;
  initialMarkdown: string;
  onChange: (markdown: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      LinkExtension.configure({ openOnClick: false }),
      ImageExtension,
      Markdown,
    ],
    content: initialMarkdown,
    editorProps: {
      attributes: {
        class: "post-editor min-h-64 px-3 py-2 text-sm focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.storage.markdown.getMarkdown());
    },
  });

  if (!editor) {
    return <div className="min-h-72 rounded-md border bg-transparent" />;
  }

  const insertImage = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const result = await uploadPostImage(file, clientId);
      if (result.ok) {
        // Alt is skippable (Cancel or blank inserts without); the ALT toolbar
        // button can add or edit it later. tiptap-markdown serializes it as
        // ![alt](url), so it flows to every renderer with no further plumbing.
        const alt = window.prompt(
          "Alt text (describe the image; leave blank to skip)",
          ""
        );
        editor
          .chain()
          .focus()
          .setImage({ src: result.url, ...(alt ? { alt } : {}) })
          .run();
      } else {
        setUploadError(result.error);
      }
    } finally {
      setUploading(false);
    }
  };

  const editAlt = () => {
    if (!editor.isActive("image")) return;
    const current = (editor.getAttributes("image").alt as string | null) ?? "";
    const input = window.prompt(
      "Alt text (describe the image for screen readers and SEO)",
      current
    );
    if (input === null) return;
    editor.chain().focus().updateAttributes("image", { alt: input }).run();
  };

  const toggleLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const input = window.prompt("Link URL", previous ?? "");
    if (input === null) return;
    if (input === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: input })
      .run();
  };

  return (
    <div className="rounded-md border bg-transparent">
      <div className="flex flex-wrap gap-1 border-b p-1">
        <ToolButton
          label="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="size-4" />
        </ToolButton>
        <ToolButton
          label="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="size-4" />
        </ToolButton>
        <ToolButton
          label="Heading 2"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          <Heading2 className="size-4" />
        </ToolButton>
        <ToolButton
          label="Heading 3"
          active={editor.isActive("heading", { level: 3 })}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 3 }).run()
          }
        >
          <Heading3 className="size-4" />
        </ToolButton>
        <ToolButton
          label="Quote"
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="size-4" />
        </ToolButton>
        <ToolButton
          label="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="size-4" />
        </ToolButton>
        <ToolButton
          label="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="size-4" />
        </ToolButton>
        <ToolButton
          label="Link"
          active={editor.isActive("link")}
          onClick={toggleLink}
        >
          <Link2 className="size-4" />
        </ToolButton>
        <ToolButton
          label={uploading ? "Uploading image…" : "Insert image"}
          active={false}
          onClick={() => {
            if (!uploading) fileRef.current?.click();
          }}
        >
          <ImageIcon className="size-4" />
        </ToolButton>
        <ToolButton
          label="Alt text (select an image first)"
          active={editor.isActive("image")}
          disabled={!editor.isActive("image")}
          onClick={editAlt}
        >
          <span className="text-[10px] font-semibold tracking-wide">ALT</span>
        </ToolButton>
      </div>

      <EditorContent editor={editor} />
      {uploadError ? (
        <p className="px-3 pb-2 text-sm text-destructive">{uploadError}</p>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) insertImage(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function ToolButton({
  label,
  active,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        active && "bg-accent text-brand",
        disabled && "pointer-events-none opacity-40"
      )}
    >
      {children}
    </button>
  );
}
