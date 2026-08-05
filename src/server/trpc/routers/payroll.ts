import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { PayBasis, PayRunStatus } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "@/server/trpc/trpc";
import { TEAM_MANAGER_ROLES } from "@/lib/teams";
import {
  canRecordPayment,
  checkLine,
  isEditable,
  isFullyPaid,
  lineAmountMinor,
  payeeTotals,
  rateOn,
  runTotals,
  toCsv,
} from "@/lib/payroll";

/**
 * Team payroll.
 *
 * **Not a payroll processor.** Nothing here withholds tax, files a return, or
 * moves money. It works out what is owed, records what was paid, and exports
 * the figures for whoever actually runs the payroll. That boundary is stated
 * on the page as well as in the code, because a team believing otherwise would
 * be making an expensive mistake on the platform's word.
 *
 * Managers only, throughout — and unlike the garage, that is not a judgement
 * about competence. What everybody on a team is paid is not something the
 * whole roster should be able to read.
 */

async function assertPayrollAccess(
  db: PrismaClient,
  teamId: string,
  userId: string,
): Promise<void> {
  const membership = await db.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
    select: { role: true, endDate: true },
  });
  if (
    !membership ||
    membership.endDate !== null ||
    !TEAM_MANAGER_ROLES.includes(membership.role)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Payroll is for the team's owner and managers — it shows what everybody is paid.",
    });
  }
}

/** Loads a run and checks access, since every mutation below needs both. */
async function runForWrite(
  db: PrismaClient,
  payRunId: string,
  userId: string,
): Promise<{ teamId: string; status: PayRunStatus }> {
  const run = await db.payRun.findUnique({
    where: { id: payRunId },
    select: { teamId: true, status: true },
  });
  if (!run) throw new TRPCError({ code: "NOT_FOUND" });
  await assertPayrollAccess(db, run.teamId, userId);
  return run;
}

function assertEditable(status: PayRunStatus): void {
  if (!isEditable(status)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This run has been approved. Its figures are frozen — only payment marks can still change.",
    });
  }
}

const moneySchema = z.number().int().min(0).max(1_000_000_000);

export const payrollRouter = createTRPCRouter({
  // -- Standing rates ------------------------------------------------------

  /** Current rates for the team's roster, with everyone who has none. */
  rates: protectedProcedure
    .input(z.object({ teamId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertPayrollAccess(ctx.db, input.teamId, ctx.user.id);

      const [roster, rates] = await Promise.all([
        ctx.db.teamMembership.findMany({
          where: { teamId: input.teamId, endDate: null },
          select: {
            role: true,
            user: {
              select: { id: true, profile: { select: { displayName: true } } },
            },
          },
        }),
        ctx.db.payRate.findMany({
          where: { teamId: input.teamId },
          orderBy: { effectiveFrom: "desc" },
        }),
      ]);

      const now = new Date();
      return {
        members: roster.map((member) => ({
          userId: member.user.id,
          displayName: member.user.profile?.displayName ?? null,
          role: member.role,
          // The rate in force *today*, from the full history. A superseded
          // rate is kept so a March run stays explicable in December.
          rate: rateOn(
            rates.filter((rate) => rate.userId === member.user.id),
            now,
          ),
        })),
        history: rates,
      };
    }),

  /**
   * Sets somebody's rate.
   *
   * Closes the previous one rather than editing it. A pay run built in March
   * has to keep making sense in December, and it cannot if the rate behind it
   * was quietly rewritten.
   */
  setRate: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        userId: z.string().cuid(),
        basis: z.nativeEnum(PayBasis),
        amountMinor: moneySchema.nullish(),
        currency: z.string().length(3).default("USD"),
        label: z.string().max(120).nullish(),
        effectiveFrom: z.date().optional(),
        notes: z.string().max(1000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPayrollAccess(ctx.db, input.teamId, ctx.user.id);

      if (input.basis === PayBasis.UNPAID && input.amountMinor != null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "An unpaid position carries no figure. Pick a basis, or clear the amount.",
        });
      }

      const from = input.effectiveFrom ?? new Date();
      return ctx.db.$transaction(async (tx) => {
        await tx.payRate.updateMany({
          where: {
            teamId: input.teamId,
            userId: input.userId,
            effectiveTo: null,
          },
          data: { effectiveTo: from },
        });
        return tx.payRate.create({
          data: {
            teamId: input.teamId,
            userId: input.userId,
            basis: input.basis,
            amountMinor: input.basis === PayBasis.UNPAID ? null : input.amountMinor,
            currency: input.currency,
            label: input.label ?? null,
            effectiveFrom: from,
            notes: input.notes ?? null,
            createdById: ctx.user.id,
          },
        });
      });
    }),

  // -- Runs ----------------------------------------------------------------

  runs: protectedProcedure
    .input(z.object({ teamId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertPayrollAccess(ctx.db, input.teamId, ctx.user.id);

      const runs = await ctx.db.payRun.findMany({
        where: { teamId: input.teamId },
        orderBy: { periodStart: "desc" },
        include: {
          event: { select: { id: true, name: true } },
          lines: true,
          approvedBy: {
            select: { id: true, profile: { select: { displayName: true } } },
          },
        },
      });

      return runs.map((run) => ({
        ...run,
        totals: runTotals(run.lines),
        payees: payeeTotals(run.lines),
      }));
    }),

  run: protectedProcedure
    .input(z.object({ payRunId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const { teamId } = await runForWrite(ctx.db, input.payRunId, ctx.user.id);

      const run = await ctx.db.payRun.findUniqueOrThrow({
        where: { id: input.payRunId },
        include: {
          event: { select: { id: true, name: true } },
          lines: {
            orderBy: { createdAt: "asc" },
            include: {
              user: {
                select: { id: true, profile: { select: { displayName: true } } },
              },
              event: { select: { id: true, name: true } },
            },
          },
        },
      });

      return {
        run,
        teamId,
        totals: runTotals(run.lines),
        payees: payeeTotals(run.lines),
        fullyPaid: isFullyPaid(run.lines),
      };
    }),

  createRun: protectedProcedure
    .input(
      z.object({
        teamId: z.string().cuid(),
        label: z.string().min(1).max(120),
        periodStart: z.date(),
        periodEnd: z.date(),
        eventId: z.string().cuid().nullish(),
        notes: z.string().max(4000).nullish(),
        /**
         * Pre-fills a line per person with a standing rate.
         *
         * The whole point of keeping rates: a monthly run should be a few
         * quantities typed in, not the entire roster re-entered from scratch.
         */
        prefillFromRates: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPayrollAccess(ctx.db, input.teamId, ctx.user.id);

      if (input.periodEnd < input.periodStart) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The period ends before it starts.",
        });
      }

      const run = await ctx.db.payRun.create({
        data: {
          teamId: input.teamId,
          label: input.label.trim(),
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          eventId: input.eventId ?? null,
          notes: input.notes ?? null,
          createdById: ctx.user.id,
        },
      });

      if (!input.prefillFromRates) return run;

      const roster = await ctx.db.teamMembership.findMany({
        where: { teamId: input.teamId, endDate: null },
        select: {
          userId: true,
          user: { select: { profile: { select: { displayName: true } } } },
        },
      });
      const rates = await ctx.db.payRate.findMany({
        where: { teamId: input.teamId },
      });

      for (const member of roster) {
        // The rate in force at the *end* of the period, which is the one a
        // team means when it says "what are we paying them".
        const rate = rateOn(
          rates.filter((row) => row.userId === member.userId),
          input.periodEnd,
        );
        // No rate, or an unpaid one, means no line. A zero-value row per
        // volunteer would bury the people who are actually owed money.
        if (!rate || rate.basis === PayBasis.UNPAID || rate.amountMinor == null) {
          continue;
        }

        await ctx.db.payrollLine.create({
          data: {
            payRunId: run.id,
            userId: member.userId,
            description:
              rate.label ??
              `${member.user.profile?.displayName ?? "Team member"} — ${input.label.trim()}`,
            basis: rate.basis,
            // One unit, so a manager confirms the count rather than being
            // handed a number the platform guessed.
            quantity: 1,
            rateMinor: rate.amountMinor,
            amountMinor: rate.amountMinor,
            currency: rate.currency,
            payRateId: rate.id,
            eventId: input.eventId ?? null,
          },
        });
      }

      return run;
    }),

  addLine: protectedProcedure
    .input(
      z.object({
        payRunId: z.string().cuid(),
        userId: z.string().cuid().nullish(),
        payeeName: z.string().min(1).max(160).nullish(),
        description: z.string().min(1).max(300),
        basis: z.nativeEnum(PayBasis).default(PayBasis.PER_EVENT),
        quantity: z.number().min(0).max(100_000).default(1),
        rateMinor: moneySchema.default(0),
        currency: z.string().length(3).default("USD"),
        adjustmentMinor: z
          .number()
          .int()
          .min(-1_000_000_000)
          .max(1_000_000_000)
          .default(0),
        adjustmentNote: z.string().max(300).nullish(),
        eventId: z.string().cuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const run = await runForWrite(ctx.db, input.payRunId, ctx.user.id);
      assertEditable(run.status);

      // Exactly one payee. The database enforces it too; this is the same rule
      // stated where a form can show it.
      if (Boolean(input.userId) === Boolean(input.payeeName)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Pick a team member, or type a name for somebody without an account — not both.",
        });
      }

      const problem = checkLine(input);
      if (problem) {
        throw new TRPCError({ code: "BAD_REQUEST", message: problem.message });
      }

      return ctx.db.payrollLine.create({
        data: {
          ...input,
          userId: input.userId ?? null,
          payeeName: input.payeeName ?? null,
          amountMinor: lineAmountMinor(input),
        },
      });
    }),

  updateLine: protectedProcedure
    .input(
      z.object({
        lineId: z.string().cuid(),
        description: z.string().min(1).max(300).optional(),
        basis: z.nativeEnum(PayBasis).optional(),
        quantity: z.number().min(0).max(100_000).optional(),
        rateMinor: moneySchema.optional(),
        adjustmentMinor: z
          .number()
          .int()
          .min(-1_000_000_000)
          .max(1_000_000_000)
          .optional(),
        adjustmentNote: z.string().max(300).nullish(),
        eventId: z.string().cuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { lineId, ...changes } = input;
      const line = await ctx.db.payrollLine.findUnique({
        where: { id: lineId },
        select: {
          payRunId: true,
          basis: true,
          quantity: true,
          rateMinor: true,
          adjustmentMinor: true,
        },
      });
      if (!line) throw new TRPCError({ code: "NOT_FOUND" });
      const run = await runForWrite(ctx.db, line.payRunId, ctx.user.id);
      assertEditable(run.status);

      const merged = {
        basis: changes.basis ?? line.basis,
        quantity: changes.quantity ?? line.quantity,
        rateMinor: changes.rateMinor ?? line.rateMinor,
        adjustmentMinor: changes.adjustmentMinor ?? line.adjustmentMinor,
      };
      const problem = checkLine(merged);
      if (problem) {
        throw new TRPCError({ code: "BAD_REQUEST", message: problem.message });
      }

      return ctx.db.payrollLine.update({
        where: { id: lineId },
        // Recomputed on every edit, so the stored figure can never drift from
        // the numbers it was worked out from while the run is still a draft.
        data: { ...changes, amountMinor: lineAmountMinor(merged) },
      });
    }),

  removeLine: protectedProcedure
    .input(z.object({ lineId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const line = await ctx.db.payrollLine.findUnique({
        where: { id: input.lineId },
        select: { payRunId: true, paidAt: true },
      });
      if (!line) throw new TRPCError({ code: "NOT_FOUND" });
      const run = await runForWrite(ctx.db, line.payRunId, ctx.user.id);
      assertEditable(run.status);

      if (line.paidAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "That line has been paid. Deleting it would leave money out of the door with no record of why.",
        });
      }

      await ctx.db.payrollLine.delete({ where: { id: input.lineId } });
      return { deleted: true };
    }),

  /**
   * Freezes a run.
   *
   * After this the figures cannot change, only the payment marks. That is the
   * whole point of an approval step: money should not go out against a number
   * that can still be edited behind it.
   */
  approve: protectedProcedure
    .input(z.object({ payRunId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const run = await runForWrite(ctx.db, input.payRunId, ctx.user.id);
      if (run.status !== PayRunStatus.DRAFT) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Only a draft can be approved.",
        });
      }

      const lines = await ctx.db.payrollLine.count({
        where: { payRunId: input.payRunId },
      });
      if (lines === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "There is nothing on this run to approve.",
        });
      }

      return ctx.db.payRun.update({
        where: { id: input.payRunId },
        data: {
          status: PayRunStatus.APPROVED,
          approvedById: ctx.user.id,
          approvedAt: new Date(),
        },
      });
    }),

  /**
   * Records that a line was paid.
   *
   * The reference is free text and stays that way. The platform does not move
   * the money and should not pretend to know how it moved — a bank reference,
   * a cheque number and "cash at the track" are all real answers.
   */
  markLinePaid: protectedProcedure
    .input(
      z.object({
        lineId: z.string().cuid(),
        paid: z.boolean(),
        paymentReference: z.string().max(200).nullish(),
        paidAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const line = await ctx.db.payrollLine.findUnique({
        where: { id: input.lineId },
        select: { payRunId: true },
      });
      if (!line) throw new TRPCError({ code: "NOT_FOUND" });
      const run = await runForWrite(ctx.db, line.payRunId, ctx.user.id);

      if (!canRecordPayment(run.status)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Approve the run before recording payments against it.",
        });
      }

      const updated = await ctx.db.payrollLine.update({
        where: { id: input.lineId },
        data: {
          paidAt: input.paid ? (input.paidAt ?? new Date()) : null,
          paymentReference: input.paid ? (input.paymentReference ?? null) : null,
        },
      });

      // A run everything has been paid on closes itself. Left to a manager it
      // would sit "approved" forever, and the list would stop meaning anything.
      const lines = await ctx.db.payrollLine.findMany({
        where: { payRunId: line.payRunId },
        select: { paidAt: true, currency: true, amountMinor: true },
      });
      await ctx.db.payRun.update({
        where: { id: line.payRunId },
        data: isFullyPaid(lines)
          ? { status: PayRunStatus.PAID, paidAt: new Date() }
          : { status: PayRunStatus.APPROVED, paidAt: null },
      });

      return updated;
    }),

  cancelRun: protectedProcedure
    .input(z.object({ payRunId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const run = await runForWrite(ctx.db, input.payRunId, ctx.user.id);
      if (run.status === PayRunStatus.PAID) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "That run has been paid. Cancelling it would hide payments that already went out.",
        });
      }
      return ctx.db.payRun.update({
        where: { id: input.payRunId },
        data: { status: PayRunStatus.CANCELED },
      });
    }),

  /**
   * The run as CSV, for whoever actually pays people.
   *
   * Returned as a string rather than a download URL: it is a few kilobytes,
   * and putting a payroll file in object storage behind a guessable link would
   * be a poor trade for saving a round trip.
   */
  exportCsv: protectedProcedure
    .input(z.object({ payRunId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await runForWrite(ctx.db, input.payRunId, ctx.user.id);

      const run = await ctx.db.payRun.findUniqueOrThrow({
        where: { id: input.payRunId },
        include: {
          lines: {
            orderBy: { createdAt: "asc" },
            include: {
              user: {
                select: { profile: { select: { displayName: true } } },
              },
            },
          },
        },
      });

      const csv = toCsv(
        run.lines.map((line) => ({
          payeeName:
            line.payeeName ?? line.user?.profile?.displayName ?? "Unnamed",
          description: line.description,
          basis: line.basis,
          quantity: line.quantity,
          rateMinor: line.rateMinor,
          adjustmentMinor: line.adjustmentMinor,
          amountMinor: line.amountMinor,
          currency: line.currency,
          paidAt: line.paidAt,
          paymentReference: line.paymentReference,
        })),
      );

      return {
        csv,
        filename: `payroll-${run.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`,
      };
    }),
});
