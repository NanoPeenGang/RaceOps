"use client";

import Link from "next/link";
import { useState } from "react";
import { PartCategory, StockMoveKind } from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";
import { api } from "@/lib/trpc/client";
import {
  expiryState,
  EXPIRY_STATE_LABELS,
  UNIT_STATUS_LABELS,
} from "@/lib/part-labels";
import {
  PART_CATEGORY_LABELS,
  PART_CATEGORY_ORDER,
  STOCK_LEVEL_LABELS,
  STOCK_MOVE_LABELS,
  formatMoney,
  groupByCategory,
  reorderList,
  stockLevel,
  stockValue,
} from "@/lib/inventory";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Parts stock.
 *
 * Two things on one screen because a crew uses them together: what is on the
 * shelf, and what needs buying before the next event. The reorder list leads,
 * since it is the part somebody has to act on.
 */
export function InventoryPanel({
  teamId,
  teamSlug,
}: {
  teamId: string;
  teamSlug: string;
}) {
  const utils = api.useUtils();
  const stock = api.garage.inventory.useQuery(
    { teamId },
    { meta: { silenceError: true } },
  );
  const [adding, setAdding] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);

  const refresh = () => utils.garage.inventory.invalidate({ teamId });

  if (stock.isLoading) {
    return <p className="text-sm text-brand-black/60">Loading stock…</p>;
  }
  if (stock.error) {
    return <p className="text-sm text-brand-red">{stock.error.message}</p>;
  }

  const items = stock.data?.items ?? [];
  const canWrite = stock.data?.canWrite ?? false;
  const groups = groupByCategory(items);
  const reorder = reorderList(items);
  const value = stockValue(items);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Parts &amp; stock</h2>
          <p className="text-sm text-brand-black/60">
            What is on the shelf, and who took the last one.
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {/* First, and as a filled button: scanning is the fast path, and
                the keypad below is what you fall back to when the phone is
                flat. Burying it behind the console's tabs would make the
                labels ornamental. */}
            <Link href={`/teams/${teamSlug}/scan`}>
              <Button size="sm" variant="primary">
                Scan parts
              </Button>
            </Link>
            <Link href={`/teams/${teamSlug}/labels`}>
              <Button size="sm" variant="outline">
                Print labels
              </Button>
            </Link>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAdding((open) => !open)}
            >
              {adding ? "Cancel" : "Add a part"}
            </Button>
          </div>
        )}
      </div>

      {adding && (
        <ItemForm
          teamId={teamId}
          onSaved={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}

      {reorder.length > 0 && (
        <Card className="border-brand-red/30 bg-brand-red/[0.03]">
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-semibold">
              {reorder.length} to order before the next event
            </p>
            <ul className="space-y-1 text-sm text-brand-black/75">
              {reorder.map((line) => (
                <li key={line.item.id}>
                  <span className="font-medium">{line.item.name}</span> —{" "}
                  {line.level === "out"
                    ? "out of stock"
                    : `${line.item.quantity} left`}
                  , order {line.shortfall} {line.item.unit}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {items.length === 0 && !adding && (
        <p className="rounded-lg border border-dashed border-brand-black/20 p-6 text-center text-sm text-brand-black/55">
          Nothing on the shelf yet. Brake pads and a set of belts are what most
          teams put in first — they are the ones you discover missing on a
          Saturday.
        </p>
      )}

      {groups.map((group) => (
        <div key={group.category} className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
            {PART_CATEGORY_LABELS[group.category]}
          </h3>
          {group.items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              canWrite={canWrite}
              open={openItem === item.id}
              onToggle={() =>
                setOpenItem((current) => (current === item.id ? null : item.id))
              }
              onChanged={refresh}
            />
          ))}
        </div>
      ))}

      {value.totals.length > 0 && (
        <p className="text-xs text-brand-black/50">
          Stock on hand:{" "}
          {value.totals
            .map((total) => formatMoney(total.minor, total.currency))
            .join(" · ")}
          {value.unpriced > 0 &&
            ` — ${value.unpriced} line${value.unpriced === 1 ? "" : "s"} with no unit cost, not counted.`}
        </p>
      )}
    </section>
  );
}

type StockItem =
  inferRouterOutputs<AppRouter>["garage"]["inventory"]["items"][number];

const LEVEL_TONE: Record<ReturnType<typeof stockLevel>, string> = {
  out: "text-brand-red",
  low: "text-amber-600",
  ok: "text-brand-black/60",
  untracked: "text-brand-black/40",
};

function ItemRow({
  item,
  canWrite,
  open,
  onToggle,
  onChanged,
}: {
  item: StockItem;
  canWrite: boolean;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const level = stockLevel(item);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-medium">
              {item.name}
              {item.partNumber && (
                <span className="ml-2 font-mono text-xs text-brand-black/50">
                  {item.partNumber}
                </span>
              )}
            </p>
            <p className="text-xs text-brand-black/60">
              {[
                item.location,
                item.car?.name && `fits ${item.car.name}`,
                item.supplier,
              ]
                .filter(Boolean)
                .join(" · ") || "No location recorded"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold tabular-nums">
              {item.quantity}
              <span className="ml-1 text-xs font-normal text-brand-black/50">
                {item.unit}
              </span>
            </p>
            <p className={`text-xs ${LEVEL_TONE[level]}`}>
              {STOCK_LEVEL_LABELS[level]}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-brand-black/50">
          {/* A unit-tracked line has no keypad on purpose: its count is the
              number of labelled parts on the shelf, and letting somebody type
              over it would let the two drift apart invisibly. */}
          {canWrite && !item.trackUnits && (
            <MoveForm item={item} onSaved={onChanged} />
          )}
          {item.trackUnits && (
            <span className="rounded-full bg-brand-black/5 px-2 py-0.5">
              Labelled part by part
            </span>
          )}
          <button
            type="button"
            className="hover:text-brand-black"
            onClick={onToggle}
          >
            {open ? "Hide details" : `History (${item._count.movements})`}
          </button>
        </div>

        {open && (
          <div className="space-y-4">
            {canWrite && <UnitsPanel item={item} onChanged={onChanged} />}
            <Ledger itemId={item.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Stock movement, inline.
 *
 * Three buttons and a number rather than a form with a dropdown: the whole
 * interaction is "we used two of these", typed with one hand while the other
 * holds a part.
 */
function MoveForm({ item, onSaved }: { item: StockItem; onSaved: () => void }) {
  const [amount, setAmount] = useState("1");
  const record = api.garage.recordMovement.useMutation({
    meta: { silenceError: true },
    onSuccess: () => {
      setAmount("1");
      onSaved();
    },
  });

  const parsed = Number(amount);
  const valid = Number.isInteger(parsed) && parsed >= 0;

  return (
    <span className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min={0}
        className="w-16 rounded-md border border-brand-black/20 px-2 py-1 text-xs"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        aria-label={`Quantity for ${item.name}`}
      />
      {(
        [
          [StockMoveKind.CONSUMED, "Used"],
          [StockMoveKind.RECEIVED, "Received"],
          [StockMoveKind.ADJUSTED, "Count is"],
        ] as const
      ).map(([kind, label]) => (
        <button
          key={kind}
          type="button"
          className="rounded-md border border-brand-black/20 px-2 py-1 hover:bg-brand-black/5 disabled:opacity-40"
          disabled={!valid || record.isPending}
          onClick={() =>
            record.mutate({ itemId: item.id, kind, amount: parsed })
          }
        >
          {label}
        </button>
      ))}
      {record.error && (
        <span className="text-brand-red">{record.error.message}</span>
      )}
    </span>
  );
}

function Ledger({ itemId }: { itemId: string }) {
  const movements = api.garage.movements.useQuery({ itemId });
  if (movements.isLoading) {
    return <p className="text-xs text-brand-black/50">Loading history…</p>;
  }
  const rows = movements.data ?? [];
  if (rows.length === 0) {
    return <p className="text-xs text-brand-black/50">Nothing recorded yet.</p>;
  }

  return (
    <ul className="space-y-1 border-t border-brand-black/10 pt-2 text-xs text-brand-black/60">
      {rows.map((movement) => (
        <li key={movement.id} className="flex flex-wrap gap-x-2">
          <span className="tabular-nums">
            {new Date(movement.createdAt).toLocaleDateString()}
          </span>
          <span className="font-medium text-brand-black/80">
            {STOCK_MOVE_LABELS[movement.kind]}
          </span>
          <span className="tabular-nums">
            {movement.delta > 0 ? `+${movement.delta}` : movement.delta} →{" "}
            {movement.balance}
          </span>
          {movement.user?.profile?.displayName && (
            <span>{movement.user.profile.displayName}</span>
          )}
          {movement.event && <span>at {movement.event.name}</span>}
          {movement.reason && <span>— {movement.reason}</span>}
        </li>
      ))}
    </ul>
  );
}

function ItemForm({
  teamId,
  onSaved,
}: {
  teamId: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [partNumber, setPartNumber] = useState("");
  const [category, setCategory] = useState<PartCategory>(PartCategory.OTHER);
  const [location, setLocation] = useState("");
  const [unit, setUnit] = useState("each");
  const [quantity, setQuantity] = useState("0");
  const [minQuantity, setMinQuantity] = useState("");

  const add = api.garage.addItem.useMutation({ onSuccess: onSaved });

  return (
    <Card className="max-w-3xl">
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Part
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Front brake pads, DTC-60"
            />
          </label>
          <label className="block text-sm font-medium">
            Part number <span className="text-brand-black/50">(optional)</span>
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={partNumber}
              onChange={(event) => setPartNumber(event.target.value)}
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <label className="block text-sm font-medium">
            Category
            <select
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as PartCategory)
              }
            >
              {PART_CATEGORY_ORDER.map((option) => (
                <option key={option} value={option}>
                  {PART_CATEGORY_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Unit
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              placeholder="each / set / litre"
            />
          </label>
          <label className="block text-sm font-medium">
            In stock now
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Warn below
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={minQuantity}
              onChange={(event) => setMinQuantity(event.target.value)}
              placeholder="—"
            />
          </label>
        </div>

        <label className="block text-sm font-medium">
          Where it lives <span className="text-brand-black/50">(optional)</span>
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Trailer shelf 3"
          />
        </label>

        {add.error && (
          <p className="text-sm text-brand-red">{add.error.message}</p>
        )}
        <Button
          variant="primary"
          disabled={add.isPending || name.trim().length < 1}
          onClick={() =>
            add.mutate({
              teamId,
              name: name.trim(),
              partNumber: partNumber.trim() || null,
              category,
              location: location.trim() || null,
              unit: unit.trim() || "each",
              quantity: Math.max(0, Number(quantity) || 0),
              minQuantity: minQuantity.trim() ? Number(minQuantity) : null,
            })
          }
        >
          {add.isPending ? "Adding…" : "Add part"}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * The labelled parts behind one line.
 *
 * Hidden until somebody opens the line, because most stock never needs this.
 * Labelling every set of pads individually would be work with no payoff — the
 * count already answers "how many". This earns its place on the things with an
 * identity worth following: a gearbox, a fire bottle with a date on it, a set
 * of wheels that comes back from a weekend bent.
 */
function UnitsPanel({
  item,
  onChanged,
}: {
  item: StockItem;
  onChanged: () => void;
}) {
  const utils = api.useUtils();
  const [count, setCount] = useState("1");
  const [serials, setSerials] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const units = api.garage.units.useQuery({ itemId: item.id });

  const refresh = async () => {
    await utils.garage.units.invalidate({ itemId: item.id });
    onChanged();
  };
  const add = api.garage.addUnits.useMutation({
    onSuccess: async () => {
      setSerials("");
      setCount("1");
      await refresh();
    },
  });
  const update = api.garage.updateUnit.useMutation({ onSuccess: refresh });

  const listed = serials
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const parsedCount = listed.length > 0 ? listed.length : Number(count);

  return (
    <div className="space-y-3 rounded-md border border-brand-black/10 p-3">
      <div>
        <p className="text-sm font-semibold">Individual labels</p>
        <p className="text-xs text-brand-black/60">
          One QR per physical part. Worth it where you need to know{" "}
          <em>which</em> one — a serial, an expiry, or which went out last
          weekend. Adding any switches this line to counting by label.
        </p>
      </div>

      {units.data && units.data.units.length > 0 && (
        <ul className="divide-y divide-brand-black/5 text-sm">
          {units.data.units.map((unit) => {
            const expiry = expiryState(unit);
            return (
              <li key={unit.id} className="flex flex-wrap gap-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    {unit.serial ?? "Unmarked"}
                  </span>
                  <span className="ml-2 text-xs text-brand-black/55">
                    {UNIT_STATUS_LABELS[unit.status]}
                    {expiry !== "none" && ` · ${EXPIRY_STATE_LABELS[expiry]}`}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-xs text-brand-black/50 hover:text-brand-red"
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate({ unitId: unit.id, retire: true })
                  }
                >
                  Retire
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs font-medium">
          How many
          <input
            type="number"
            min={1}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1 text-sm"
            value={listed.length > 0 ? String(listed.length) : count}
            disabled={listed.length > 0}
            onChange={(event) => setCount(event.target.value)}
          />
        </label>
        <label className="text-xs font-medium sm:col-span-2">
          Serials (optional, one per line)
          <textarea
            rows={2}
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1 text-sm"
            value={serials}
            placeholder="Gearbox A&#10;Gearbox B"
            onChange={(event) => setSerials(event.target.value)}
          />
        </label>
        <label className="text-xs font-medium">
          Expires (optional)
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-brand-black/20 px-2 py-1 text-sm"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
          />
        </label>
      </div>

      {add.error && (
        <p className="text-xs text-brand-red">{add.error.message}</p>
      )}
      {update.error && (
        <p className="text-xs text-brand-red">{update.error.message}</p>
      )}

      <Button
        size="sm"
        variant="outline"
        disabled={
          add.isPending || !Number.isInteger(parsedCount) || parsedCount < 1
        }
        onClick={() =>
          add.mutate({
            itemId: item.id,
            count: parsedCount,
            serials: listed.length > 0 ? listed : undefined,
            expiresOn: expiresOn ? new Date(`${expiresOn}T00:00:00`) : null,
          })
        }
      >
        {add.isPending ? "Making labels…" : `Make ${parsedCount || 0} label(s)`}
      </Button>
    </div>
  );
}
