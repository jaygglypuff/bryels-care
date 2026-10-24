"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Field, Input, LinkButton, Select } from "@/ui/core";
import { FormMessage, SubmitButton } from "@/ui/form";
import { type InviteState, invite } from "./actions";

type Opt = { id: string; name: string; allowsOrganizationWide: boolean; blockedReason: string | null };

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
            <p className="font-semibold">Email is not set up, so nothing was sent.</p>
            <p className="mt-1">Give this one-time link to the person directly. It is shown only now; if it is lost, resend the invitation.</p>
            <p className="mt-2 select-all break-all rounded bg-surface px-2 py-1 font-mono text-[12px] text-fg">{state.manualLink}</p>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/admin/users/${state.userId}`} variant="cta">
            Open the new user
          </LinkButton>
          <LinkButton href="/admin/users/invite" variant="secondary">
            Invite another
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
      <Field label="Role" htmlFor="roleId" error={state?.fieldErrors?.roleId} hint="Roles with restricted permissions you do not hold are granted by the owner.">
        <Select id="roleId" name="roleId" required value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="" disabled>
            Choose a role…
          </option>
          {roles.map((r) => (
            <option key={r.id} value={r.id} disabled={!!r.blockedReason && r.blockedReason !== "Site only"}>
              {r.name}
              {r.blockedReason && r.blockedReason !== "Site only" ? " (owner only)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Site" htmlFor="siteId" error={state?.fieldErrors?.siteId}>
        <Select id="siteId" name="siteId" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} · {s.name}
            </option>
          ))}
          {orgWide && (
            <option value="org" disabled={!!role && !role.allowsOrganizationWide}>
              All sites (owner, system admin, auditor only)
            </option>
          )}
        </Select>
      </Field>
      {siteId !== "org" && siteWh.length > 1 && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-medium text-fg">Limit stock posting to warehouses (optional)</legend>
          {siteWh.map((w) => (
            <label key={w.id} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" name="warehouseIds" value={w.id} className="size-4" /> {w.code} · {w.name}
            </label>
          ))}
          <p className="text-[12px] text-muted">None ticked = the whole site.</p>
        </fieldset>
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
