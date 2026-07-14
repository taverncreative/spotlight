import ReactMarkdown from "react-markdown";
import { remarkPlugins, rehypePlugins } from "./config";

// Canonical Markdown renderer, shared by the operator-only preview and the
// client sites. Renders inside a Server Component (no client JS shipped) and
// wraps output in `.post-editor` by default so it matches the blog editor's
// typography exactly. Pass `className` to restyle for a different surface.
export function Markdown({
  children,
  className = "post-editor",
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
