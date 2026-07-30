"use client";

import { Button } from "@/components/ui/button";

/**
 * Prints the current sheet.
 *
 * A client island purely so the printable documents themselves stay server
 * components — they are documents, and rendering them on the server is what
 * lets them be linked, crawled and loaded on a phone at the circuit.
 * The print stylesheet hides this button, so it never appears on paper.
 */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      className="print:hidden"
      onClick={() => window.print()}
    >
      {label}
    </Button>
  );
}
