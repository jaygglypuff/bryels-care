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
      <PageHeader title="Help & guides" subtitle="Short guides for the warehouse tasks. On each task screen the “?” opens the same guide without leaving the task." />
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
