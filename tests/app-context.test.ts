import { describe, expect, it } from "vitest";
import {
  activeContext,
  basePathOf,
  CONTEXT_KIND_LABELS,
  groupContexts,
  resolveRoute,
  switchTo,
  TABS_BY_KIND,
  type ContextOption,
} from "@/lib/app-context";
import { EVENT_CONSOLE_TABS, SERIES_CONSOLE_TABS, TEAM_CONSOLE_TABS } from "@/lib/nav";

const APEX: ContextOption = {
  kind: "team",
  key: "apex-racing",
  name: "Apex Racing",
  detail: "Manager",
  canManage: true,
};
const RUST: ContextOption = {
  kind: "team",
  key: "rust-bucket",
  name: "Rust Bucket Racing",
  detail: "Owner",
  canManage: true,
};
const DRIVEN: ContextOption = { ...RUST, key: "driven-only", canManage: false };

describe("resolveRoute", () => {
  it("reads a team out of its console", () => {
    expect(resolveRoute("/teams/apex-racing/manage", "garage")).toEqual({
      kind: "team",
      key: "apex-racing",
      inConsole: true,
      tab: "garage",
      segment: null,
    });
  });

  it("reads a team out of its public page", () => {
    const route = resolveRoute("/teams/apex-racing");
    expect(route.kind).toBe("team");
    expect(route.inConsole).toBe(false);
  });

  it("names the page beside a console", () => {
    expect(resolveRoute("/teams/apex-racing/scan").segment).toBe("scan");
    expect(resolveRoute("/events/evt1/gate").segment).toBe("gate");
  });

  it("treats a bare directory as no context at all", () => {
    /*
     * Browsing is not operating. A switcher claiming "TEAM" while somebody is
     * looking at the list of every team would be lying about where they are.
     */
    for (const path of ["/teams", "/events", "/series", "/organizations", "/"]) {
      expect(resolveRoute(path).kind).toBe("personal");
    }
  });

  it("treats personal pages as personal", () => {
    for (const path of ["/home", "/profile", "/messages", "/opportunities/mine"]) {
      expect(resolveRoute(path).kind).toBe("personal");
    }
  });

  it("ignores a tab outside a console", () => {
    // A ?tab= on a public page belongs to something else on that page, and
    // carrying it into a switch would land somebody on a tab at random.
    expect(resolveRoute("/teams/apex-racing", "garage").tab).toBeNull();
  });

  it("reads an event by its id", () => {
    const route = resolveRoute("/events/clx123abc/manage", "control");
    expect(route.kind).toBe("event");
    expect(route.key).toBe("clx123abc");
    expect(route.tab).toBe("control");
  });

  it("survives a trailing slash and a repeated one", () => {
    expect(resolveRoute("/teams/apex-racing/").key).toBe("apex-racing");
    expect(resolveRoute("//teams//apex-racing").key).toBe("apex-racing");
  });
});

describe("basePathOf", () => {
  it("addresses events by id and everything else by slug", () => {
    expect(basePathOf("team", "apex")).toBe("/teams/apex");
    expect(basePathOf("series", "champcar")).toBe("/series/champcar");
    expect(basePathOf("organization", "a-club")).toBe("/organizations/a-club");
    expect(basePathOf("event", "evt1")).toBe("/events/evt1");
  });
});

describe("switchTo", () => {
  it("keeps your place when the two consoles are the same shape", () => {
    const route = resolveRoute("/teams/apex-racing/manage", "garage");
    expect(switchTo(route, RUST)).toBe("/teams/rust-bucket/manage?tab=garage");
  });

  it("goes to the console front door when the tab does not exist there", () => {
    // "garage" is a team tab; a series console has no such thing.
    const route = resolveRoute("/teams/apex-racing/manage", "garage");
    const series: ContextOption = {
      kind: "series",
      key: "champcar",
      name: "ChampCar",
      detail: "Admin",
      canManage: true,
    };
    expect(switchTo(route, series)).toBe("/series/champcar");
  });

  it("keeps a tab that both consoles happen to share", () => {
    const route = resolveRoute("/teams/apex-racing/manage", "settings");
    expect(switchTo(route, RUST)).toBe("/teams/rust-bucket/manage?tab=settings");
  });

  it("never offers a console to somebody who cannot open one", () => {
    const route = resolveRoute("/teams/apex-racing/manage", "garage");
    expect(switchTo(route, DRIVEN)).toBe("/teams/driven-only");
  });

  it("does not carry a place you were not in", () => {
    const route = resolveRoute("/teams/apex-racing");
    expect(switchTo(route, RUST)).toBe("/teams/rust-bucket");
  });

  it("lands on the console when in one with no tab named", () => {
    const route = resolveRoute("/teams/apex-racing/manage", null);
    expect(switchTo(route, RUST)).toBe("/teams/rust-bucket/manage");
  });

  it("carries every tab of every console it knows about", () => {
    const cases = [
      { kind: "team" as const, key: "t", base: "/teams/t", tabs: TEAM_CONSOLE_TABS },
      { kind: "series" as const, key: "s", base: "/series/s", tabs: SERIES_CONSOLE_TABS },
      { kind: "event" as const, key: "e", base: "/events/e", tabs: EVENT_CONSOLE_TABS },
    ];
    for (const testCase of cases) {
      for (const tab of testCase.tabs) {
        const from = resolveRoute(`${basePathOf(testCase.kind, "source")}/manage`, tab.id);
        const target: ContextOption = {
          kind: testCase.kind,
          key: testCase.key,
          name: "x",
          detail: "y",
          canManage: true,
        };
        expect(switchTo(from, target)).toBe(`${testCase.base}/manage?tab=${tab.id}`);
      }
    }
  });

  it("knows the tabs of every kind that has a console", () => {
    expect(TABS_BY_KIND.team).toBe(TEAM_CONSOLE_TABS);
    expect(TABS_BY_KIND.series).toBe(SERIES_CONSOLE_TABS);
    expect(TABS_BY_KIND.event).toBe(EVENT_CONSOLE_TABS);
    // An organization has a page, not a console. Claiming otherwise would put
    // a ?tab= on a URL that ignores it.
    expect(TABS_BY_KIND.organization).toBeUndefined();
  });
});

describe("activeContext", () => {
  const options = [APEX, RUST];

  it("finds the context you are in", () => {
    expect(activeContext(resolveRoute("/teams/apex-racing/manage"), options)).toBe(APEX);
  });

  it("stays quiet on a team you do not belong to", () => {
    /*
     * Looking at somebody else's team is browsing. Showing a switcher there
     * would suggest you are operating something you are not, and the first
     * thing it offers is a console you cannot open.
     */
    expect(activeContext(resolveRoute("/teams/not-mine"), options)).toBeNull();
  });

  it("stays quiet on a personal page", () => {
    expect(activeContext(resolveRoute("/home"), options)).toBeNull();
  });

  it("does not match a team slug against a series of the same name", () => {
    expect(
      activeContext(resolveRoute("/series/apex-racing"), options),
    ).toBeNull();
  });
});

describe("groupContexts", () => {
  const event = (key: string, live?: boolean): ContextOption => ({
    kind: "event",
    key,
    name: key,
    detail: "",
    canManage: true,
    live,
  });

  it("groups and keeps a fixed order", () => {
    const groups = groupContexts([
      event("e1"),
      APEX,
      { kind: "series", key: "s", name: "S", detail: "", canManage: true },
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Teams",
      "Series and organizations",
      "Race weekends",
    ]);
  });

  it("omits a group with nothing in it", () => {
    expect(groupContexts([APEX]).map((group) => group.label)).toEqual(["Teams"]);
  });

  it("floats a running weekend to the top of its group", () => {
    const groups = groupContexts([event("scheduled"), event("running", true)]);
    expect(groups[0]!.options.map((option) => option.key)).toEqual(["running", "scheduled"]);
  });

  it("puts series and organizations under one heading", () => {
    const groups = groupContexts([
      { kind: "organization", key: "o", name: "O", detail: "", canManage: false },
      { kind: "series", key: "s", name: "S", detail: "", canManage: true },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.options).toHaveLength(2);
  });

  it("has a label for every kind", () => {
    for (const kind of Object.keys(CONTEXT_KIND_LABELS)) {
      expect(CONTEXT_KIND_LABELS[kind as keyof typeof CONTEXT_KIND_LABELS].length).toBeGreaterThan(0);
    }
  });
});
