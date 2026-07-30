import { ProfileType, RealWorldRole, SimRole } from "@prisma/client";

/**
 * Role tags: the specific jobs someone does, split by sim and real world.
 *
 * `ProfileType` stays the broad category people pick at onboarding ("I'm an
 * engineer"); these tags are the searchable detail underneath it ("data
 * engineer", "tire technician"). Labels and groupings live here so the picker,
 * the profile page and discovery all read the same names.
 */

/** How many tags one profile may carry per domain. */
export const MAX_ROLE_TAGS_PER_DOMAIN = 12;

export const PROFILE_TYPE_LABELS: Record<ProfileType, string> = {
  DRIVER: "Driver",
  CREW: "Crew",
  ENGINEER: "Engineer",
  SPONSOR: "Sponsor",
  TEAM_MANAGER: "Team manager",
  INDUSTRY_PRO: "Industry pro",
};

export const SIM_ROLE_LABELS: Record<SimRole, string> = {
  ENDURANCE_DRIVER: "Endurance driver",
  SPRINT_DRIVER: "Sprint driver",
  OVAL_DRIVER: "Oval driver",
  RALLY_DRIVER: "Rally driver",
  DRIFT_DRIVER: "Drift driver",
  TIME_ATTACK_DRIVER: "Time attack driver",
  RACE_ENGINEER: "Race engineer",
  SETUP_ENGINEER: "Setup engineer",
  STRATEGIST: "Strategist",
  SPOTTER: "Spotter",
  DRIVER_COACH: "Driver coach",
  TEAM_PRINCIPAL: "Team principal",
  LEAGUE_ADMIN: "League admin",
  RACE_CONTROL: "Race control",
  STEWARD: "Steward",
  BROADCASTER: "Broadcaster",
  COMMENTATOR: "Commentator",
  CONTENT_CREATOR: "Content creator",
  LIVERY_ARTIST: "Livery artist",
  GRAPHIC_DESIGNER: "Graphic designer",
  OTHER: "Other",
};

export const REAL_WORLD_ROLE_LABELS: Record<RealWorldRole, string> = {
  DRIVER: "Driver",
  CO_DRIVER: "Co-driver",
  KART_DRIVER: "Kart driver",
  DRIVER_COACH: "Driver coach",
  RACE_ENGINEER: "Race engineer",
  DATA_ENGINEER: "Data engineer",
  PERFORMANCE_ENGINEER: "Performance engineer",
  MECHANIC: "Mechanic",
  CREW_CHIEF: "Crew chief",
  TIRE_TECHNICIAN: "Tire technician",
  FABRICATOR: "Fabricator",
  TRANSPORT_LOGISTICS: "Transport & logistics",
  TEAM_MANAGER: "Team manager",
  TEAM_OWNER: "Team owner",
  STRATEGIST: "Strategist",
  SPOTTER: "Spotter",
  RACE_DIRECTOR: "Race director",
  STEWARD: "Steward",
  MARSHAL: "Marshal",
  SCRUTINEER: "Scrutineer",
  TIMING_OFFICIAL: "Timing official",
  MEDICAL: "Medical",
  SAFETY_CREW: "Safety crew",
  COMMENTATOR: "Commentator",
  PHOTOGRAPHER: "Photographer",
  VIDEOGRAPHER: "Videographer",
  JOURNALIST: "Journalist",
  PR_COMMUNICATIONS: "PR & communications",
  SPONSORSHIP_SALES: "Sponsorship sales",
  HOSPITALITY: "Hospitality",
  OTHER: "Other",
};

export interface RoleGroup<T extends string> {
  label: string;
  roles: T[];
}

/** Picker layout. Every enum member appears in exactly one group. */
export const SIM_ROLE_GROUPS: RoleGroup<SimRole>[] = [
  {
    label: "Driving",
    roles: [
      SimRole.ENDURANCE_DRIVER,
      SimRole.SPRINT_DRIVER,
      SimRole.OVAL_DRIVER,
      SimRole.RALLY_DRIVER,
      SimRole.DRIFT_DRIVER,
      SimRole.TIME_ATTACK_DRIVER,
    ],
  },
  {
    label: "Pit wall",
    roles: [
      SimRole.RACE_ENGINEER,
      SimRole.SETUP_ENGINEER,
      SimRole.STRATEGIST,
      SimRole.SPOTTER,
      SimRole.DRIVER_COACH,
    ],
  },
  {
    label: "Teams & leagues",
    roles: [
      SimRole.TEAM_PRINCIPAL,
      SimRole.LEAGUE_ADMIN,
      SimRole.RACE_CONTROL,
      SimRole.STEWARD,
    ],
  },
  {
    label: "Media & creative",
    roles: [
      SimRole.BROADCASTER,
      SimRole.COMMENTATOR,
      SimRole.CONTENT_CREATOR,
      SimRole.LIVERY_ARTIST,
      SimRole.GRAPHIC_DESIGNER,
      SimRole.OTHER,
    ],
  },
];

export const REAL_WORLD_ROLE_GROUPS: RoleGroup<RealWorldRole>[] = [
  {
    label: "Driving",
    roles: [
      RealWorldRole.DRIVER,
      RealWorldRole.CO_DRIVER,
      RealWorldRole.KART_DRIVER,
      RealWorldRole.DRIVER_COACH,
    ],
  },
  {
    label: "Engineering",
    roles: [
      RealWorldRole.RACE_ENGINEER,
      RealWorldRole.DATA_ENGINEER,
      RealWorldRole.PERFORMANCE_ENGINEER,
    ],
  },
  {
    label: "Crew",
    roles: [
      RealWorldRole.MECHANIC,
      RealWorldRole.CREW_CHIEF,
      RealWorldRole.TIRE_TECHNICIAN,
      RealWorldRole.FABRICATOR,
      RealWorldRole.TRANSPORT_LOGISTICS,
    ],
  },
  {
    label: "Pit wall & management",
    roles: [
      RealWorldRole.TEAM_MANAGER,
      RealWorldRole.TEAM_OWNER,
      RealWorldRole.STRATEGIST,
      RealWorldRole.SPOTTER,
    ],
  },
  {
    label: "Officials & trackside",
    roles: [
      RealWorldRole.RACE_DIRECTOR,
      RealWorldRole.STEWARD,
      RealWorldRole.MARSHAL,
      RealWorldRole.SCRUTINEER,
      RealWorldRole.TIMING_OFFICIAL,
      RealWorldRole.MEDICAL,
      RealWorldRole.SAFETY_CREW,
    ],
  },
  {
    label: "Media",
    roles: [
      RealWorldRole.COMMENTATOR,
      RealWorldRole.PHOTOGRAPHER,
      RealWorldRole.VIDEOGRAPHER,
      RealWorldRole.JOURNALIST,
    ],
  },
  {
    label: "Commercial",
    roles: [
      RealWorldRole.PR_COMMUNICATIONS,
      RealWorldRole.SPONSORSHIP_SALES,
      RealWorldRole.HOSPITALITY,
      RealWorldRole.OTHER,
    ],
  },
];

/** A tag ready to render: which domain it came from and what to call it. */
export interface RoleTag {
  domain: "sim" | "real";
  value: string;
  label: string;
}

/**
 * Flattens a profile's tags into one display list, sim first. Tags are
 * returned in the picker's group order rather than however they were stored,
 * so two profiles with the same roles always read the same way.
 */
export function roleTagsOf(profile: {
  simRoles?: SimRole[] | null;
  realWorldRoles?: RealWorldRole[] | null;
}): RoleTag[] {
  const sim = orderedByGroups(profile.simRoles ?? [], SIM_ROLE_GROUPS).map(
    (role) => ({
      domain: "sim" as const,
      value: role,
      label: SIM_ROLE_LABELS[role],
    }),
  );
  const real = orderedByGroups(
    profile.realWorldRoles ?? [],
    REAL_WORLD_ROLE_GROUPS,
  ).map((role) => ({
    domain: "real" as const,
    value: role,
    label: REAL_WORLD_ROLE_LABELS[role],
  }));
  return [...sim, ...real];
}

/** De-duplicates and sorts a selection into the canonical group order. */
export function orderedByGroups<T extends string>(
  selected: T[],
  groups: RoleGroup<T>[],
): T[] {
  const chosen = new Set(selected);
  const ordered: T[] = [];
  for (const group of groups) {
    for (const role of group.roles) {
      if (chosen.has(role)) ordered.push(role);
    }
  }
  return ordered;
}

/**
 * Toggles one tag in a selection, capped at `MAX_ROLE_TAGS_PER_DOMAIN`.
 * Returns the input unchanged when the cap would be exceeded, so the caller
 * can tell nothing happened.
 */
export function toggleRole<T extends string>(selected: T[], role: T): T[] {
  if (selected.includes(role)) {
    return selected.filter((value) => value !== role);
  }
  if (selected.length >= MAX_ROLE_TAGS_PER_DOMAIN) return selected;
  return [...selected, role];
}
