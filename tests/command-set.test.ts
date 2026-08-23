import { describe, expect, it } from "vitest";
import { buildCommands, EMPTY_CONTEXTS, type PaletteContexts } from "@/lib/command-set";
import { rankCommands } from "@/lib/command-palette";
import {
  ACCOUNT_LINKS,
  ADMIN_LINKS,
  EVENT_CONSOLE_TABS,
  NAV_LINKS,
  TEAM_CONSOLE_TABS,
} from "@/lib/nav";

const APEX = {
  name: "Apex Racing",
  slug: "apex-racing",
  role: "Manager",
  canManage: true,
};

function contexts(overrides: Partial<PaletteContexts> = {}): PaletteContexts {
  return { ...EMPTY_CONTEXTS, ...overrides };
}

describe("buildCommands", () => {
  it("offers the public navigation to somebody in nothing", () => {
    const commands = buildCommands(EMPTY_CONTEXTS);
    for (const link of NAV_LINKS) {
      expect(commands.some((command) => command.href === link.href)).toBe(true);
    }
    for (const link of ACCOUNT_LINKS) {
      expect(commands.some((command) => command.href === link.href)).toBe(true);
    }
  });

  it("hides the staff queue from everybody else", () => {
    const hidden = buildCommands(contexts({ isPlatformStaff: false }));
    const shown = buildCommands(contexts({ isPlatformStaff: true }));
    for (const link of ADMIN_LINKS) {
      expect(hidden.some((command) => command.href === link.href)).toBe(false);
      expect(shown.some((command) => command.href === link.href)).toBe(true);
    }
  });

  it("gives a manager every console tab of their team", () => {
    const commands = buildCommands(contexts({ teams: [APEX] }));
    for (const tab of TEAM_CONSOLE_TABS) {
      expect(
        commands.some(
          (command) => command.href === `/teams/apex-racing/manage?tab=${tab.id}`,
        ),
      ).toBe(true);
    }
  });

  it("offers a non-manager the team, but not its console", () => {
    const commands = buildCommands(
      contexts({ teams: [{ ...APEX, role: "Driver", canManage: false }] }),
    );
    expect(commands.some((command) => command.href === "/teams/apex-racing")).toBe(true);
    expect(commands.some((command) => command.href.includes("/manage"))).toBe(false);
  });

  it("carries the team name as the trail, so two teams stay apart", () => {
    const commands = buildCommands(
      contexts({
        teams: [APEX, { name: "Rust Bucket", slug: "rust-bucket", role: "Owner", canManage: true }],
      }),
    );
    const rosters = commands.filter((command) => command.title === "Roster");
    expect(rosters).toHaveLength(2);
    expect(rosters.map((command) => command.trail?.[0])).toEqual(["Apex Racing", "Rust Bucket"]);
  });

  it("reaches the pages that are not linked from a console", () => {
    /*
     * The gate screen has no link from the event console and the scan station
     * only appears inside the garage tab. Being typeable is the whole reason
     * this shipped, so it is worth asserting rather than assuming.
     */
    const commands = buildCommands(
      contexts({
        teams: [APEX],
        events: [
          {
            id: "evt1",
            name: "Round 3",
            when: "12 Sep 2026",
            seriesName: "ChampCar",
            live: false,
            canManage: true,
          },
        ],
      }),
    );
    expect(commands.some((command) => command.href === "/teams/apex-racing/scan")).toBe(true);
    expect(commands.some((command) => command.href === "/events/evt1/gate")).toBe(true);
  });

  it("gives every command a unique id", () => {
    const commands = buildCommands(
      contexts({
        teams: [APEX],
        series: [{ name: "ChampCar", slug: "champcar", role: "Admin", canManage: true }],
        organizations: [{ name: "A Club", slug: "a-club", role: "Owner" }],
        events: [
          {
            id: "evt1",
            name: "Round 3",
            when: "12 Sep 2026",
            seriesName: "ChampCar",
            live: true,
            canManage: true,
          },
        ],
        isPlatformStaff: true,
      }),
    );
    const ids = commands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every command at a path, never a bare fragment", () => {
    const commands = buildCommands(contexts({ teams: [APEX], isPlatformStaff: true }));
    for (const command of commands) {
      expect(command.href.startsWith("/")).toBe(true);
    }
  });

  it("marks a live event rather than dating it", () => {
    const [live] = buildCommands(
      contexts({
        events: [
          {
            id: "evt1",
            name: "Round 3",
            when: "12 Sep 2026",
            seriesName: null,
            live: true,
            canManage: false,
          },
        ],
      }),
    );
    expect(live!.hint).toBe("Running now");
  });
});

describe("what a real query finds", () => {
  const full = contexts({
    teams: [APEX],
    series: [{ name: "ChampCar Endurance Series", slug: "champcar", role: "Admin", canManage: true }],
    events: [
      {
        id: "evt1",
        name: "Round 3 — Road Atlanta",
        when: "12 Sep 2026",
        seriesName: "ChampCar Endurance Series",
        live: true,
        canManage: true,
      },
    ],
  });
  const commands = buildCommands(full);

  function top(query: string) {
    return rankCommands(query, commands)[0]?.command;
  }

  it("finds the garage from 'invoices', which is not its name", () => {
    const found = rankCommands("invoices", commands);
    expect(found[0]!.command.href).toBe("/teams/apex-racing/manage?tab=garage");
  });

  it("finds payroll under Money", () => {
    expect(top("payroll")?.href).toBe("/teams/apex-racing/manage?tab=money");
  });

  it("finds the scan station from 'barcode'", () => {
    expect(top("barcode")?.href).toBe("/teams/apex-racing/scan");
  });

  it("finds the gate screen by name", () => {
    expect(top("gate")?.href).toBe("/events/evt1/gate");
  });

  it("reaches a team's tab through the team name", () => {
    expect(top("apex roster")?.href).toBe("/teams/apex-racing/manage?tab=roster");
  });

  it("puts the event console tab under the event, not the team", () => {
    const found = rankCommands("entries", commands);
    expect(found[0]!.command.href).toBe("/events/evt1/manage?tab=entries");
  });

  it("returns nothing for a query that means nothing", () => {
    expect(rankCommands("qzqzqz", commands)).toHaveLength(0);
  });

  it("covers every event console tab", () => {
    for (const tab of EVENT_CONSOLE_TABS) {
      const found = rankCommands(tab.label, commands);
      expect(
        found.some((entry) => entry.command.href === `/events/evt1/manage?tab=${tab.id}`),
      ).toBe(true);
    }
  });
});
