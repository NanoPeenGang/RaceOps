import { describe, expect, it } from "vitest";
import { ProfileType, RealWorldRole, SimRole } from "@prisma/client";
import {
  MAX_ROLE_TAGS_PER_DOMAIN,
  PROFILE_TYPE_LABELS,
  REAL_WORLD_ROLE_GROUPS,
  REAL_WORLD_ROLE_LABELS,
  SIM_ROLE_GROUPS,
  SIM_ROLE_LABELS,
  orderedByGroups,
  roleTagsOf,
  toggleRole,
  type RoleGroup,
} from "@/lib/roles";

/**
 * These first two blocks are the ones that matter over time: adding an enum
 * member without a label would render "undefined" on every profile, and
 * leaving it out of a group would make it unpickable. Both fail here instead.
 */
describe("label coverage", () => {
  it("labels every profile type", () => {
    for (const type of Object.values(ProfileType)) {
      expect(PROFILE_TYPE_LABELS[type], type).toBeTruthy();
    }
  });

  it("labels every sim role", () => {
    for (const role of Object.values(SimRole)) {
      expect(SIM_ROLE_LABELS[role], role).toBeTruthy();
    }
  });

  it("labels every real-world role", () => {
    for (const role of Object.values(RealWorldRole)) {
      expect(REAL_WORLD_ROLE_LABELS[role], role).toBeTruthy();
    }
  });
});

describe("group coverage", () => {
  function flatten<T extends string>(groups: RoleGroup<T>[]): T[] {
    return groups.flatMap((group) => group.roles);
  }

  it("puts every sim role in exactly one group", () => {
    const flat = flatten(SIM_ROLE_GROUPS);
    expect(new Set(flat).size).toBe(flat.length);
    expect([...flat].sort()).toEqual(Object.values(SimRole).sort());
  });

  it("puts every real-world role in exactly one group", () => {
    const flat = flatten(REAL_WORLD_ROLE_GROUPS);
    expect(new Set(flat).size).toBe(flat.length);
    expect([...flat].sort()).toEqual(Object.values(RealWorldRole).sort());
  });

  it("names every group", () => {
    for (const group of [...SIM_ROLE_GROUPS, ...REAL_WORLD_ROLE_GROUPS]) {
      expect(group.label).toBeTruthy();
      expect(group.roles.length).toBeGreaterThan(0);
    }
  });
});

describe("orderedByGroups", () => {
  it("sorts a selection into canonical group order", () => {
    // Clicked in a scattered order; stored in picker order.
    const ordered = orderedByGroups(
      [SimRole.COMMENTATOR, SimRole.SPRINT_DRIVER, SimRole.STRATEGIST],
      SIM_ROLE_GROUPS,
    );
    expect(ordered).toEqual([
      SimRole.SPRINT_DRIVER,
      SimRole.STRATEGIST,
      SimRole.COMMENTATOR,
    ]);
  });

  it("de-duplicates", () => {
    expect(
      orderedByGroups(
        [SimRole.SPOTTER, SimRole.SPOTTER, SimRole.SPOTTER],
        SIM_ROLE_GROUPS,
      ),
    ).toEqual([SimRole.SPOTTER]);
  });

  it("drops nothing and adds nothing for an empty selection", () => {
    expect(orderedByGroups([], SIM_ROLE_GROUPS)).toEqual([]);
  });
});

describe("toggleRole", () => {
  it("adds a role that is not selected", () => {
    expect(toggleRole([SimRole.SPOTTER], SimRole.STRATEGIST)).toEqual([
      SimRole.SPOTTER,
      SimRole.STRATEGIST,
    ]);
  });

  it("removes a role that is selected", () => {
    expect(
      toggleRole([SimRole.SPOTTER, SimRole.STRATEGIST], SimRole.SPOTTER),
    ).toEqual([SimRole.STRATEGIST]);
  });

  it("refuses to exceed the cap but still allows removal", () => {
    const full = Object.values(SimRole).slice(0, MAX_ROLE_TAGS_PER_DOMAIN);
    const beyond = Object.values(SimRole)[MAX_ROLE_TAGS_PER_DOMAIN];

    // Adding past the cap is a no-op, so the caller can tell nothing changed.
    expect(toggleRole(full, beyond)).toBe(full);
    expect(toggleRole(full, full[0])).toHaveLength(
      MAX_ROLE_TAGS_PER_DOMAIN - 1,
    );
  });

  it("does not mutate the input", () => {
    const selected = [SimRole.SPOTTER];
    toggleRole(selected, SimRole.STRATEGIST);
    expect(selected).toEqual([SimRole.SPOTTER]);
  });
});

describe("roleTagsOf", () => {
  it("returns sim tags before real-world tags, each in group order", () => {
    const tags = roleTagsOf({
      simRoles: [SimRole.COMMENTATOR, SimRole.OVAL_DRIVER],
      realWorldRoles: [RealWorldRole.MARSHAL, RealWorldRole.DRIVER],
    });
    expect(tags.map((tag) => tag.domain)).toEqual([
      "sim",
      "sim",
      "real",
      "real",
    ]);
    expect(tags.map((tag) => tag.label)).toEqual([
      "Oval driver",
      "Commentator",
      "Driver",
      "Marshal",
    ]);
  });

  it("keeps same-named roles in the two domains distinct", () => {
    // STRATEGIST exists in both enums; the domain is what tells them apart.
    const tags = roleTagsOf({
      simRoles: [SimRole.STRATEGIST],
      realWorldRoles: [RealWorldRole.STRATEGIST],
    });
    expect(tags).toHaveLength(2);
    expect(tags.map((tag) => tag.domain)).toEqual(["sim", "real"]);
  });

  it("handles missing and null arrays", () => {
    expect(roleTagsOf({})).toEqual([]);
    expect(roleTagsOf({ simRoles: null, realWorldRoles: null })).toEqual([]);
  });
});
