import { OrgRole, Permission, SeriesRole } from "@prisma/client";

/**
 * Capabilities: what someone is allowed to do, and who holds it.
 *
 * The platform ships five built-in series roles because most championships
 * want exactly those. Clubs that want their own — "Chief Scrutineer",
 * "Assistant Clerk", "Media Officer" — define custom roles as bundles of
 * permissions instead.
 *
 * Every call site names the single permission it needs. Permissions are never
 * derived from "this role can do everything an admin can": that derivation is
 * exactly how a narrow custom role quietly gains admin powers, because the
 * union of an admin's permissions contains every other role's as well.
 */

export const PERMISSION_LABELS: Record<Permission, string> = {
  ORG_MANAGE: "Manage the organization",
  ORG_STAFF_MANAGE: "Manage staff and roles",
  SERIES_MANAGE: "Manage series settings",
  EVENT_MANAGE: "Run events",
  PENALTY_ISSUE: "Issue penalties",
  APPEAL_DECIDE: "Decide appeals",
  VOLUNTEER_MANAGE: "Manage volunteers",
  AUDIT_READ: "Read the audit trail",
};

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  ORG_MANAGE:
    "Change the organization's name, branding and settings, and delete it.",
  ORG_STAFF_MANAGE:
    "Add people to the organization, create roles and assign them.",
  SERIES_MANAGE:
    "Change series settings, classes, championship rules and branding.",
  EVENT_MANAGE:
    "Create and publish events, run the schedule and timing, decide entries, and work the technical bay.",
  PENALTY_ISSUE:
    "Work the stewards' queue and issue penalties against entries.",
  APPEAL_DECIDE:
    "Rule on appeals against penalties. Deliberately separate from issuing them, so the officials who issue are not the panel of appeal.",
  VOLUNTEER_MANAGE: "Create volunteer shifts and decide who works them.",
  AUDIT_READ:
    "Read the record of who changed what. Kept separate because the people whose decisions may be disputed should not control the view of it.",
};

/** Grouping for the role editor, so a long list is scannable. */
export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] =
  [
    {
      label: "Organization",
      permissions: [Permission.ORG_MANAGE, Permission.ORG_STAFF_MANAGE],
    },
    {
      label: "Championship",
      permissions: [Permission.SERIES_MANAGE, Permission.EVENT_MANAGE],
    },
    {
      label: "Officials",
      permissions: [
        Permission.PENALTY_ISSUE,
        Permission.APPEAL_DECIDE,
        Permission.VOLUNTEER_MANAGE,
      ],
    },
    { label: "Oversight", permissions: [Permission.AUDIT_READ] },
  ];

/**
 * A capability: the built-in roles that hold it, and the permission a custom
 * role must carry to hold it too.
 *
 * Pairing them keeps the two systems honest. Adding a capability means
 * deciding both questions at once, rather than shipping a permission nothing
 * checks or a check no permission satisfies.
 */
export interface Capability {
  readonly roles: readonly SeriesRole[];
  readonly permission: Permission;
}

/** Change series settings, classes and branding. */
export const SERIES_ADMIN_ROLES: Capability = {
  roles: [SeriesRole.OWNER, SeriesRole.ADMIN],
  permission: Permission.SERIES_MANAGE,
};

/** Run events: create and publish, schedule, time, and decide entries. */
export const SERIES_EVENT_ROLES: Capability = {
  roles: [SeriesRole.OWNER, SeriesRole.ADMIN, SeriesRole.RACE_CONTROL],
  permission: Permission.EVENT_MANAGE,
};

/** Manage volunteer shifts and signups. */
export const SERIES_VOLUNTEER_ROLES: Capability = {
  roles: [
    SeriesRole.OWNER,
    SeriesRole.ADMIN,
    SeriesRole.VOLUNTEER_COORDINATOR,
  ],
  permission: Permission.VOLUNTEER_MANAGE,
};

/** Issue penalties — race control and stewards. */
export const SERIES_PENALTY_ROLES: Capability = {
  roles: [
    SeriesRole.OWNER,
    SeriesRole.ADMIN,
    SeriesRole.RACE_CONTROL,
    SeriesRole.STEWARD,
  ],
  permission: Permission.PENALTY_ISSUE,
};

/**
 * Rule on appeals. Race control is deliberately excluded so the officials who
 * issue penalties are not the panel of appeal.
 */
export const SERIES_APPEAL_ROLES: Capability = {
  roles: [SeriesRole.OWNER, SeriesRole.ADMIN, SeriesRole.STEWARD],
  permission: Permission.APPEAL_DECIDE,
};

/** Read the audit trail. Owner/admin only, for the reason above. */
export const SERIES_AUDIT_ROLES: Capability = {
  roles: [SeriesRole.OWNER, SeriesRole.ADMIN],
  permission: Permission.AUDIT_READ,
};

/** Everything a built-in series role can do, for the staff list and the UI. */
export const SERIES_ROLE_PERMISSIONS: Record<SeriesRole, Permission[]> = {
  OWNER: [
    Permission.SERIES_MANAGE,
    Permission.EVENT_MANAGE,
    Permission.PENALTY_ISSUE,
    Permission.APPEAL_DECIDE,
    Permission.VOLUNTEER_MANAGE,
    Permission.AUDIT_READ,
  ],
  ADMIN: [
    Permission.SERIES_MANAGE,
    Permission.EVENT_MANAGE,
    Permission.PENALTY_ISSUE,
    Permission.APPEAL_DECIDE,
    Permission.VOLUNTEER_MANAGE,
    Permission.AUDIT_READ,
  ],
  RACE_CONTROL: [Permission.EVENT_MANAGE, Permission.PENALTY_ISSUE],
  STEWARD: [Permission.PENALTY_ISSUE, Permission.APPEAL_DECIDE],
  VOLUNTEER_COORDINATOR: [Permission.VOLUNTEER_MANAGE],
};

/** Everything a built-in organization role can do. */
export const ORG_ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  OWNER: Object.values(Permission),
  ADMIN: [
    Permission.ORG_MANAGE,
    Permission.ORG_STAFF_MANAGE,
    Permission.SERIES_MANAGE,
    Permission.EVENT_MANAGE,
    Permission.PENALTY_ISSUE,
    Permission.APPEAL_DECIDE,
    Permission.VOLUNTEER_MANAGE,
    Permission.AUDIT_READ,
  ],
  // Holds nothing on its own. Belonging to an organization is not itself a
  // permission — everything a staff member can do comes from a named role,
  // which is what makes the staff list readable.
  STAFF: [],
};

export const SERIES_ROLE_LABELS: Record<SeriesRole, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  RACE_CONTROL: "Race control",
  STEWARD: "Steward",
  VOLUNTEER_COORDINATOR: "Volunteer coordinator",
};

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  STAFF: "Staff",
};

/**
 * Whether a set of held permissions satisfies a capability.
 *
 * Membership role and custom roles are checked separately and either is
 * enough: a series owner does not need a custom role, and someone with only a
 * custom "Chief Scrutineer" role does not need to be made an admin.
 */
export function satisfies(
  capability: Capability,
  held: {
    seriesRole?: SeriesRole | null;
    permissions?: readonly Permission[];
  },
): boolean {
  if (held.seriesRole && capability.roles.includes(held.seriesRole)) {
    return true;
  }
  return Boolean(held.permissions?.includes(capability.permission));
}

/**
 * Suggested roles a new organization starts with.
 *
 * Presets rather than a blank page: an organization that has to invent its own
 * permission model before it can add its first scrutineer will not add one.
 * Every one is editable and deletable — these are a starting point, not a
 * second fixed list.
 */
export const STARTER_ROLES: {
  name: string;
  description: string;
  permissions: Permission[];
  color: string;
}[] = [
  {
    name: "Clerk of the Course",
    description: "Runs the meeting: schedule, sessions, entries and timing.",
    permissions: [Permission.EVENT_MANAGE, Permission.PENALTY_ISSUE],
    color: "#D91E1E",
  },
  {
    name: "Chief Scrutineer",
    description: "Runs the technical bay and refers cars to the stewards.",
    permissions: [Permission.EVENT_MANAGE],
    color: "#1E5FD9",
  },
  {
    name: "Steward",
    description: "Hears incidents and rules on appeals.",
    permissions: [Permission.PENALTY_ISSUE, Permission.APPEAL_DECIDE],
    color: "#7A1ED9",
  },
  {
    name: "Volunteer Coordinator",
    description: "Staffs marshal posts and the rest of the volunteer roster.",
    permissions: [Permission.VOLUNTEER_MANAGE],
    color: "#0F9D58",
  },
  {
    name: "Media Officer",
    description:
      "Publishes notices and media. Holds no operational permissions.",
    permissions: [],
    color: "#F4A100",
  },
];
