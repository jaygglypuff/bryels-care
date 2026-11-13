/**
 * Proof of delivery (round 5 A B11, ADR-133 item 2): what the Save button sends. Pure, so it is unit-tested.
 *
 * Why Save "sometimes did nothing" after a first failed try: the drawn signature reached the form only through a
 * hidden file input filled on pointer-up (`canvas.toBlob`, asynchronous), and React resets a form's uncontrolled
 * fields after every form action, failed ones included. After a refusal (for example a time before dispatch) the file
 * input was empty while the canvas still showed the signature and "Signed ✓", so every retry was refused again with
 * the same message ("Draw the signature first.") and looked like nothing happened. A quick tap on Save right after the
 * last stroke could also beat `toBlob`. Now the form never uses a form action: the image is taken from the canvas (or
 * the chosen photo kept in state) at the moment Save is tapped and added here, and the fields keep what was typed.
 */
export type ProofKind = "drawn" | "photo" | "name_only";

/** Puts the proof image into the form data (or removes a stale one). Returns a refusal in plain words, or null. */
export function proofFormData(fd: FormData, kind: ProofKind, image: File | null): string | null {
  fd.delete("file");
  fd.set("kind", kind);
  if (kind === "name_only") return null;
  if (!image || image.size === 0) return kind === "drawn" ? "Ask the person receiving to sign in the box first." : "Take or choose the photo of the signed copy first.";
  fd.set("file", image, image.name || (kind === "drawn" ? "signature.png" : "photo.jpg"));
  return null;
}
