"use client";

import { useState } from "react";
import { PayBasis, PayRunStatus } from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/root";
import { api } from "@/lib/trpc/client";
import {
  PAY_RUN_STATUS_LABELS,
  canRecordPayment,
  describeLine,
  formatMinor,
  isEditable,
} from "@/lib/payroll";
import { PAY_BASIS_LABELS, PAY_BASIS_ORDER, describePay } from "@/lib/offers";
import { TEAM_ROLE_LABELS } from "@/lib/teams";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Team payroll.
 *
 * The limit is stated at the top of the panel and not in a tooltip: this
 * records and exports, it does not withhold tax, file anything or move money.
 * A team that believed otherwise on the platform's word would be making an
 * expensive mistake, and burying the caveat would be the platform's fault
 * rather than theirs.
 */

type Runs = inferRouterOutputs<AppRouter>["payroll"]["runs"];
type Run = Runs[number];

export function PayrollPanel({ teamId }: { teamId: string }) {
  const utils = api.useUtils();
  const runs = api.payroll.runs.useQuery({ teamId }, { retry: false });
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showRates, setShowRates] = useState(false);

  const refresh = () => {
    utils.payroll.runs.invalidate({ teamId });
    utils.payroll.rates.invalidate({ teamId });
  };

  if (runs.error) {
    return (
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Payroll</h2>
        <p className="text-sm text-brand-black/60">{runs.error.message}</p>
      </section>
    );
  }

  const list = runs.data ?? [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Payroll</h2>
          <p className="max-w-2xl text-sm text-brand-black/60">
            What the team owes, and what has been paid.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowRates((value) => !value)}
          >
            {showRates ? "Hide rates" : "Pay rates"}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setCreating((value) => !value)}
          >
            {creating ? "Cancel" : "New pay run"}
          </Button>
        </div>
      </div>

      {/* Stated plainly and in the flow of the page, not in a tooltip. */}
      <Card className="border-brand-black/20 bg-brand-black/[0.03]">
        <CardContent className="p-4 text-sm text-brand-black/75">
          <span className="font-semibold">
            This works out and records pay. It does not run payroll.
          </span>{" "}
          Nothing here withholds tax, files a return, or moves money. Export the
          run and give it to whoever actually pays people — your accountant, a
          bureau, or your bank.
        </CardContent>
      </Card>

      {showRates && <RatesPanel teamId={teamId} onChanged={refresh} />}

      {creating && (
        <RunForm
          teamId={teamId}
          onSaved={(runId) => {
            setCreating(false);
            setOpenId(runId);
            refresh();
          }}
        />
      )}

      {runs.isLoading && (
        <p className="text-sm text-brand-black/60">Loading pay runs…</p>
      )}

      {!runs.isLoading && list.length === 0 && !creating && (
        <p className="rounded-lg border border-dashed border-brand-black/20 p-6 text-center text-sm text-brand-black/55">
          No pay runs yet. Set rates for the people you pay, then create a run —
          it starts pre-filled from those rates rather than from a blank sheet.
        </p>
      )}

      <div className="space-y-2">
        {list.map((run) => (
          <RunRow
            key={run.id}
            run={run}
            open={openId === run.id}
            onToggle={() =>
              setOpenId((current) => (current === run.id ? null : run.id))
            }
            onChanged={refresh}
          />
        ))}
      </div>
    </section>
  );
}

function RunRow({
  run,
  open,
  onToggle,
  onChanged,
}: {
  run: Run;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <button
          type="button"
          className="flex w-full flex-wrap items-start justify-between gap-2 text-left"
          onClick={onToggle}
        >
          <div>
            <p className="font-medium">{run.label}</p>
            <p className="text-xs text-brand-black/60">
              {new Date(run.periodStart).toLocaleDateString()} –{" "}
              {new Date(run.periodEnd).toLocaleDateString()}
              {run.event && ` · ${run.event.name}`}
              {` · ${run.lines.length} line${run.lines.length === 1 ? "" : "s"}`}
            </p>
          </div>
          <div className="text-right">
            <Badge
              variant={
                run.status === PayRunStatus.PAID ? "verified" : "outline"
              }
            >
              {PAY_RUN_STATUS_LABELS[run.status]}
            </Badge>
            <p className="mt-1 text-sm tabular-nums text-brand-black/70">
              {run.totals.length === 0
                ? "—"
                : run.totals
                    .map((total) =>
                      formatMinor(total.grossMinor, total.currency),
                    )
                    .join(" · ")}
            </p>
          </div>
        </button>

        {run.totals.some((total) => total.outstandingMinor > 0) && (
          <p className="text-xs text-brand-black/55">
            Outstanding:{" "}
            {run.totals
              .filter((total) => total.outstandingMinor > 0)
              .map((total) =>
                formatMinor(total.outstandingMinor, total.currency),
              )
              .join(" · ")}
          </p>
        )}

        {open && <RunDetail payRunId={run.id} onChanged={onChanged} />}
      </CardContent>
    </Card>
  );
}

function RunDetail({
  payRunId,
  onChanged,
}: {
  payRunId: string;
  onChanged: () => void;
}) {
  const utils = api.useUtils();
  const detail = api.payroll.run.useQuery({ payRunId });
  const [adding, setAdding] = useState(false);

  const approve = api.payroll.approve.useMutation({
    meta: { silenceError: true },
    onSuccess: () => {
      utils.payroll.run.invalidate({ payRunId });
      onChanged();
    },
  });
  const csv = api.payroll.exportCsv.useQuery({ payRunId }, { enabled: false });

  const refresh = () => {
    utils.payroll.run.invalidate({ payRunId });
    onChanged();
  };

  if (detail.isLoading) {
    return <p className="text-sm text-brand-black/60">Loading…</p>;
  }
  if (detail.error) {
    return <p className="text-sm text-brand-red">{detail.error.message}</p>;
  }

  const { run, payees } = detail.data!;
  const editable = isEditable(run.status);

  async function download() {
    const result = await csv.refetch();
    if (!result.data) return;
    // Built and revoked in the browser: a payroll file has no business
    // sitting in object storage behind a guessable link.
    const blob = new Blob([result.data.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.data.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3 border-t border-brand-black/10 pt-3">
      <div className="flex flex-wrap gap-2">
        {editable && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAdding((value) => !value)}
          >
            {adding ? "Cancel" : "Add a line"}
          </Button>
        )}
        {editable && run.lines.length > 0 && (
          <Button
            size="sm"
            variant="primary"
            disabled={approve.isPending}
            onClick={() => approve.mutate({ payRunId })}
            title="Freezes the figures. After this only payment marks can change."
          >
            {approve.isPending ? "Approving…" : "Approve"}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => void download()}>
          Export CSV
        </Button>
      </div>
      {approve.error && (
        <p className="text-sm text-brand-red">{approve.error.message}</p>
      )}

      {adding && (
        <LineForm
          payRunId={payRunId}
          teamId={detail.data!.teamId}
          onSaved={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}

      {run.lines.length === 0 ? (
        <p className="text-sm text-brand-black/55">Nothing on this run yet.</p>
      ) : (
        <div className="space-y-1">
          {run.lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              status={run.status}
              onChanged={refresh}
            />
          ))}
        </div>
      )}

      {payees.length > 0 && (
        <div className="rounded-lg bg-brand-black/[0.03] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
            Per person
          </p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {payees.map((payee) => (
              <li key={payee.key} className="flex justify-between gap-4">
                <span>{payee.payeeName ?? "Team member"}</span>
                <span className="tabular-nums">
                  {formatMinor(payee.grossMinor, payee.currency)}
                  {payee.outstandingMinor > 0 && (
                    <span className="ml-2 text-xs text-brand-black/50">
                      {formatMinor(payee.outstandingMinor, payee.currency)} due
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type RunDetailData = inferRouterOutputs<AppRouter>["payroll"]["run"];
type PayLine = RunDetailData["run"]["lines"][number];

function LineRow({
  line,
  status,
  onChanged,
}: {
  line: PayLine;
  status: PayRunStatus;
  onChanged: () => void;
}) {
  const [reference, setReference] = useState("");
  const markPaid = api.payroll.markLinePaid.useMutation({
    onSuccess: onChanged,
  });
  const remove = api.payroll.removeLine.useMutation({ onSuccess: onChanged });

  const name = line.payeeName ?? line.user?.profile?.displayName ?? "Unnamed";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-black/10 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium">
          {name}
          {!line.userId && (
            <span className="ml-2 text-xs font-normal text-brand-black/45">
              no account
            </span>
          )}
        </p>
        <p className="truncate text-xs text-brand-black/60">
          {line.description} · {describeLine(line)}
          {line.adjustmentMinor !== 0 && (
            <>
              {" "}
              · {line.adjustmentMinor > 0 ? "+" : ""}
              {formatMinor(line.adjustmentMinor, line.currency)}
              {line.adjustmentNote && ` (${line.adjustmentNote})`}
            </>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <span className="tabular-nums font-medium">
          {formatMinor(line.amountMinor, line.currency)}
        </span>

        {line.paidAt ? (
          <span className="text-xs text-brand-black/50">
            paid {new Date(line.paidAt).toLocaleDateString()}
            {line.paymentReference && ` · ${line.paymentReference}`}
            {canRecordPayment(status) && (
              <button
                type="button"
                className="ml-2 hover:text-brand-red"
                disabled={markPaid.isPending}
                onClick={() =>
                  markPaid.mutate({ lineId: line.id, paid: false })
                }
              >
                undo
              </button>
            )}
          </span>
        ) : canRecordPayment(status) ? (
          <span className="flex items-center gap-1">
            <input
              className="w-28 rounded-md border border-brand-black/20 px-2 py-1 text-xs"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="reference"
              aria-label={`Payment reference for ${name}`}
            />
            <button
              type="button"
              className="rounded-md border border-brand-black/20 px-2 py-1 text-xs hover:bg-brand-black/5"
              disabled={markPaid.isPending}
              onClick={() =>
                markPaid.mutate({
                  lineId: line.id,
                  paid: true,
                  paymentReference: reference.trim() || null,
                })
              }
            >
              Mark paid
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="text-xs text-brand-black/45 hover:text-brand-red"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ lineId: line.id })}
          >
            Remove
          </button>
        )}
      </div>
      {(markPaid.error ?? remove.error) && (
        <p className="w-full text-xs text-brand-red">
          {markPaid.error?.message ?? remove.error?.message}
        </p>
      )}
    </div>
  );
}

function RunForm({
  teamId,
  onSaved,
}: {
  teamId: string;
  onSaved: (runId: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [label, setLabel] = useState("");
  const [start, setStart] = useState(today.slice(0, 8) + "01");
  const [end, setEnd] = useState(today);
  const [prefill, setPrefill] = useState(true);

  const create = api.payroll.createRun.useMutation({
    onSuccess: (run) => onSaved(run.id),
  });

  return (
    <Card className="max-w-2xl">
      <CardContent className="space-y-3 p-5">
        <label className="block text-sm font-medium">
          What to call it
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="March 2026, or Sebring 12h"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Period from
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            to
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefill}
            onChange={(event) => setPrefill(event.target.checked)}
          />
          <span>
            Start from the standing rates
            <span className="block text-xs text-brand-black/55">
              A line per person who has one, at quantity 1 — confirm the counts
              rather than typing the roster out again. Volunteers are left off.
            </span>
          </span>
        </label>

        {create.error && (
          <p className="text-sm text-brand-red">{create.error.message}</p>
        )}
        <Button
          variant="primary"
          disabled={create.isPending || label.trim().length < 1}
          onClick={() =>
            create.mutate({
              teamId,
              label: label.trim(),
              periodStart: new Date(`${start}T00:00:00`),
              periodEnd: new Date(`${end}T23:59:59`),
              prefillFromRates: prefill,
            })
          }
        >
          {create.isPending ? "Creating…" : "Create run"}
        </Button>
      </CardContent>
    </Card>
  );
}

function LineForm({
  payRunId,
  teamId,
  onSaved,
}: {
  payRunId: string;
  teamId: string;
  onSaved: () => void;
}) {
  const rates = api.payroll.rates.useQuery({ teamId });
  const [userId, setUserId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [description, setDescription] = useState("");
  const [basis, setBasis] = useState<PayBasis>(PayBasis.PER_EVENT);
  const [quantity, setQuantity] = useState("1");
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState("USD");

  const add = api.payroll.addLine.useMutation({ onSuccess: onSaved });

  return (
    <div className="space-y-3 rounded-lg border border-brand-black/10 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Team member
          <select
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              if (event.target.value) setPayeeName("");
            }}
          >
            <option value="">—</option>
            {(rates.data?.members ?? []).map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName ?? "Unnamed"}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          …or somebody without an account
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={payeeName}
            disabled={Boolean(userId)}
            onChange={(event) => setPayeeName(event.target.value)}
            placeholder="Weekend mechanic"
          />
        </label>
      </div>

      <label className="block text-sm font-medium">
        What for
        <input
          className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Race engineer, Sebring 12h"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block text-sm font-medium">
          Basis
          <select
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={basis}
            onChange={(event) => setBasis(event.target.value as PayBasis)}
          >
            {PAY_BASIS_ORDER.map((option) => (
              <option key={option} value={option}>
                {PAY_BASIS_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          How many
          <input
            type="number"
            min={0}
            step="0.25"
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          Rate
          <input
            type="number"
            min={0}
            step="0.01"
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          Currency
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            maxLength={3}
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </label>
      </div>

      {add.error && (
        <p className="text-sm text-brand-red">{add.error.message}</p>
      )}
      <Button
        size="sm"
        variant="primary"
        disabled={
          add.isPending ||
          description.trim().length < 1 ||
          Boolean(userId) === Boolean(payeeName.trim())
        }
        onClick={() =>
          add.mutate({
            payRunId,
            userId: userId || null,
            payeeName: userId ? null : payeeName.trim() || null,
            description: description.trim(),
            basis,
            quantity: Number(quantity) || 0,
            rateMinor: Math.round((Number(rate) || 0) * 100),
            currency,
          })
        }
      >
        {add.isPending ? "Adding…" : "Add line"}
      </Button>
    </div>
  );
}

function RatesPanel({
  teamId,
  onChanged,
}: {
  teamId: string;
  onChanged: () => void;
}) {
  const rates = api.payroll.rates.useQuery({ teamId });
  const [editing, setEditing] = useState<string | null>(null);

  if (rates.isLoading) {
    return <p className="text-sm text-brand-black/60">Loading rates…</p>;
  }

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
          Standing pay rates
        </p>
        {(rates.data?.members ?? []).map((member) => (
          <div key={member.userId} className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {member.displayName ?? "Unnamed"}
                <span className="ml-2 text-xs text-brand-black/50">
                  {TEAM_ROLE_LABELS[member.role]}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-brand-black/70">
                  {member.rate ? describePay(member.rate) : "No rate set"}
                </span>
                <button
                  type="button"
                  className="text-xs text-brand-red hover:underline"
                  onClick={() =>
                    setEditing((current) =>
                      current === member.userId ? null : member.userId,
                    )
                  }
                >
                  {editing === member.userId ? "cancel" : "set"}
                </button>
              </span>
            </div>
            {editing === member.userId && (
              <RateForm
                teamId={teamId}
                userId={member.userId}
                onSaved={() => {
                  setEditing(null);
                  onChanged();
                }}
              />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function RateForm({
  teamId,
  userId,
  onSaved,
}: {
  teamId: string;
  userId: string;
  onSaved: () => void;
}) {
  const [basis, setBasis] = useState<PayBasis>(PayBasis.PER_EVENT);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [label, setLabel] = useState("");

  const save = api.payroll.setRate.useMutation({
    meta: { successMessage: "Pay rate saved." },
    onSuccess: onSaved,
  });
  const unpaid = basis === PayBasis.UNPAID;

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md bg-brand-black/[0.03] p-3">
      <label className="block text-xs font-medium">
        Basis
        <select
          className="mt-1 block rounded-md border border-brand-black/20 px-2 py-1 text-xs"
          value={basis}
          onChange={(event) => {
            setBasis(event.target.value as PayBasis);
            if (event.target.value === PayBasis.UNPAID) setAmount("");
          }}
        >
          {PAY_BASIS_ORDER.map((option) => (
            <option key={option} value={option}>
              {PAY_BASIS_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium">
        Amount
        <input
          type="number"
          min={0}
          step="0.01"
          disabled={unpaid}
          className="mt-1 block w-24 rounded-md border border-brand-black/20 px-2 py-1 text-xs disabled:bg-brand-black/5"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>
      <label className="block text-xs font-medium">
        Currency
        <input
          maxLength={3}
          className="mt-1 block w-16 rounded-md border border-brand-black/20 px-2 py-1 text-xs"
          value={currency}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
        />
      </label>
      <label className="block text-xs font-medium">
        For
        <input
          className="mt-1 block rounded-md border border-brand-black/20 px-2 py-1 text-xs"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Race engineering"
        />
      </label>
      <Button
        size="sm"
        variant="primary"
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            teamId,
            userId,
            basis,
            amountMinor:
              unpaid || !amount.trim()
                ? null
                : Math.round(Number(amount) * 100),
            currency,
            label: label.trim() || null,
          })
        }
      >
        Save
      </Button>
      {save.error && (
        <p className="w-full text-xs text-brand-red">{save.error.message}</p>
      )}
    </div>
  );
}
