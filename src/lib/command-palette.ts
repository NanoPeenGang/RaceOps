/**
 * The command palette: matching, ranking and the command set.
 *
 * Everything here is pure. The component does the keyboard, the focus and the
 * localStorage; this file decides what a query means, which is the part worth
 * testing and the part that is easy to get subtly wrong.
 *
 * Why a palette at all: there are 45 pages under the dashboard and twenty
 * top-level destinations, ten of which sit behind a menu. Features have
 * shipped and then been reported as missing more than once — not because they
 * were broken but because nobody could find them. Typing the name of a thing
 * is the shortest path to it that does not require reorganising the app first.
 */

/**
 * Which block of the palette a command belongs to.
 *
 * The order of this union is the order the groups render in, so it is not
 * alphabetical by accident — it runs from "the thing you were just doing" out
 * to "something on the platform you may not have seen before".
 */
export const COMMAND_GROUPS = [
  "recent",
  "context",
  "page",
  "action",
  "result",
] as const;

export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export const GROUP_LABELS: Record<CommandGroup, string> = {
  recent: "Recently opened",
  context: "Switch to",
  page: "Jump to",
  action: "Do something",
  result: "Found on RaceOps",
};

/** Named so the component can map to an SVG without the lib importing JSX. */
export type CommandIcon =
  | "home"
  | "users"
  | "inbox"
  | "money"
  | "wrench"
  | "flag"
  | "message"
  | "settings"
  | "calendar"
  | "doc"
  | "search"
  | "scan"
  | "box"
  | "ticket"
  | "clock"
  | "plus"
  | "grid";

export interface Command {
  /** Stable across sessions — recents are stored by this. */
  id: string;
  title: string;
  /**
   * Where the command lives, rendered as "Apex Racing › Garage".
   *
   * This is what makes a palette entry legible out of context: "Invoices" on
   * its own is ambiguous the moment somebody is in two teams.
   */
  trail?: string[];
  /** Right-hand detail: a count, a date, a status. */
  hint?: string;
  href: string;
  group: CommandGroup;
  icon?: CommandIcon;
  /**
   * Words that should match but do not appear on screen — the vocabulary
   * people actually type. Somebody looking for the scan station types
   * "barcode"; somebody looking for Money types "payroll".
   */
  keywords?: string[];
}

/* -------------------------------------------------------------------------
 * Matching
 * ---------------------------------------------------------------------- */

/** Inclusive-exclusive character ranges of `text` that the query matched. */
export type MatchRange = [number, number];

export interface Match {
  score: number;
  ranges: MatchRange[];
}

/*
 * Scoring weights.
 *
 * These are ordered by how much signal each carries rather than tuned to a
 * benchmark. A match at the start of a word is the strongest evidence that
 * somebody meant that word — typing "inv" for "Invoices" — so it outweighs
 * everything else. Contiguity comes next: "invo" matching four letters in a
 * row beats the same four letters scattered through "Individual volunteers".
 */
const BOUNDARY_BONUS = 16;
const CONTIGUOUS_BONUS = 10;
const MATCH_BASE = 3;
/** Skipping characters costs, but never enough to make a real match negative. */
const LEADING_PENALTY = 1;
const GAP_PENALTY = 1;
const MAX_LEADING_PENALTY = 12;

function isWordBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1]!;
  // A capital after a lowercase starts a word too, so "RaceControl" and
  // "Race control" behave the same way.
  if (/[a-z0-9]/.test(previous) && /[A-Z]/.test(text[index]!)) return true;
  return !/[a-zA-Z0-9]/.test(previous);
}

/**
 * Cheap gate before the real scorer.
 *
 * The palette scores every command on every keystroke. Most of them cannot
 * match at all, and a subsequence test rejects those in a single pass instead
 * of filling a matrix to discover the same thing.
 */
export function isSubsequence(query: string, text: string): boolean {
  if (query.length === 0) return true;
  if (query.length > text.length) return false;
  let q = 0;
  for (let t = 0; t < text.length && q < query.length; t += 1) {
    if (text[t] === query[q]) q += 1;
  }
  return q === query.length;
}

/**
 * Score `query` against `text`, returning the best alignment.
 *
 * Deliberately not greedy. Greedy matching takes the first occurrence of each
 * character, which gets "sc" in "Scan station" wrong the moment a command
 * called "Services and compliance" is in the list: the greedy path finds the
 * 's' of "Services" and then any later 'c' and scores it as a hit. The full
 * alignment is small enough to compute — titles are short — and it is the
 * difference between a palette that feels psychic and one that feels random.
 */
export function scoreMatch(rawQuery: string, rawText: string): Match | null {
  const query = rawQuery.toLowerCase();
  const text = rawText.toLowerCase();

  if (query.length === 0) return { score: 0, ranges: [] };
  if (!isSubsequence(query, text)) return null;

  const n = query.length;
  const m = text.length;

  // best[i][j]: the best score for matching query[0..i] with query[i] landing
  // on text[j]. `from` remembers where the previous character landed so the
  // winning alignment can be walked back for highlight ranges.
  const NEG = Number.NEGATIVE_INFINITY;
  const best: number[][] = [];
  const from: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    best.push(new Array<number>(m).fill(NEG));
    from.push(new Array<number>(m).fill(-1));
  }

  for (let j = 0; j < m; j += 1) {
    if (text[j] !== query[0]) continue;
    const leading = Math.min(j * LEADING_PENALTY, MAX_LEADING_PENALTY);
    best[0]![j] = MATCH_BASE + (isWordBoundary(rawText, j) ? BOUNDARY_BONUS : 0) - leading;
  }

  for (let i = 1; i < n; i += 1) {
    for (let j = i; j < m; j += 1) {
      if (text[j] !== query[i]) continue;
      let bestPrevious = NEG;
      let bestPreviousIndex = -1;
      for (let k = i - 1; k < j; k += 1) {
        const previous = best[i - 1]![k]!;
        if (previous === NEG) continue;
        const gap = j - k - 1;
        const candidate =
          previous +
          MATCH_BASE +
          (gap === 0 ? CONTIGUOUS_BONUS : -gap * GAP_PENALTY) +
          (isWordBoundary(rawText, j) ? BOUNDARY_BONUS : 0);
        if (candidate > bestPrevious) {
          bestPrevious = candidate;
          bestPreviousIndex = k;
        }
      }
      if (bestPreviousIndex >= 0) {
        best[i]![j] = bestPrevious;
        from[i]![j] = bestPreviousIndex;
      }
    }
  }

  let endIndex = -1;
  let endScore = NEG;
  for (let j = 0; j < m; j += 1) {
    if (best[n - 1]![j]! > endScore) {
      endScore = best[n - 1]![j]!;
      endIndex = j;
    }
  }
  if (endIndex < 0) return null;

  const positions: number[] = [];
  let j = endIndex;
  for (let i = n - 1; i >= 0; i -= 1) {
    positions.push(j);
    j = from[i]![j]!;
  }
  positions.reverse();

  /*
   * A whole-word or whole-string hit is worth calling out separately. Without
   * this, typing a command's exact name can still rank below a longer title
   * that happens to collect more boundary bonuses along the way.
   */
  let score = endScore;
  if (text === query) score += 60;
  else if (text.startsWith(query)) score += 30;
  else if (text.includes(query)) score += 12;

  return { score, ranges: toRanges(positions) };
}

function toRanges(positions: number[]): MatchRange[] {
  const ranges: MatchRange[] = [];
  for (const position of positions) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === position) last[1] = position + 1;
    else ranges.push([position, position + 1]);
  }
  return ranges;
}

/* -------------------------------------------------------------------------
 * Ranking
 * ---------------------------------------------------------------------- */

/*
 * A command matches on more than its title, but not equally.
 *
 * Keywords exist so that "barcode" finds the scan station, and the trail
 * exists so that "apex invoices" finds the right team's invoices. Neither
 * should outrank a command whose visible name is what was typed, so both are
 * scored at a discount.
 */
const TITLE_WEIGHT = 1;
const TRAIL_WEIGHT = 0.55;
const KEYWORD_WEIGHT = 0.5;
const HINT_WEIGHT = 0.35;

export interface RankedCommand {
  command: Command;
  score: number;
  /** Ranges into `command.title` only — highlighting anything else misleads. */
  ranges: MatchRange[];
}

/**
 * Score one command, taking the best of its matchable fields.
 *
 * Returns null when nothing matched, which is how the caller filters.
 */
export function scoreCommand(query: string, command: Command): RankedCommand | null {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { command, score: 0, ranges: [] };
  }

  const titleMatch = scoreMatch(trimmed, command.title);
  let score = titleMatch ? titleMatch.score * TITLE_WEIGHT : Number.NEGATIVE_INFINITY;

  const trail = command.trail?.join(" ");
  if (trail) {
    const match = scoreMatch(trimmed, trail);
    if (match) score = Math.max(score, match.score * TRAIL_WEIGHT);
  }

  for (const keyword of command.keywords ?? []) {
    const match = scoreMatch(trimmed, keyword);
    if (match) score = Math.max(score, match.score * KEYWORD_WEIGHT);
  }

  if (command.hint) {
    const match = scoreMatch(trimmed, command.hint);
    if (match) score = Math.max(score, match.score * HINT_WEIGHT);
  }

  /*
   * Multi-word queries are how people reach across a trail: "apex invoices"
   * is a team and a page, and neither half matches the other's field. Each
   * word is scored against the command as a whole and the weakest word sets
   * the result, so every word has to land somewhere.
   */
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    let weakest = Number.POSITIVE_INFINITY;
    for (const word of words) {
      const single = scoreCommand(word, { ...command, keywords: command.keywords });
      if (!single) {
        weakest = Number.NEGATIVE_INFINITY;
        break;
      }
      weakest = Math.min(weakest, single.score);
    }
    if (weakest > Number.NEGATIVE_INFINITY) {
      score = Math.max(score, weakest + words.length);
    }
  }

  if (score === Number.NEGATIVE_INFINITY) return null;
  return { command, score, ranges: titleMatch?.ranges ?? [] };
}

export interface RankOptions {
  /** How many to return in total. The palette is a shortlist, not a page. */
  limit?: number;
  /** Cap per group, so one noisy group cannot crowd out the others. */
  perGroup?: number;
}

/**
 * Rank a command set against a query.
 *
 * With no query this is the resting state of the palette: the given order is
 * preserved, which lets the caller decide what somebody sees before typing
 * (recents, then their contexts) without this file knowing about any of it.
 */
export function rankCommands(
  query: string,
  commands: Command[],
  options: RankOptions = {},
): RankedCommand[] {
  const { limit = 24, perGroup = 6 } = options;
  const trimmed = query.trim();

  const scored: RankedCommand[] = [];
  for (const command of commands) {
    const ranked = scoreCommand(trimmed, command);
    if (ranked) scored.push(ranked);
  }

  if (trimmed.length > 0) {
    /*
     * Sorted by score, then by group order, then by the order they were
     * given. The last tiebreak is what keeps the list from reshuffling
     * between keystrokes when scores happen to be equal — a palette whose
     * rows swap under the cursor is how people press Enter on the wrong one.
     */
    const groupRank = new Map(COMMAND_GROUPS.map((group, index) => [group, index]));
    const originalIndex = new Map(commands.map((command, index) => [command.id, index]));
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const groupDelta =
        (groupRank.get(a.command.group) ?? 0) - (groupRank.get(b.command.group) ?? 0);
      if (groupDelta !== 0) return groupDelta;
      return (
        (originalIndex.get(a.command.id) ?? 0) - (originalIndex.get(b.command.id) ?? 0)
      );
    });
  }

  const kept: RankedCommand[] = [];
  const counts = new Map<CommandGroup, number>();
  for (const ranked of scored) {
    const group = ranked.command.group;
    const count = counts.get(group) ?? 0;
    if (count >= perGroup) continue;
    counts.set(group, count + 1);
    kept.push(ranked);
    if (kept.length >= limit) break;
  }
  return kept;
}

export interface CommandSection {
  group: CommandGroup;
  label: string;
  commands: RankedCommand[];
}

/**
 * Split a ranked list into the blocks the palette draws.
 *
 * Group order is fixed rather than following the scores, because a list whose
 * headings move around is unreadable. Within a group the ranking order holds.
 */
export function sectionsOf(ranked: RankedCommand[]): CommandSection[] {
  const sections: CommandSection[] = [];
  for (const group of COMMAND_GROUPS) {
    const commands = ranked.filter((entry) => entry.command.group === group);
    if (commands.length === 0) continue;
    sections.push({ group, label: GROUP_LABELS[group], commands });
  }
  return sections;
}

/** The flat, keyboard-navigable order — what ↑ and ↓ actually walk. */
export function flatten(sections: CommandSection[]): RankedCommand[] {
  return sections.flatMap((section) => section.commands);
}

/* -------------------------------------------------------------------------
 * Recents
 * ---------------------------------------------------------------------- */

export const RECENTS_KEY = "raceops:palette:recents";
export const RECENTS_LIMIT = 5;

/**
 * Parse whatever is in storage into a list of ids.
 *
 * Total rather than partial: storage is shared with other tabs, other
 * versions of this app and anything else on the origin, so it is treated as
 * untrusted input and anything unexpected becomes an empty list.
 */
export function parseRecents(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, RECENTS_LIMIT);
  } catch {
    return [];
  }
}

/** Most recent first, no duplicates, capped. */
export function pushRecent(recents: string[], id: string): string[] {
  return [id, ...recents.filter((entry) => entry !== id)].slice(0, RECENTS_LIMIT);
}

/**
 * Turn stored ids back into commands.
 *
 * Ids that no longer resolve are dropped silently — a team somebody left, a
 * page that was renamed. Recents are a convenience, and a stale one should
 * disappear rather than become an error or a dead row.
 */
export function recentCommands(recents: string[], commands: Command[]): Command[] {
  const byId = new Map(commands.map((command) => [command.id, command]));
  return recents
    .map((id) => byId.get(id))
    .filter((command): command is Command => Boolean(command))
    .map((command) => ({ ...command, group: "recent" as const }));
}
