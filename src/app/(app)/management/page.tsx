import { redirect } from "next/navigation";

export const metadata = { title: "Set-up" };

/**
 * Round 5 (ADR-129): the Management hub repeated every menu as a grid of cards. Its set-up part is now the Set-up page
 * (avatar menu); daily screens are in the areas (Sell, Make, Buy & stock, Money). The old address keeps working.
 */
export default function ManagementPage() {
  redirect("/setup");
}
