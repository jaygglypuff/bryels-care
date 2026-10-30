"use client";
import { useEffect, useState } from "react";

type WhoCanDo = { roles: string[]; people: { name: string; email: string; role: string }[] };

/**
 * Under a refused step: the roles and colleagues who can do it (ADR-073; GET /api/who-can-do).
 * `hideEmails`: floor screens (operators on a shared tablet) show names and roles only (UX review).
 * `lead`: replaces "Who can do this:" (e.g. "These people do this step:").
 */
export function WhoCanHelp({ permission, siteId, hideEmails = false, lead = "Who can do this: " }: { permission: string; siteId: string | null; hideEmails?: boolean; lead?: string }) {
  const [data, setData] = useState<WhoCanDo | null>(null);
  useEffect(() => {
    let live = true;
    const q = new URLSearchParams({ permission, ...(siteId ? { siteId } : {}) });
    fetch(`/api/who-can-do?${q}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<WhoCanDo>) : null))
      .then((d) => live && setData(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [permission, siteId]);
  if (!data || (data.roles.length === 0 && data.people.length === 0)) return null;
  return (
    <div className="mt-1.5 text-[12.5px]">
      <span className="font-medium">{lead}</span>
      {data.roles.length > 0 && <span>{data.roles.join(", ")}</span>}
      {data.people.length > 0 ? (
        <ul className="mt-1 list-disc pl-5">
          {data.people.map((p) => (
            <li key={p.email}>
              {p.name} <span className="opacity-75">({hideEmails ? p.role : `${p.role}, ${p.email}`})</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="block opacity-80">Nobody else holds this yet. An administrator can give the role under Management → People & access → Users.</span>
      )}
    </div>
  );
}
