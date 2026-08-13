import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The invoice actions have to be visible without hunting for them.
 *
 * The bug this exists for: **Mark paid**, **Delete** and **Void** were all
 * rendered inside the expanded detail, and the only way to expand it was a
 * small grey link reading "3 line(s)". That reads as "show me the line items",
 * not "here is how you mark this paid" — so nobody found them, and an action
 * nobody can find is an action that does not exist.
 *
 * This is a structural check rather than a rendering one, and deliberately so:
 * proving a control is *reachable* would mean driving a browser, while the
 * mistake that actually happened is visible in where the components are used.
 * It asserts the always-visible bar owns the actions, and that the collapsed
 * detail does not quietly take them back.
 */

const PANEL = join(
  process.cwd(),
  "src/app/(dashboard)/teams/[slug]/manage/invoices-panel.tsx",
);

function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} is not in the panel any more`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

describe("invoice actions", () => {
  const source = readFileSync(PANEL, "utf8");

  it("renders the action bar on the row, outside the disclosure", () => {
    const row = bodyOf(source, "InvoiceRow");
    const barIndex = row.indexOf("<InvoiceActions");
    expect(barIndex, "the row no longer renders the action bar").toBeGreaterThan(
      -1,
    );

    /*
     * The assertion that matters, and the one an earlier version of this test
     * got wrong: "contains <InvoiceActions" stays true when the bar is wrapped
     * back up in `{open && …}`, which is precisely the bug. So look at what
     * precedes it — an unconditional render has no `&&` between the enclosing
     * brace and the tag.
     */
    const preceding = row.slice(Math.max(0, barIndex - 200), barIndex);
    const lastBrace = preceding.lastIndexOf("{");
    const guard = lastBrace >= 0 ? preceding.slice(lastBrace) : preceding;
    expect(guard, "the action bar is behind a condition").not.toContain("&&");

    // The detail, by contrast, is supposed to be behind the disclosure.
    expect(row).toMatch(/\{open && <InvoiceDetail/);
    expect(barIndex).toBeLessThan(row.indexOf("{open && <InvoiceDetail"));
  });

  it("puts settling, issuing and removing an invoice in that bar", () => {
    const actions = bodyOf(source, "InvoiceActions");
    for (const control of [
      "MarkPaid",
      "IssueControls",
      "DeleteInvoice",
      "VoidInvoice",
    ]) {
      expect(actions, `${control} is not on the visible bar`).toContain(
        `<${control}`,
      );
    }
  });

  it("does not leave them behind the disclosure as well", () => {
    /*
     * Two copies of a destructive control is worse than one badly placed: the
     * second is the one somebody clicks by accident, and neither is obviously
     * the real one.
     */
    const detail = bodyOf(source, "InvoiceDetail");
    for (const control of ["MarkPaid", "DeleteInvoice", "VoidInvoice"]) {
      expect(detail, `${control} is duplicated inside the detail`).not.toContain(
        `<${control}`,
      );
    }
  });

  it("keeps the itemised payment form in the detail, where it belongs", () => {
    // The one-tap settle is the common case and earns a place on the row; a
    // four-field form for a deposit does not.
    expect(bodyOf(source, "InvoiceDetail")).toContain("<RecordPayment");
    expect(bodyOf(source, "InvoiceActions")).not.toContain("<RecordPayment");
  });

  it("labels the disclosure as details rather than as a line count", () => {
    // "3 line(s)" is what made the actions invisible: it describes the
    // contents rather than saying there is anything to open.
    expect(bodyOf(source, "InvoiceActions")).toContain("Details");
  });
});
