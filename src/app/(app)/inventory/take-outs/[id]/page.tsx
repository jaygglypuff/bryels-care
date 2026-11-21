import Link from "next/link";
import { notFound } from "next/navigation";
import { requireContext } from "@/lib/auth/context";
import { DomainError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/qty";
import { getTakeout } from "@/modules/inventory";
import { Card, Field, Input } from "@/ui/core";
import { PageIntro } from "@/ui/guide";
import { Help } from "@/ui/help/help";
import { ActionForm } from "@/ui/form";
import { Callout, CellCode, Panel } from "@/ui/kit";
import { RecordHeader } from "@/ui/record";
import { Banner, Chip } from "@/ui/status";
import { Forbidden } from "../../../forbidden";
import {
  cancelTakeoutAction,
  decideTakeoutAction,
  undoTakeoutFormAction,
} from "../../take-out/actions";

export const metadata = { title: "Take-out" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "ok" | "warn" | "neu" | "bad"> = {
  posted: "ok",
  awaiting_approval: "warn",
  reversed: "neu",
  rejected: "bad",
  cancelled: "neu",
};

/** One take-out (ADR-138): what, from where, why, who; Undo (reversal), OK / Say no, Cancel when allowed. */
export default async function TakeoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireContext();
  if (
    !ctx.can("inventory.takeout.view") &&
    !ctx.can("inventory.takeout.create")
  )
    return <Forbidden what="take-outs" permission="inventory.takeout.view" />;
  const { id } = await params;
  let t;
  try {
    t = await getTakeout(ctx, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "not_found") notFound();
    throw e;
  }
  const facts: [string, string | null][] = [
    [
      "Taken out by",
      t.createdByName
        ? `${t.createdByName} · ${fmtDateTime(t.createdAt)}`
        : null,
    ],
    ["Why", t.sentence],
    ["Online shop", t.channelLabel],
    ["Shop order number", t.platformOrderRef],
    ["Sample for", t.customerName ?? t.recipientName],
    ["Note", t.purpose === "other" ? null : t.note],
    ["Needed an OK because", t.approvalReason],
    [
      "OK given by",
      t.approvedByName && t.approvedAt
        ? `${t.approvedByName} · ${fmtDateTime(t.approvedAt)}`
        : null,
    ],
    [
      "Said no",
      t.rejectedByName && t.rejectedAt
        ? `${t.rejectedByName} · ${fmtDateTime(t.rejectedAt)}: ${t.rejectReason}`
        : null,
    ],
    [
      "Cancelled",
      t.cancelledByName && t.cancelledAt
        ? `${t.cancelledByName} · ${fmtDateTime(t.cancelledAt)}: ${t.cancelReason}`
        : null,
    ],
    [
      "Undone",
      t.reversedByName && t.reversedAt
        ? `${t.reversedByName} · ${fmtDateTime(t.reversedAt)}: ${t.reverseReason}`
        : null,
    ],
  ];
  return (
    <div className="space-y-4">
      <RecordHeader
        back={{
          href: ctx.can("inventory.takeout.view")
            ? "/inventory/take-outs"
            : "/inventory/take-out",
          label: ctx.can("inventory.takeout.view")
            ? "Taken out"
            : "Take a few out",
        }}
        typeLabel="Take-out"
        reference={t.takeoutNumber}
        title={`${t.totalPieces} ${Number(t.totalPieces) === 1 ? "piece" : "pieces"} · ${t.sentence}`}
        chip={<Chip tone={TONE[t.status] ?? "neu"}>{t.statusWord}</Chip>}
        meta={[
          t.createdByName ? `${t.createdByName}` : null,
          fmtDateTime(t.createdAt),
        ]}
        actions={<Help screen="inventory.takeout" />}
      />
      <PageIntro>
        This screen is for one take-out: which pieces left, from where, why and
        who took them. Undo puts them back; nothing is erased.
      </PageIntro>
      {t.status === "awaiting_approval" && (
        <Callout>
          {t.can.decide
            ? "Check the pieces and give the OK, or say no with a reason."
            : "Waiting for the site manager or the owner to give the OK. Nothing has left the stock yet."}
        </Callout>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Panel title="Pieces" count={t.lines.length} flush>
          <ul className="divide-y divide-line">
            {t.lines.map((l) => (
              <li
                key={l.lineNo}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium">
                    {l.pieces} × {l.productName}
                  </span>
                  <span className="block text-[13px] text-fg-2">
                    From{" "}
                    {l.boxNumber && l.containerId ? (
                      <Link
                        className="text-primary-text hover:underline"
                        href={`/inventory/containers/${l.containerId}`}
                      >
                        box {l.boxNumber}
                      </Link>
                    ) : (
                      "loose pieces"
                    )}{" "}
                    on {l.placeCode}
                    {l.openedBox ? " · opened the box" : ""} ·{" "}
                    <Link
                      className="text-primary-text hover:underline"
                      href={`/inventory/${l.lotId}`}
                    >
                      lot <CellCode>{l.lotNumber}</CellCode>
                    </Link>
                  </span>
                </span>
                {l.reversalId ? (
                  <Chip tone="neu">Put back</Chip>
                ) : l.movementId ? (
                  <Chip tone="ok">Out of stock</Chip>
                ) : (
                  <Chip tone="warn">Not out yet</Chip>
                )}
              </li>
            ))}
          </ul>
        </Panel>
        <div className="space-y-4">
          <Card>
            <dl className="grid gap-2 text-[14px]">
              {facts
                .filter(([, v]) => !!v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                      {k}
                    </dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          </Card>
          {t.can.decide && (
            <Card data-testid="takeout-decide">
              <h2 className="mb-2 text-[15px] font-semibold">Give the OK?</h2>
              <ActionForm
                action={decideTakeoutAction}
                hidden={{ takeoutId: t.id, decision: "approve" }}
                submit="OK, take them out"
                variant="cta"
              >
                <Field label="Note (optional)" htmlFor="ok-note">
                  <Input id="ok-note" name="note" maxLength={300} />
                </Field>
              </ActionForm>
              <div className="mt-4 border-t border-line pt-3">
                <ActionForm
                  action={decideTakeoutAction}
                  hidden={{ takeoutId: t.id, decision: "reject" }}
                  submit="Say no"
                  variant="secondary"
                >
                  <Field label="Why not?" htmlFor="no-reason">
                    <Input
                      id="no-reason"
                      name="reason"
                      maxLength={300}
                      required
                      minLength={3}
                    />
                  </Field>
                </ActionForm>
              </div>
            </Card>
          )}
          {t.can.cancel && !t.can.decide && (
            <Card>
              <ActionForm
                action={cancelTakeoutAction}
                hidden={{ takeoutId: t.id }}
                submit="Cancel this take-out"
                variant="secondary"
              >
                <Field label="Why cancel?" htmlFor="cancel-reason">
                  <Input
                    id="cancel-reason"
                    name="reason"
                    maxLength={300}
                    required
                    minLength={3}
                  />
                </Field>
              </ActionForm>
            </Card>
          )}
          {t.status === "posted" &&
            (t.can.undo ? (
              <Card data-testid="takeout-undo">
                <h2 className="mb-1 text-[15px] font-semibold">Undo</h2>
                <p className="mb-2 text-[13px] text-fg-2">
                  The pieces go back into stock (into their box when it is still
                  there). The take-out stays in the list as Undone.
                </p>
                <ActionForm
                  action={undoTakeoutFormAction}
                  hidden={{ takeoutId: t.id }}
                  submit="Undo this take-out"
                  variant="danger"
                  confirm="Put these pieces back into stock?"
                >
                  <Field label="Why undo?" htmlFor="undo-reason">
                    <Input
                      id="undo-reason"
                      name="reason"
                      maxLength={300}
                      required
                      minLength={3}
                      defaultValue=""
                    />
                  </Field>
                </ActionForm>
              </Card>
            ) : t.can.undoWhy ? (
              <Banner tone="info" title="Undo">
                {t.can.undoWhy}
              </Banner>
            ) : null)}
        </div>
      </div>
    </div>
  );
}
