import { PartCategory, StockMoveKind } from "@prisma/client";

/**
 * Parts stock for a race team.
 *
 * The model here is a ledger, not a counter. Every change is a movement with a
 * signed delta and the balance it produced, and the item's `quantity` is a
 * cache of the latest balance. That costs a row per change and buys the only
 * question a trailer inventory is ever really asked: not "how many pads do we
 * have" but "who took the last set, and was it at Sebring or at the shop".
 *
 * Everything here is pure so the console, the router and the tests apply the
 * same arithmetic — a stock rule enforced only at one call site is not a rule.
 */

export const PART_CATEGORY_LABELS: Record<PartCategory, string> = {
  ENGINE: "Engine",
  DRIVETRAIN: "Drivetrain",
  SUSPENSION: "Suspension",
  BRAKES: "Brakes",
  TIRES_WHEELS: "Tires & wheels",
  BODYWORK: "Bodywork",
  ELECTRICAL: "Electrical",
  FLUIDS: "Fluids",
  SAFETY: "Safety",
  CONSUMABLES: "Consumables",
  TOOLS: "Tools",
  OTHER: "Other",
};

/**
 * Display order: what stops the car first.
 *
 * Not alphabetical, and not the enum's order either. A crew scanning a stock
 * list on a Saturday is looking for the thing that ends their weekend if it is
 * missing, and that is brakes and safety long before it is tools.
 */
export const PART_CATEGORY_ORDER: readonly PartCategory[] = [
  PartCategory.BRAKES,
  PartCategory.TIRES_WHEELS,
  PartCategory.ENGINE,
  PartCategory.DRIVETRAIN,
  PartCategory.SUSPENSION,
  PartCategory.SAFETY,
  PartCategory.ELECTRICAL,
  PartCategory.FLUIDS,
  PartCategory.BODYWORK,
  PartCategory.CONSUMABLES,
  PartCategory.TOOLS,
  PartCategory.OTHER,
];

export const STOCK_MOVE_LABELS: Record<StockMoveKind, string> = {
  RECEIVED: "Received",
  CONSUMED: "Used",
  ADJUSTED: "Stock check",
  RETURNED: "Returned",
};

/** Which way a kind of movement pushes the balance. */
export const STOCK_MOVE_SIGN: Record<StockMoveKind, 1 | -1 | 0> = {
  RECEIVED: 1,
  CONSUMED: -1,
  RETURNED: 1,
  // A stock check can go either way — that is the whole point of one.
  ADJUSTED: 0,
};

export interface StockItem {
  quantity: number;
  minQuantity?: number | null;
}

/**
 * The signed delta a movement should carry.
 *
 * Callers pass a positive amount and a kind — "used 4" rather than "-4" —
 * because a minus sign typed by hand at a workbench is a mis-key waiting to
 * happen. `ADJUSTED` is the exception: a stock check genuinely means "the
 * shelf says this now", so it takes the target and works out the difference.
 */
export function deltaFor(
  kind: StockMoveKind,
  amount: number,
  current: number,
): number {
  if (kind === StockMoveKind.ADJUSTED) return amount - current;
  return STOCK_MOVE_SIGN[kind] * Math.abs(amount);
}

export type StockRejection =
  | { reason: "zero"; message: string }
  | { reason: "negative"; message: string };

/**
 * Whether a movement may be applied, with a message somebody can act on.
 *
 * Stock never goes below zero. A team that finds it "should" have gone
 * negative has a missing receipt, not a negative shelf, and telling them the
 * numbers at the point of entry is what gets the receipt found.
 */
export function checkMovement(
  item: StockItem,
  delta: number,
): StockRejection | null {
  if (delta === 0) {
    return {
      reason: "zero",
      message: "That leaves the count where it is — nothing to record.",
    };
  }
  const balance = item.quantity + delta;
  if (balance < 0) {
    return {
      reason: "negative",
      message: `Only ${item.quantity} in stock; that would take it to ${balance}.`,
    };
  }
  return null;
}

/** The balance a movement produces. Assumes `checkMovement` already passed. */
export function balanceAfter(item: StockItem, delta: number): number {
  return item.quantity + delta;
}

export type StockLevel = "out" | "low" | "ok" | "untracked";

/**
 * How worried to be about a line.
 *
 * "untracked" is not "ok": an item with no reorder threshold has never been
 * given one, and saying it is fine implies somebody decided it was. Out of
 * stock is separated from low because they are different jobs — one is a
 * shopping list, the other is a phone call.
 */
export function stockLevel(item: StockItem): StockLevel {
  if (item.quantity <= 0) return "out";
  if (item.minQuantity == null) return "untracked";
  return item.quantity <= item.minQuantity ? "low" : "ok";
}

export const STOCK_LEVEL_LABELS: Record<StockLevel, string> = {
  out: "Out of stock",
  low: "Running low",
  ok: "In stock",
  untracked: "No reorder level set",
};

export interface ReorderLine<T extends StockItem> {
  item: T;
  level: StockLevel;
  /** How many to buy to get back above the threshold. */
  shortfall: number;
}

/**
 * What to buy, worst first.
 *
 * Items with no threshold are left out entirely rather than listed as fine:
 * a shopping list that includes everything is not a shopping list.
 */
export function reorderList<T extends StockItem>(
  items: readonly T[],
): ReorderLine<T>[] {
  const lines: ReorderLine<T>[] = [];
  for (const item of items) {
    const level = stockLevel(item);
    if (level === "ok" || level === "untracked") continue;
    // An item that is out with no threshold still needs buying; one unit is
    // the honest minimum, since nobody has said how many it should hold.
    const target = item.minQuantity ?? 1;
    lines.push({ item, level, shortfall: Math.max(target - item.quantity, 1) });
  }
  return lines.sort((a, b) => {
    if (a.level !== b.level) return a.level === "out" ? -1 : 1;
    return b.shortfall - a.shortfall;
  });
}

/** Money in minor units to a readable figure. Null stays null, not "$0.00". */
export function formatMoney(
  minor: number | null | undefined,
  currency = "USD",
): string | null {
  if (minor == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(minor / 100);
}

export interface ValuedItem extends StockItem {
  unitCostMinor?: number | null;
  currency?: string | null;
}

/**
 * What the shelf is worth, per currency.
 *
 * Split by currency rather than summed, because a team buying brakes in euros
 * and tires in dollars has two numbers and adding them is worse than useless.
 * Items with no unit cost are skipped and counted, so a total is never quietly
 * short without saying so.
 */
export function stockValue(items: readonly ValuedItem[]): {
  totals: { currency: string; minor: number }[];
  unpriced: number;
} {
  const totals = new Map<string, number>();
  let unpriced = 0;
  for (const item of items) {
    if (item.unitCostMinor == null) {
      unpriced += 1;
      continue;
    }
    const currency = item.currency ?? "USD";
    totals.set(
      currency,
      (totals.get(currency) ?? 0) + item.unitCostMinor * item.quantity,
    );
  }
  return {
    totals: [...totals.entries()]
      .map(([currency, minor]) => ({ currency, minor }))
      .sort((a, b) => b.minor - a.minor),
    unpriced,
  };
}

export interface CategorisedItem {
  category: PartCategory;
}

/** Groups a stock list for display, in `PART_CATEGORY_ORDER`, dropping empties. */
export function groupByCategory<T extends CategorisedItem>(
  items: readonly T[],
): { category: PartCategory; items: T[] }[] {
  return PART_CATEGORY_ORDER.map((category) => ({
    category,
    items: items.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);
}
