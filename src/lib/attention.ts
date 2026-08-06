/**
 * What is waiting on somebody who runs a team.
 *
 * The platform now records a great deal, and the failure mode has stopped
 * being "we cannot track this" and become "nobody noticed". An application
 * sitting unanswered for three weeks, a gearbox rebuild that went overdue in
 * February, a pay run approved but never paid — each is visible on its own
 * panel and invisible everywhere else, which means it is invisible.
 *
 * This is the one shape that answers "what needs me". It drives the badges on
 * the team console's tabs and the strip on the home dashboard, and both read
 * from the same numbers so a badge can never disagree with the page it points
 * at.
 */

export interface TeamAttention {
  teamId: string;
  teamName: string;
  teamSlug: string;
  /** Applications nobody has opened. */
  newApplications: number;
  /** Open applications older than the staleness threshold. */
  staleApplications: number;
  /** Interviews where the applicant has answered and the team has not acted. */
  interviewsToArrange: number;
  /** Service jobs already past due, by date or by running hours. */
  overdueServices: number;
  /** Pay runs sitting in draft with lines on them. */
  payRunsToApprove: number;
  /** Approved runs still carrying unpaid lines. */
  payRunsToPay: number;
  /** Stock lines at or below their reorder level, including out of stock. */
  lowStock: number;
}

export const EMPTY_ATTENTION: Omit<
  TeamAttention,
  "teamId" | "teamName" | "teamSlug"
> = {
  newApplications: 0,
  staleApplications: 0,
  interviewsToArrange: 0,
  overdueServices: 0,
  payRunsToApprove: 0,
  payRunsToPay: 0,
  lowStock: 0,
};

/**
 * How loudly an item should announce itself.
 *
 * `urgent` is reserved for things that are already wrong — money owed and not
 * paid, a car overdue a rebuild, somebody waiting three weeks for an answer.
 * Everything else is `due`, which is a prompt rather than a problem. Marking
 * everything urgent is the same as marking nothing.
 */
export type AttentionTone = "urgent" | "due";

export interface AttentionItem {
  key: string;
  count: number;
  /** Written to read as a sentence fragment: "3 new applications". */
  label: string;
  tone: AttentionTone;
  /** Where to go to deal with it. */
  href: string;
}

/**
 * The tab a count belongs to on the team console.
 *
 * Kept beside the items rather than in the console, so a badge and the link
 * under it can never point at different tabs.
 */
export const ATTENTION_TAB = {
  newApplications: "hiring",
  staleApplications: "hiring",
  interviewsToArrange: "hiring",
  overdueServices: "garage",
  payRunsToApprove: "money",
  payRunsToPay: "money",
  lowStock: "garage",
} as const satisfies Record<
  keyof Omit<TeamAttention, "teamId" | "teamName" | "teamSlug">,
  string
>;

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Everything needing attention on one team, worst first, zeros dropped.
 *
 * Zeros are dropped rather than shown as "0 overdue" — a list of things that
 * are fine is not a to-do list, and reading it teaches people to skip the
 * whole strip.
 */
export function attentionItems(attention: TeamAttention): AttentionItem[] {
  const base = `/teams/${attention.teamSlug}/manage`;
  const items: AttentionItem[] = [
    {
      key: "payRunsToPay",
      count: attention.payRunsToPay,
      label: plural(attention.payRunsToPay, "pay run") + " part-paid",
      tone: "urgent",
      href: `${base}?tab=${ATTENTION_TAB.payRunsToPay}`,
    },
    {
      key: "overdueServices",
      count: attention.overdueServices,
      label: plural(attention.overdueServices, "service") + " overdue",
      tone: "urgent",
      href: `${base}?tab=${ATTENTION_TAB.overdueServices}`,
    },
    {
      key: "staleApplications",
      count: attention.staleApplications,
      label:
        plural(attention.staleApplications, "application") + " waiting a week",
      tone: "urgent",
      href: `${base}?tab=${ATTENTION_TAB.staleApplications}`,
    },
    {
      key: "newApplications",
      count: attention.newApplications,
      label: plural(attention.newApplications, "new application"),
      tone: "due",
      href: `${base}?tab=${ATTENTION_TAB.newApplications}`,
    },
    {
      key: "interviewsToArrange",
      count: attention.interviewsToArrange,
      label:
        plural(attention.interviewsToArrange, "interview") + " to sort out",
      tone: "due",
      href: `${base}?tab=${ATTENTION_TAB.interviewsToArrange}`,
    },
    {
      key: "payRunsToApprove",
      count: attention.payRunsToApprove,
      label: plural(attention.payRunsToApprove, "pay run") + " to approve",
      tone: "due",
      href: `${base}?tab=${ATTENTION_TAB.payRunsToApprove}`,
    },
    {
      key: "lowStock",
      count: attention.lowStock,
      label: plural(attention.lowStock, "part") + " to reorder",
      tone: "due",
      href: `${base}?tab=${ATTENTION_TAB.lowStock}`,
    },
  ];

  return items.filter((item) => item.count > 0);
}

/** How many separate things want doing. Not a sum of the counts. */
export function attentionCount(attention: TeamAttention): number {
  return attentionItems(attention).length;
}

/** True when anything at all is outstanding. */
export function needsAttention(attention: TeamAttention): boolean {
  return attentionCount(attention) > 0;
}

/**
 * The badge for one console tab: the total of everything routed to it.
 *
 * Null rather than 0, because the tab component hides a null badge and a grey
 * "0" beside every tab is exactly the noise this is meant to cut through.
 */
export function tabBadge(
  attention: TeamAttention | null | undefined,
  tab: string,
): number | null {
  if (!attention) return null;
  let total = 0;
  for (const [key, target] of Object.entries(ATTENTION_TAB)) {
    if (target !== tab) continue;
    total += attention[key as keyof typeof ATTENTION_TAB];
  }
  return total > 0 ? total : null;
}

/** Teams with something outstanding, busiest first. */
export function sortByAttention(
  teams: readonly TeamAttention[],
): TeamAttention[] {
  return teams
    .filter(needsAttention)
    .sort((a, b) => {
      const urgentA = attentionItems(a).filter((i) => i.tone === "urgent").length;
      const urgentB = attentionItems(b).filter((i) => i.tone === "urgent").length;
      if (urgentA !== urgentB) return urgentB - urgentA;
      return attentionCount(b) - attentionCount(a);
    });
}
