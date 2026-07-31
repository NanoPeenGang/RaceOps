import { describe, expect, it } from "vitest";
import { OrgRole, Permission, SeriesRole } from "@prisma/client";
import {
  ORG_ROLE_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  satisfies,
  SERIES_ADMIN_ROLES,
  SERIES_APPEAL_ROLES,
  SERIES_EVENT_ROLES,
  SERIES_PENALTY_ROLES,
  SERIES_ROLE_PERMISSIONS,
  SERIES_VOLUNTEER_ROLES,
  STARTER_ROLES,
} from "@/lib/permissions";

describe("satisfies", () => {
  it("passes on a built-in role that holds the capability", () => {
    expect(
      satisfies(SERIES_EVENT_ROLES, { seriesRole: SeriesRole.RACE_CONTROL }),
    ).toBe(true);
  });

  it("passes on a custom role carrying the permission", () => {
    expect(
      satisfies(SERIES_EVENT_ROLES, {
        seriesRole: null,
        permissions: [Permission.EVENT_MANAGE],
      }),
    ).toBe(true);
  });

  it("refuses a role that holds neither", () => {
    expect(
      satisfies(SERIES_ADMIN_ROLES, {
        seriesRole: SeriesRole.STEWARD,
        permissions: [Permission.PENALTY_ISSUE],
      }),
    ).toBe(false);
  });

  it("does not let one permission stand in for another", () => {
    // The escalation this design exists to prevent: a narrow custom role must
    // not inherit everything an admin can do just because admins can do it.
    expect(
      satisfies(SERIES_ADMIN_ROLES, {
        seriesRole: null,
        permissions: [Permission.VOLUNTEER_MANAGE, Permission.PENALTY_ISSUE],
      }),
    ).toBe(false);
  });

  it("treats an absent permission list as holding nothing", () => {
    expect(satisfies(SERIES_EVENT_ROLES, { seriesRole: null })).toBe(false);
    expect(satisfies(SERIES_EVENT_ROLES, {})).toBe(false);
  });
});

describe("capability definitions", () => {
  it("keeps race control out of the appeals panel", () => {
    // The officials who issue penalties must not be the panel of appeal.
    expect(SERIES_APPEAL_ROLES.roles).not.toContain(SeriesRole.RACE_CONTROL);
    expect(SERIES_PENALTY_ROLES.roles).toContain(SeriesRole.RACE_CONTROL);
  });

  it("gives every capability its own permission", () => {
    const permissions = [
      SERIES_ADMIN_ROLES,
      SERIES_EVENT_ROLES,
      SERIES_PENALTY_ROLES,
      SERIES_APPEAL_ROLES,
      SERIES_VOLUNTEER_ROLES,
    ].map((capability) => capability.permission);
    expect(new Set(permissions).size).toBe(permissions.length);
  });

  it("agrees with the role-to-permission table in both directions", () => {
    // A role listed as holding a capability must carry its permission, or the
    // staff list would show one thing and the checks do another.
    for (const capability of [
      SERIES_ADMIN_ROLES,
      SERIES_EVENT_ROLES,
      SERIES_PENALTY_ROLES,
      SERIES_APPEAL_ROLES,
      SERIES_VOLUNTEER_ROLES,
    ]) {
      for (const role of capability.roles) {
        expect(SERIES_ROLE_PERMISSIONS[role]).toContain(capability.permission);
      }
      for (const role of Object.values(SeriesRole)) {
        if (capability.roles.includes(role)) continue;
        expect(SERIES_ROLE_PERMISSIONS[role]).not.toContain(
          capability.permission,
        );
      }
    }
  });
});

describe("organization roles", () => {
  it("gives plain staff nothing on its own", () => {
    // Belonging to an organization is not a permission; everything comes from
    // a named role, which is what makes a staff list readable.
    expect(ORG_ROLE_PERMISSIONS[OrgRole.STAFF]).toEqual([]);
  });

  it("gives an owner everything", () => {
    expect(ORG_ROLE_PERMISSIONS[OrgRole.OWNER].sort()).toEqual(
      Object.values(Permission).sort(),
    );
  });
});

describe("permission catalogue", () => {
  it("labels every permission", () => {
    for (const permission of Object.values(Permission)) {
      expect(PERMISSION_LABELS[permission]).toBeTruthy();
    }
  });

  it("puts every permission in exactly one group", () => {
    const grouped = PERMISSION_GROUPS.flatMap((group) => group.permissions);
    expect(grouped.sort()).toEqual(Object.values(Permission).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});

describe("starter roles", () => {
  it("offers something to edit rather than a blank page", () => {
    expect(STARTER_ROLES.length).toBeGreaterThan(3);
  });

  it("never hands out organization administration by default", () => {
    // A preset that quietly grants staff management would defeat the point of
    // having roles at all.
    for (const role of STARTER_ROLES) {
      expect(role.permissions).not.toContain(Permission.ORG_MANAGE);
      expect(role.permissions).not.toContain(Permission.ORG_STAFF_MANAGE);
    }
  });

  it("allows a role that grants nothing, for a title with no powers", () => {
    expect(STARTER_ROLES.some((role) => role.permissions.length === 0)).toBe(
      true,
    );
  });
});
