import { requireContext } from "@/lib/auth/context";
import { Card, CardTitle, EmptyState, PageHeader } from "@/ui/core";
import { GuideView } from "@/ui/help/guide-view";
import { listGuides } from "@/ui/help/guides";

export const metadata = { title: "Help & guides" };

/** All quick guides (US-2-27; the user-menu "Help and quick guides" entry). Reading needs no permission. */
export default async function HelpPage() {
  await requireContext();
  const guides = listGuides();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Help & guides" subtitle="Short guides for the main tasks. On each task screen the “?” opens the same guide without leaving the task." />
      {guides.length > 1 && (
        <nav aria-label="Guides" className="rounded-[14px] border border-line bg-surface p-3">
          <ul className="grid gap-1 text-[13px] sm:grid-cols-2">
            {guides.map((g) => (
              <li key={g.key}>
                <a href={`#${g.key}`} className="text-primary-text underline-offset-2 hover:underline">
                  {g.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {guides.length === 0 ? (
        <EmptyState title="No guides yet">Guides are added with each release.</EmptyState>
      ) : (
        guides.map((g) => (
          <Card key={g.key} id={g.key}>
            <CardTitle>{g.title}</CardTitle>
            <p className="mb-2 text-[12px] text-muted">
              Version {g.version}
              {g.updatedAt ? ` · updated ${g.updatedAt}` : ""}
              {g.sop ? ` · ${g.sop}` : ""}
            </p>
            <GuideView guide={g} />
          </Card>
        ))
      )}
    </div>
  );
}
