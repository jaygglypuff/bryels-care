"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Field, Input, LinkButton, Select } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { MoreDetails } from "@/ui/guide";
import { plainRole } from "@/ui/role-names";
import { type InviteState, invite } from "./actions";

type Opt = { id: string; code: string; name: string; allowsOrganizationWide: boolean; blockedReason: string | null };

export function InviteForm({ roles, sites, warehouses, orgWide, defaultSiteId }: { roles: Opt[]; sites: { id: string; code: string; name: string }[]; warehouses: { id: string; siteId: string; code: string; name: string }[]; orgWide: boolean; defaultSiteId: string }) {
  const [state, action] = useActionState<InviteState, FormData>(invite, null);
  const [siteId, setSiteId] = useState(defaultSiteId);
  const [roleId, setRoleId] = useState("");
  const role = roles.find((r) => r.id === roleId);
  if (state?.ok)
    return (
      <div className="flex flex-col gap-3" role="status">
        <FormMessage state={state} />
        {state.manualLink && (
          <div className="rounded-[12px] border border-[var(--warn-bd)] bg-[var(--warn-bg)] p-3 text-[13px] text-[var(--warn-fg)]">
            <p className="font-semibold">Email is not set up, so no email was sent.</p>
            <p className="mt-1">Send this link to the person yourself (chat or SMS). It is shown only now; if it is lost, open the person and press “Resend invitation”.</p>
            <p className="mt-2 select-all break-all rounded bg-surface px-2 py-1 font-mono text-[12px] text-fg">{state.manualLink}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/admin/users/${state.userId}`} variant="cta">
            Open this person
          </LinkButton>
          <LinkButton href="/admin/users/invite" variant="secondary">
            Add another person
          </LinkButton>
        </div>
      </div>
    );
  const siteWh = warehouses.filter((w) => w.siteId === siteId);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Work email" htmlFor="email" error={state?.fieldErrors?.email}>
        <Input id="email" name="email" type="email" required maxLength={200} autoComplete="off" />
      </Field>
      <Field label="Full name" htmlFor="displayName" error={state?.fieldErrors?.displayName}>
        <Input id="displayName" name="displayName" required minLength={2} maxLength={120} autoComplete="off" />
      </Field>
      <Field label="Their job (role)" htmlFor="roleId" error={state?.fieldErrors?.roleId} hint="Jobs marked “owner only” need the owner's OK; ask the owner to add them.">
        <Select id="roleId" name="roleId" required value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="" disabled>
            Choose a job…
          </option>
          {roles.map((r) => (
            <option key={r.id} value={r.id} disabled={!!r.blockedReason && r.blockedReason !== "Site only"}>
              {plainRole(r.code, r.name)}
              {r.blockedReason && r.blockedReason !== "Site only" ? " (owner only)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Site" htmlFor="siteId" error={state?.fieldErrors?.siteId}>
        <Select id="siteId" name="siteId" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          {orgWide && (
            <option value="org" disabled={!!role && !role.allowsOrganizationWide}>
              All sites (only owner, IT person, auditor)
            </option>
          )}
        </Select>
      </Field>
      {siteId !== "org" && siteWh.length > 1 && (
        <MoreDetails>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[14px] font-medium text-fg">Only let them move stock in these warehouses</legend>
            {siteWh.map((w) => (
              <label key={w.id} className="flex min-h-[44px] items-center gap-2 text-[14px]">
                <input type="checkbox" name="warehouseIds" value={w.id} className="size-5" /> {w.name}
              </label>
            ))}
            <p className="text-[13px] text-muted">None ticked = the whole site (most people).</p>
          </fieldset>
        </MoreDetails>
      )}
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="cta" pendingText="Inviting…">
          Send invitation
        </SubmitButton>
        <Link href="/admin/users" className="self-center text-[13px] font-medium text-primary-text hover:underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
