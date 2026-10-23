"use client";
import { PageError } from "../_kit/states";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError what="Boxes" reset={reset} />;
}
