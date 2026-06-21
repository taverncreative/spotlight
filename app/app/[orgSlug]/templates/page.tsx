import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FilterPill } from "@/components/filter-pill";
import { ListScreen, EmptyState, TableCard } from "@/components/list-screen";
import { TemplateDeleteDialog } from "@/components/template-delete-dialog";
import { AuthorisationError, hasPermission } from "@/lib/authorisation";
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_CATEGORY_LABELS,
} from "@/lib/templates/schemas";
import { requireWorkspaceAccess } from "@/lib/workspace";
import { listTemplates } from "./actions";
import { deleteTemplateFormAction } from "./form-actions";

type Template = {
  id: string;
  name: string;
  category: string;
  subject: string | null;
  body: string;
};

function snippet(body: string) {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine;
}

export default async function TemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;
  const { membership } = await requireWorkspaceAccess(orgSlug);
  const canWrite = hasPermission(membership, "record.write");

  const activeCategory = (TEMPLATE_CATEGORIES as readonly string[]).includes(
    sp.category ?? ""
  )
    ? sp.category
    : undefined;

  let templates: Template[];
  try {
    templates = (await listTemplates(
      orgSlug,
      activeCategory ? { category: activeCategory } : {}
    )) as Template[];
  } catch (error) {
    // No templates entitlement: send the member back to the workspace overview
    // rather than showing a broken screen. Anything else is a real error.
    if (error instanceof AuthorisationError) {
      redirect(`/app/${orgSlug}`);
    }
    throw error;
  }

  const hrefWith = (category: string | undefined) => {
    const query = new URLSearchParams();
    if (category) query.set("category", category);
    const qs = query.toString();
    return qs ? `/app/${orgSlug}/templates?${qs}` : `/app/${orgSlug}/templates`;
  };

  return (
    <ListScreen
      title="Templates"
      description="Reusable message content with placeholders filled from a record."
      action={
        canWrite ? (
          <Link
            href={`/app/${orgSlug}/templates/new`}
            className={buttonVariants({ size: "sm" })}
          >
            New template
          </Link>
        ) : null
      }
      filters={
        <nav
          aria-label="Filter by category"
          className="flex flex-wrap items-center gap-1.5"
        >
          <FilterPill
            href={hrefWith(undefined)}
            label="All"
            active={!activeCategory}
          />
          {TEMPLATE_CATEGORIES.map((value) => (
            <FilterPill
              key={value}
              href={hrefWith(value)}
              label={TEMPLATE_CATEGORY_LABELS[value]}
              active={activeCategory === value}
            />
          ))}
        </nav>
      }
    >
      {templates.length === 0 ? (
        <EmptyState>No templates match this filter.</EmptyState>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Body</TableHead>
                {canWrite ? <TableHead>Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {TEMPLATE_CATEGORY_LABELS[
                        template.category as keyof typeof TEMPLATE_CATEGORY_LABELS
                      ] ?? template.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {snippet(template.body)}
                  </TableCell>
                  {canWrite ? (
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/app/${orgSlug}/templates/${template.id}/edit`}
                          className={buttonVariants({
                            variant: "outline",
                            size: "sm",
                          })}
                        >
                          Edit
                        </Link>
                        <TemplateDeleteDialog
                          action={deleteTemplateFormAction.bind(
                            null,
                            orgSlug,
                            template.id
                          )}
                          templateName={template.name}
                        />
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
    </ListScreen>
  );
}
