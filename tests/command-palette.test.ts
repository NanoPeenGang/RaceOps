import { describe, expect, it } from "vitest";
import {
  COMMAND_GROUPS,
  flatten,
  isSubsequence,
  parseRecents,
  pushRecent,
  rankCommands,
  recentCommands,
  RECENTS_LIMIT,
  scoreCommand,
  scoreMatch,
  sectionsOf,
  type Command,
} from "@/lib/command-palette";

function command(partial: Partial<Command> & { id: string; title: string }): Command {
  return { href: `/${partial.id}`, group: "page", ...partial };
}

describe("scoreMatch", () => {
  it("matches a subsequence and reports where", () => {
    const match = scoreMatch("inv", "Invoices");
    expect(match).not.toBeNull();
    expect(match!.ranges).toEqual([[0, 3]]);
  });

  it("returns null when a character is missing", () => {
    expect(scoreMatch("invz", "Invoices")).toBeNull();
  });

  it("is case insensitive but reports ranges into the original", () => {
    const match = scoreMatch("RACE", "Race control");
    expect(match!.ranges).toEqual([[0, 4]]);
  });

  it("scores an exact title above a merely-containing one", () => {
    const exact = scoreMatch("garage", "Garage")!.score;
    const contained = scoreMatch("garage", "The garage and workshop")!.score;
    expect(exact).toBeGreaterThan(contained);
  });

  it("prefers a word start over a match buried mid-word", () => {
    const start = scoreMatch("pen", "Penalties")!.score;
    const buried = scoreMatch("pen", "Suspenders")!.score;
    expect(start).toBeGreaterThan(buried);
  });

  it("prefers contiguous characters over scattered ones", () => {
    const contiguous = scoreMatch("scan", "Scanner")!.score;
    const scattered = scoreMatch("scan", "Supplementary check and notes")!.score;
    expect(contiguous).toBeGreaterThan(scattered);
  });

  it("finds the alignment a greedy walk would miss", () => {
    /*
     * Greedy takes the first 's' and then any later 'c', which in this string
     * lands mid-word and scores badly. The right answer is the "S" and "c" of
     * "Scan", and it is only reachable by looking past the first candidate.
     */
    const match = scoreMatch("sc", "Services and Scan");
    expect(match!.ranges).toEqual([[13, 15]]);
  });

  it("treats an empty query as a match with no highlight", () => {
    expect(scoreMatch("", "Anything")).toEqual({ score: 0, ranges: [] });
  });

  it("splits highlight ranges when the match is not contiguous", () => {
    const match = scoreMatch("rc", "Race control");
    expect(match!.ranges).toEqual([
      [0, 1],
      [5, 6],
    ]);
  });
});

describe("isSubsequence", () => {
  it("accepts an in-order subset", () => {
    expect(isSubsequence("rc", "race control")).toBe(true);
  });

  it("rejects an out-of-order one", () => {
    expect(isSubsequence("cr", "race")).toBe(false);
  });

  it("rejects a query longer than the text", () => {
    expect(isSubsequence("racecontrol", "race")).toBe(false);
  });
});

describe("scoreCommand", () => {
  const invoices = command({
    id: "team:apex:tab:garage",
    title: "Garage",
    trail: ["Apex Racing"],
    keywords: ["invoices", "inventory"],
  });

  it("matches on a keyword that is never shown", () => {
    const ranked = scoreCommand("invoices", invoices);
    expect(ranked).not.toBeNull();
    // Nothing in the title matched, so nothing should be highlighted.
    expect(ranked!.ranges).toEqual([]);
  });

  it("ranks a title hit above the same word as a keyword", () => {
    const byTitle = scoreCommand("inventory", command({ id: "a", title: "Inventory" }))!;
    const byKeyword = scoreCommand("inventory", invoices)!;
    expect(byTitle.score).toBeGreaterThan(byKeyword.score);
  });

  it("matches across the trail and the title together", () => {
    expect(scoreCommand("apex garage", invoices)).not.toBeNull();
  });

  it("rejects a multi-word query when one word lands nowhere", () => {
    expect(scoreCommand("apex zzzz", invoices)).toBeNull();
  });

  it("returns everything for an empty query", () => {
    expect(scoreCommand("   ", invoices)).not.toBeNull();
  });
});

describe("rankCommands", () => {
  const commands: Command[] = [
    command({ id: "nav", title: "Teams" }),
    command({ id: "ctx", title: "Apex Racing", group: "context" }),
    command({ id: "tab", title: "Roster", trail: ["Apex Racing"] }),
    command({ id: "other", title: "Tracks" }),
  ];

  it("keeps the given order when there is no query", () => {
    const ranked = rankCommands("", commands);
    expect(ranked.map((entry) => entry.command.id)).toEqual(["nav", "ctx", "tab", "other"]);
  });

  it("puts the best match first", () => {
    const ranked = rankCommands("apex", commands);
    expect(ranked[0]!.command.id).toBe("ctx");
  });

  it("drops what cannot match", () => {
    const ranked = rankCommands("apex", commands);
    expect(ranked.some((entry) => entry.command.id === "other")).toBe(false);
  });

  it("caps each group so one cannot crowd out the rest", () => {
    const many = Array.from({ length: 10 }, (_, index) =>
      command({ id: `page-${index}`, title: `Roster ${index}` }),
    );
    const ranked = rankCommands("roster", [...many, command({ id: "act", title: "Roster action", group: "action" })], {
      perGroup: 3,
    });
    expect(ranked.filter((entry) => entry.command.group === "page")).toHaveLength(3);
    expect(ranked.some((entry) => entry.command.group === "action")).toBe(true);
  });

  it("honours the overall limit", () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      command({ id: `page-${index}`, title: `Roster ${index}` }),
    );
    expect(rankCommands("roster", many, { limit: 5, perGroup: 99 })).toHaveLength(5);
  });

  it("is stable between keystrokes when scores tie", () => {
    /*
     * The reason this matters: a row that moves between renders is a row
     * somebody presses Enter on by accident. Two identical titles must keep
     * the order they were given rather than swapping on re-sort.
     */
    const tied = [
      command({ id: "first", title: "Settings" }),
      command({ id: "second", title: "Settings" }),
    ];
    for (let run = 0; run < 5; run += 1) {
      expect(rankCommands("settings", tied).map((entry) => entry.command.id)).toEqual([
        "first",
        "second",
      ]);
    }
  });
});

describe("sectionsOf", () => {
  it("orders groups the same way every time, whatever the scores", () => {
    const ranked = rankCommands("a", [
      command({ id: "r", title: "aaa", group: "result" }),
      command({ id: "c", title: "aaa", group: "context" }),
      command({ id: "p", title: "aaa", group: "page" }),
    ]);
    expect(sectionsOf(ranked).map((section) => section.group)).toEqual([
      "context",
      "page",
      "result",
    ]);
  });

  it("omits groups with nothing in them", () => {
    const ranked = rankCommands("", [command({ id: "p", title: "Only a page" })]);
    expect(sectionsOf(ranked)).toHaveLength(1);
  });

  it("flattens back to the keyboard order", () => {
    const ranked = rankCommands("", [
      command({ id: "p", title: "Page" }),
      command({ id: "c", title: "Context", group: "context" }),
    ]);
    const flat = flatten(sectionsOf(ranked));
    expect(flat.map((entry) => entry.command.id)).toEqual(["c", "p"]);
  });

  it("has a label for every group", () => {
    for (const group of COMMAND_GROUPS) {
      const ranked = rankCommands("", [command({ id: group, title: "x", group })]);
      expect(sectionsOf(ranked)[0]!.label.length).toBeGreaterThan(0);
    }
  });
});

describe("recents", () => {
  it("reads a stored list", () => {
    expect(parseRecents(JSON.stringify(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("treats anything unexpected as empty rather than throwing", () => {
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents("not json")).toEqual([]);
    expect(parseRecents(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseRecents(JSON.stringify(["ok", 42, null]))).toEqual(["ok"]);
  });

  it("moves a repeat to the front instead of duplicating it", () => {
    expect(pushRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("caps the list", () => {
    let recents: string[] = [];
    for (let index = 0; index < 20; index += 1) recents = pushRecent(recents, `id-${index}`);
    expect(recents).toHaveLength(RECENTS_LIMIT);
    expect(recents[0]).toBe("id-19");
  });

  it("drops ids that no longer resolve", () => {
    const resolved = recentCommands(
      ["gone", "here"],
      [command({ id: "here", title: "Still here" })],
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.group).toBe("recent");
  });
});
