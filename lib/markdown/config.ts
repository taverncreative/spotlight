import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

// Shared Markdown plugin config. This is the single reference the operator
// preview and the client sites both render through, so a post looks the same
// everywhere it appears.
//
// - remark-gfm: tables, task lists, strikethrough, autolinks.
// - rehype-sanitize: strips unsafe HTML/attributes/protocols against its
//   default schema. react-markdown does not pass raw HTML through unless
//   rehype-raw is added (it is not), so this is defence in depth: post bodies
//   are operator-authored but are reused verbatim on public client sites.
export const remarkPlugins = [remarkGfm];
export const rehypePlugins = [rehypeSanitize];
