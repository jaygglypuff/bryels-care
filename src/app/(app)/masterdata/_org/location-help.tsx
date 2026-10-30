import Link from "next/link";

/** Plain-language help (ADR-075): sites far apart are separate Sites, each with its own warehouses and locations. */
export function LocationHelp({ canSeeSites }: { canSeeSites: boolean }) {
  return (
    <details className="rounded-[14px] border border-line bg-surface p-4 text-[14px]">
      <summary className="min-h-[44px] cursor-pointer font-medium leading-[44px]">How do sites, warehouses and locations fit together?</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-2">
        <li><b>Site</b> = one address (a factory or a store room in another town). If your company works from places far apart, add one Site per address{canSeeSites ? <> under <Link className="text-primary-text underline" href="/masterdata/sites">Master data → Sites</Link></> : " (Master data → Sites)"}.</li>
        <li><b>Warehouse</b> = a building or store room at that site. Each site has its own warehouses.</li>
        <li><b>Location</b> = a place inside a warehouse where stock sits: a room, rack, shelf or bin. Each warehouse has its own locations.</li>
        <li>To group places, pick a bigger location under &quot;Section or zone&quot; (for example, rack A-03 inside zone A).</li>
        <li>To change a location, tap <b>Edit</b> next to it. A location that has held stock keeps its code; you can still rename it, block it or switch it off.</li>
      </ul>
    </details>
  );
}

