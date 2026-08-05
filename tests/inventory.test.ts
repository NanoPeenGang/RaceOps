import { describe, expect, it } from "vitest";
import { PartCategory, StockMoveKind } from "@prisma/client";
import {
  PART_CATEGORY_LABELS,
  PART_CATEGORY_ORDER,
  STOCK_LEVEL_LABELS,
  STOCK_MOVE_LABELS,
  balanceAfter,
  checkMovement,
  deltaFor,
  formatMoney,
  groupByCategory,
  reorderList,
  stockLevel,
  stockValue,
} from "@/lib/inventory";

describe("stock vocabulary", () => {
  it("labels every category and every movement kind", () => {
    for (const category of Object.values(PartCategory)) {
      expect(PART_CATEGORY_LABELS[category], category).toBeTruthy();
    }
    for (const kind of Object.values(StockMoveKind)) {
      expect(STOCK_MOVE_LABELS[kind], kind).toBeTruthy();
    }
  });

  it("orders every category exactly once", () => {
    expect([...PART_CATEGORY_ORDER].sort()).toEqual(
      Object.values(PartCategory).sort(),
    );
  });

  it("leads with what stops the car", () => {
    // Not alphabetical and not enum order: a crew scanning this on a Saturday
    // wants the thing that ends the weekend if it is missing.
    expect(PART_CATEGORY_ORDER[0]).toBe(PartCategory.BRAKES);
    expect(PART_CATEGORY_ORDER.at(-1)).toBe(PartCategory.OTHER);
  });
});

describe("deltaFor", () => {
  it("makes a use negative and a receipt positive", () => {
    expect(deltaFor(StockMoveKind.CONSUMED, 4, 10)).toBe(-4);
    expect(deltaFor(StockMoveKind.RECEIVED, 4, 10)).toBe(4);
    expect(deltaFor(StockMoveKind.RETURNED, 2, 10)).toBe(2);
  });

  it("ignores a hand-typed minus sign rather than doubling back", () => {
    // Callers pass a positive amount and a kind. Somebody typing "-4" into a
    // "used" box means four used, not four received.
    expect(deltaFor(StockMoveKind.CONSUMED, -4, 10)).toBe(-4);
    expect(deltaFor(StockMoveKind.RECEIVED, -4, 10)).toBe(4);
  });

  it("treats a stock check as a target, not a change", () => {
    expect(deltaFor(StockMoveKind.ADJUSTED, 6, 10)).toBe(-4);
    expect(deltaFor(StockMoveKind.ADJUSTED, 14, 10)).toBe(4);
    expect(deltaFor(StockMoveKind.ADJUSTED, 10, 10)).toBe(0);
  });
});

describe("checkMovement", () => {
  it("refuses a movement that changes nothing", () => {
    expect(checkMovement({ quantity: 5 }, 0)?.reason).toBe("zero");
  });

  it("refuses to take stock below zero, and says by how much", () => {
    const rejection = checkMovement({ quantity: 3 }, -5);
    expect(rejection?.reason).toBe("negative");
    // The message has to be actionable — "invalid" sends somebody hunting.
    expect(rejection?.message).toContain("3");
    expect(rejection?.message).toContain("-2");
  });

  it("allows taking the last one", () => {
    expect(checkMovement({ quantity: 3 }, -3)).toBeNull();
    expect(balanceAfter({ quantity: 3 }, -3)).toBe(0);
  });
});

describe("stockLevel", () => {
  it("separates out of stock from running low", () => {
    expect(stockLevel({ quantity: 0, minQuantity: 2 })).toBe("out");
    expect(stockLevel({ quantity: 2, minQuantity: 2 })).toBe("low");
    expect(stockLevel({ quantity: 3, minQuantity: 2 })).toBe("ok");
  });

  it("does not call an item with no threshold fine", () => {
    // "untracked" is not "ok": nobody has decided what enough looks like, and
    // saying it is fine implies somebody did.
    expect(stockLevel({ quantity: 9, minQuantity: null })).toBe("untracked");
    expect(STOCK_LEVEL_LABELS.untracked).toContain("reorder");
  });

  it("reports zero as out even with no threshold", () => {
    expect(stockLevel({ quantity: 0 })).toBe("out");
  });
});

describe("reorderList", () => {
  const pads = { id: "pads", quantity: 0, minQuantity: 4 };
  const belts = { id: "belts", quantity: 1, minQuantity: 6 };
  const oil = { id: "oil", quantity: 2, minQuantity: 2 };
  const bolts = { id: "bolts", quantity: 40, minQuantity: 10 };
  const rags = { id: "rags", quantity: 5, minQuantity: null };

  it("lists only what needs buying", () => {
    const lines = reorderList([pads, belts, oil, bolts, rags]);
    expect(lines.map((line) => line.item.id)).toEqual(["pads", "belts", "oil"]);
  });

  it("puts out-of-stock ahead of merely low, biggest gap first", () => {
    const lines = reorderList([oil, belts, pads]);
    expect(lines[0]!.item.id).toBe("pads");
    expect(lines[1]!.item.id).toBe("belts");
  });

  it("says how many to buy", () => {
    const lines = reorderList([belts]);
    expect(lines[0]!.shortfall).toBe(5);
  });

  it("asks for at least one when an untracked item runs out", () => {
    // No threshold means nobody said how many it should hold, so one is the
    // honest floor rather than zero — which would be a shopping list entry
    // telling you to buy nothing.
    const lines = reorderList([{ id: "x", quantity: 0, minQuantity: null }]);
    expect(lines[0]!.shortfall).toBe(1);
  });
});

describe("stockValue", () => {
  it("keeps currencies apart rather than adding them up", () => {
    const value = stockValue([
      { quantity: 2, unitCostMinor: 5000, currency: "USD" },
      { quantity: 1, unitCostMinor: 3000, currency: "EUR" },
      { quantity: 4, unitCostMinor: 1000, currency: "USD" },
    ]);
    expect(value.totals).toEqual([
      { currency: "USD", minor: 14_000 },
      { currency: "EUR", minor: 3000 },
    ]);
  });

  it("counts what it could not price instead of silently shrinking", () => {
    const value = stockValue([
      { quantity: 2, unitCostMinor: 5000 },
      { quantity: 9, unitCostMinor: null },
    ]);
    expect(value.totals).toEqual([{ currency: "USD", minor: 10_000 }]);
    expect(value.unpriced).toBe(1);
  });
});

describe("formatMoney", () => {
  it("leaves an unknown price unknown rather than printing zero", () => {
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("reads minor units", () => {
    expect(formatMoney(12_345)).toBe("$123.45");
  });
});

describe("groupByCategory", () => {
  it("drops empty categories and follows display order", () => {
    const groups = groupByCategory([
      { category: PartCategory.TOOLS },
      { category: PartCategory.BRAKES },
    ]);
    expect(groups.map((group) => group.category)).toEqual([
      PartCategory.BRAKES,
      PartCategory.TOOLS,
    ]);
  });
});
