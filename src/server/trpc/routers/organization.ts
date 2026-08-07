import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  AccessRequestKind,
  AuditAction,
  OrgRole,
  Permission,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "@/server/trpc/trpc";
import { slugify } from "@/lib/slug";
import { ORG_ROLE_PERMISSIONS, STARTER_ROLES } from "@/lib/permissions";
import { recordAudit } from "@/server/services/audit";
import {
  findSpendableApproval,
  spendApproval,
} from "@/server/services/platform-admin";

/**
 * Organizations and their staff.
 *
 * Entirely optional. A one-person league never has to create one, and series
 * and teams work standalone exactly as before. An organization is what you
 * reach for when several people share the work, or when one body runs several
 * series and wants one staff list and one look across them.
 */

/** Everything the caller holds in one organization. */
async function orgPermissions(
  db: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<{ role: OrgRole | null; permissions: Permission[] }> {
  const [membership, assignments] = await Promise.all([
    db.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    }),
    db.staffAssignment.findMany({
      where: { userId, staffRole: { organizationId } },
      select: { staffRole: { select: { permissions: true } } },
    }),
  ]);

  const permissions = new Set<Permission>();
  if (membership) {
    for (const permission of ORG_ROLE_PERMISSIONS[membership.role]) {
      permissions.add(permission);
    }
  }
  for (const assignment of assignments) {
    for (const permission of assignment.staffRole.permissions) {
      permissions.add(permission);
    }
  }
  return { role: membership?.role ?? null, permissions: [...permissions] };
}

async function assertOrgPermission(
  db: PrismaClient,
  organizationId: string,
  userId: string,
  permission: Permission,
): Promise<void> {
  const { permissions } = await orgPermissions(db, organizationId, userId);
  if (!permissions.includes(permission)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have permission to do that in this organization.",
    });
  }
}

/**
 * Ownership acts — deleting the organization, minting another owner, removing
 * an owner. Checks the built-in OWNER role and nothing else, for the same
 * reason series ownership does: a permission that can delete the thing that
 * grants permissions is a way around ownership, not a capability.
 */
async function assertOrgOwner(
  db: PrismaClient,
  organizationId: string,
  userId: string,
): Promise<void> {
  const membership = await db.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
  if (membership?.role !== OrgRole.OWNER) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Only an owner can do that. Ownership cannot be delegated to a staff role.",
    });
  }
}

async function uniqueOrgSlug(db: PrismaClient, name: string): Promise<string> {
  const base = slugify(name) || "organization";
  let candidate = base;
  for (let suffix = 2; suffix < 50; suffix += 1) {
    const clash = await db.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
    candidate = `${base}-${suffix}`;
  }
  throw new TRPCError({
    code: "CONFLICT",
    message: "Too many organizations share that name.",
  });
}

export const organizationRouter = createTRPCRouter({
  /** Organizations the caller belongs to, for the switcher. */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db.organizationMembership.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: "asc" },
      include: {
        organization: {
          include: {
            branding: true,
            _count: { select: { series: true, teams: true, members: true } },
          },
        },
      },
    });
    return memberships.map((membership) => ({
      ...membership.organization,
      myRole: membership.role,
      myTitle: membership.title,
    }));
  }),

  bySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(120) }))
    .query(async ({ ctx, input }) => {
      const organization = await ctx.db.organization.findUnique({
        where: { slug: input.slug },
        include: {
          branding: true,
          series: {
            orderBy: { name: "asc" },
            include: {
              branding: true,
              _count: { select: { events: true } },
            },
          },
          teams: {
            orderBy: { name: "asc" },
            include: { branding: true },
          },
        },
      });
      if (!organization) throw new TRPCError({ code: "NOT_FOUND" });

      const localUser = ctx.clerkUserId
        ? await ctx.db.user.findUnique({
            where: { authProviderId: ctx.clerkUserId },
            select: { id: true },
          })
        : null;
      const access = localUser
        ? await orgPermissions(ctx.db, organization.id, localUser.id)
        : { role: null, permissions: [] };

      return {
        ...organization,
        myRole: access.role,
        myPermissions: access.permissions,
      };
    }),

  /** The staff list: who is here, what they are called, what they can do. */
  staff: protectedProcedure
    .input(z.object({ organizationId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      await assertOrgPermission(
        ctx.db,
        input.organizationId,
        ctx.user.id,
        Permission.ORG_STAFF_MANAGE,
      );
      const [members, roles] = await Promise.all([
        ctx.db.organizationMembership.findMany({
          where: { organizationId: input.organizationId },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
          include: {
            user: {
              select: {
                id: true,
                email: true,
                profile: { select: { displayName: true } },
              },
            },
            assignments: {
              include: {
                staffRole: {
                  select: { id: true, name: true, color: true, permissions: true },
                },
                series: { select: { id: true, name: true } },
                event: { select: { id: true, name: true } },
              },
            },
          },
        }),
        ctx.db.staffRole.findMany({
          where: { organizationId: input.organizationId },
          orderBy: { name: "asc" },
          include: { _count: { select: { assignments: true } } },
        }),
      ]);
      return { members, roles };
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(120),
        description: z.string().max(4000).optional(),
        websiteUrl: z.string().url().max(300).optional(),
        contactEmail: z.string().email().max(200).optional(),
        location: z.string().max(160).optional(),
        /// Seeds the starter roles so a new organization is usable at once.
        withStarterRoles: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Approved first. An organization is the biggest thing on the platform
      // to stand up — staff, series, a public front — so it is the one most
      // worth a human reading the application. Platform staff bypass.
      const { requestId } = await findSpendableApproval(
        ctx.db,
        ctx.user,
        AccessRequestKind.ORGANIZATION,
      );

      const { withStarterRoles, ...rest } = input;
      const clash = await ctx.db.organization.findFirst({
        where: { name: input.name },
        select: { id: true },
      });
      if (clash) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An organization with that name already exists.",
        });
      }
      const slug = await uniqueOrgSlug(ctx.db, input.name);

      // One transaction, so an approval is never spent on a creation that then
      // failed, and no organization exists against an approval still open.
      return ctx.db.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            ...rest,
            slug,
            members: {
              create: { userId: ctx.user.id, role: OrgRole.OWNER },
            },
            // A blank permission model is a page nobody fills in; presets give
            // an organization something to edit rather than to invent.
            ...(withStarterRoles
              ? {
                  staffRoles: {
                    create: STARTER_ROLES.map((role) => ({
                      name: role.name,
                      description: role.description,
                      permissions: role.permissions,
                      color: role.color,
                    })),
                  },
                }
              : {}),
          },
          include: { staffRoles: true },
        });
        await spendApproval(tx, requestId, organization.id);
        return organization;
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().cuid(),
        name: z.string().min(2).max(120).optional(),
        description: z.string().max(4000).nullish(),
        websiteUrl: z.string().url().max(300).nullish(),
        contactEmail: z.string().email().max(200).nullish(),
        location: z.string().max(160).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, ...data } = input;
      await assertOrgPermission(
        ctx.db,
        organizationId,
        ctx.user.id,
        Permission.ORG_MANAGE,
      );
      // The slug is left alone on rename: it is in links people have already
      // shared, and a club changing sponsor name should not break them.
      return ctx.db.organization.update({
        where: { id: organizationId },
        data,
      });
    }),

  // -- Membership ----------------------------------------------------------

  /**
   * Add someone by email.
   *
   * They must already have a RaceOps account: silently creating one would mean
   * an organization could conjure a user record from an address nobody has
   * verified, and that person would first hear of it in a notification.
   */
  addMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().cuid(),
        email: z.string().email(),
        role: z.nativeEnum(OrgRole).default(OrgRole.STAFF),
        title: z.string().max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgPermission(
        ctx.db,
        input.organizationId,
        ctx.user.id,
        Permission.ORG_STAFF_MANAGE,
      );
      if (input.role === OrgRole.OWNER) {
        await assertOrgOwner(ctx.db, input.organizationId, ctx.user.id);
      }

      const user = await ctx.db.user.findUnique({
        where: { email: input.email.toLowerCase() },
        select: { id: true },
      });
      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Nobody with that email has a RaceOps account yet. Ask them to sign up, then add them.",
        });
      }

      return ctx.db.organizationMembership.upsert({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: user.id,
          },
        },
        create: {
          organizationId: input.organizationId,
          userId: user.id,
          role: input.role,
          title: input.title,
        },
        update: { role: input.role, title: input.title },
        include: {
          user: { select: { profile: { select: { displayName: true } } } },
        },
      });
    }),

  removeMember: protectedProcedure
    .input(z.object({ membershipId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await ctx.db.organizationMembership.findUnique({
        where: { id: input.membershipId },
        select: { organizationId: true, role: true, userId: true },
      });
      if (!membership) throw new TRPCError({ code: "NOT_FOUND" });
      await assertOrgPermission(
        ctx.db,
        membership.organizationId,
        ctx.user.id,
        Permission.ORG_STAFF_MANAGE,
      );
      if (membership.role === OrgRole.OWNER) {
        await assertOrgOwner(ctx.db, membership.organizationId, ctx.user.id);
        const owners = await ctx.db.organizationMembership.count({
          where: {
            organizationId: membership.organizationId,
            role: OrgRole.OWNER,
          },
        });
        // An organization with no owner cannot be administered by anyone,
        // and there is no platform admin to rescue it.
        if (owners <= 1) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "This is the last owner. Make someone else an owner before removing them.",
          });
        }
      }
      await ctx.db.organizationMembership.delete({
        where: { id: input.membershipId },
      });
      return { removed: true };
    }),

  // -- Custom roles --------------------------------------------------------

  createRole: protectedProcedure
    .input(
      z.object({
        // A role belongs to an organization or a single series; the series
        // case lets a one-off championship skip creating an organization.
        organizationId: z.string().cuid().optional(),
        seriesId: z.string().cuid().optional(),
        name: z.string().min(1).max(60),
        description: z.string().max(300).optional(),
        permissions: z.array(z.nativeEnum(Permission)).max(20),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #D91E1E")
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (Boolean(input.organizationId) === Boolean(input.seriesId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Scope a role to an organization or a series, not both.",
        });
      }
      if (input.organizationId) {
        await assertOrgPermission(
          ctx.db,
          input.organizationId,
          ctx.user.id,
          Permission.ORG_STAFF_MANAGE,
        );
      } else if (input.seriesId) {
        const { assertSeriesRole, SERIES_ADMIN_ROLES } = await import(
          "@/server/services/series-auth"
        );
        await assertSeriesRole(
          ctx.db,
          input.seriesId,
          ctx.user.id,
          SERIES_ADMIN_ROLES,
        );
      }

      // Nobody may create a role holding a permission they do not hold
      // themselves. Without this, staff-management is a straight path to
      // every other permission: create "Superuser", assign it to yourself.
      await assertCanGrant(
        ctx.db,
        ctx.user.id,
        input.permissions,
        input.organizationId,
        input.seriesId,
      );

      return ctx.db.staffRole.create({ data: input });
    }),

  updateRole: protectedProcedure
    .input(
      z.object({
        staffRoleId: z.string().cuid(),
        name: z.string().min(1).max(60).optional(),
        description: z.string().max(300).nullish(),
        permissions: z.array(z.nativeEnum(Permission)).max(20).optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = await ctx.db.staffRole.findUnique({
        where: { id: input.staffRoleId },
        select: { organizationId: true, seriesId: true, permissions: true },
      });
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      await assertRoleAdmin(ctx.db, role, ctx.user.id);

      if (input.permissions) {
        await assertCanGrant(
          ctx.db,
          ctx.user.id,
          input.permissions,
          role.organizationId,
          role.seriesId,
        );
      }

      const { staffRoleId, ...data } = input;
      const updated = await ctx.db.staffRole.update({
        where: { id: staffRoleId },
        data,
      });
      await recordAudit(ctx.db, {
        actorId: ctx.user.id,
        action: AuditAction.UPDATE,
        entityType: "StaffRole",
        entityId: staffRoleId,
        seriesId: role.seriesId,
        summary: `Changed the "${updated.name}" role`,
        ...(input.permissions
          ? {
              changes: {
                permissions: {
                  from: role.permissions.join(", "),
                  to: input.permissions.join(", "),
                },
              },
            }
          : {}),
      });
      return updated;
    }),

  deleteRole: protectedProcedure
    .input(z.object({ staffRoleId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const role = await ctx.db.staffRole.findUnique({
        where: { id: input.staffRoleId },
        select: {
          organizationId: true,
          seriesId: true,
          name: true,
          _count: { select: { assignments: true } },
        },
      });
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      await assertRoleAdmin(ctx.db, role, ctx.user.id);
      // Deleting a role revokes it from everyone holding it, which is a much
      // bigger action than it looks from the roles list.
      if (role._count.assignments > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${role._count.assignments} ${role._count.assignments === 1 ? "person holds" : "people hold"} the "${role.name}" role. Unassign them first.`,
        });
      }
      await ctx.db.staffRole.delete({ where: { id: input.staffRoleId } });
      return { deleted: true };
    }),

  // -- Assignments ---------------------------------------------------------

  assignRole: protectedProcedure
    .input(
      z.object({
        staffRoleId: z.string().cuid(),
        userId: z.string().cuid(),
        /// Narrows an organization-wide role to one series, or one event.
        seriesId: z.string().cuid().optional(),
        eventId: z.string().cuid().optional(),
        notes: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.seriesId && input.eventId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Narrow an assignment to a series or an event, not both.",
        });
      }
      const role = await ctx.db.staffRole.findUnique({
        where: { id: input.staffRoleId },
        select: {
          organizationId: true,
          seriesId: true,
          name: true,
          permissions: true,
        },
      });
      if (!role) throw new TRPCError({ code: "NOT_FOUND" });
      await assertRoleAdmin(ctx.db, role, ctx.user.id);
      await assertCanGrant(
        ctx.db,
        ctx.user.id,
        role.permissions,
        role.organizationId,
        role.seriesId,
      );

      const membership = role.organizationId
        ? await ctx.db.organizationMembership.findUnique({
            where: {
              organizationId_userId: {
                organizationId: role.organizationId,
                userId: input.userId,
              },
            },
            select: { id: true },
          })
        : null;

      // findFirst + create rather than upsert: the unique is over nullable
      // scope columns, and Postgres does not treat two NULLs as equal, so an
      // upsert against it would insert a duplicate rather than update.
      const include = {
        staffRole: { select: { name: true } },
        user: { select: { profile: { select: { displayName: true } } } },
      } as const;
      const existing = await ctx.db.staffAssignment.findFirst({
        where: {
          staffRoleId: input.staffRoleId,
          userId: input.userId,
          seriesId: input.seriesId ?? null,
          eventId: input.eventId ?? null,
        },
        select: { id: true },
      });
      const assignment = existing
        ? await ctx.db.staffAssignment.update({
            where: { id: existing.id },
            data: { notes: input.notes, membershipId: membership?.id },
            include,
          })
        : await ctx.db.staffAssignment.create({
            data: { ...input, membershipId: membership?.id },
            include,
          });

      await recordAudit(ctx.db, {
        actorId: ctx.user.id,
        action: AuditAction.CREATE,
        entityType: "StaffAssignment",
        entityId: assignment.id,
        eventId: input.eventId ?? null,
        seriesId: input.seriesId ?? role.seriesId,
        summary: `Assigned "${role.name}" to ${assignment.user.profile?.displayName ?? "someone"}`,
      });

      return assignment;
    }),

  unassignRole: protectedProcedure
    .input(z.object({ assignmentId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const assignment = await ctx.db.staffAssignment.findUnique({
        where: { id: input.assignmentId },
        select: {
          seriesId: true,
          staffRole: {
            select: { organizationId: true, seriesId: true, name: true },
          },
        },
      });
      if (!assignment) throw new TRPCError({ code: "NOT_FOUND" });
      await assertRoleAdmin(ctx.db, assignment.staffRole, ctx.user.id);
      await ctx.db.staffAssignment.delete({
        where: { id: input.assignmentId },
      });
      await recordAudit(ctx.db, {
        actorId: ctx.user.id,
        action: AuditAction.DELETE,
        entityType: "StaffAssignment",
        entityId: input.assignmentId,
        seriesId: assignment.seriesId ?? assignment.staffRole.seriesId,
        summary: `Removed the "${assignment.staffRole.name}" role from someone`,
      });
      return { removed: true };
    }),

  /** Roles available to assign in one series — its own plus its org's. */
  rolesForSeries: protectedProcedure
    .input(z.object({ seriesId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const { assertSeriesRole, SERIES_ADMIN_ROLES } = await import(
        "@/server/services/series-auth"
      );
      await assertSeriesRole(
        ctx.db,
        input.seriesId,
        ctx.user.id,
        SERIES_ADMIN_ROLES,
      );
      const series = await ctx.db.series.findUniqueOrThrow({
        where: { id: input.seriesId },
        select: { organizationId: true },
      });
      return ctx.db.staffRole.findMany({
        where: {
          OR: [
            { seriesId: input.seriesId },
            ...(series.organizationId
              ? [{ organizationId: series.organizationId }]
              : []),
          ],
        },
        orderBy: { name: "asc" },
        include: {
          assignments: {
            where: {
              OR: [{ seriesId: input.seriesId }, { seriesId: null }],
            },
            include: {
              user: {
                select: {
                  id: true,
                  profile: { select: { displayName: true } },
                },
              },
              event: { select: { id: true, name: true } },
            },
          },
        },
      });
    }),

  /** Link a series to an organization, so it inherits staff and branding. */
  adoptSeries: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().cuid(),
        seriesId: z.string().cuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgPermission(
        ctx.db,
        input.organizationId,
        ctx.user.id,
        Permission.ORG_MANAGE,
      );
      // Both sides have to agree: an organization admin cannot absorb a
      // championship they have no standing in.
      const { assertSeriesOwner } = await import(
        "@/server/services/series-auth"
      );
      await assertSeriesOwner(ctx.db, input.seriesId, ctx.user.id);
      return ctx.db.series.update({
        where: { id: input.seriesId },
        data: { organizationId: input.organizationId },
      });
    }),

  delete: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().cuid(),
        confirmName: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgOwner(ctx.db, input.organizationId, ctx.user.id);
      const organization = await ctx.db.organization.findUniqueOrThrow({
        where: { id: input.organizationId },
        select: { name: true, _count: { select: { series: true, teams: true } } },
      });
      if (organization.name !== input.confirmName) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Type the organization's name exactly to confirm.",
        });
      }
      // Series and teams survive: they are detached (the FK is SET NULL), not
      // deleted. Losing a championship because someone tidied up the company
      // that ran it would be indefensible.
      await ctx.db.organization.delete({ where: { id: input.organizationId } });
      return {
        deleted: true,
        detachedSeries: organization._count.series,
        detachedTeams: organization._count.teams,
      };
    }),
});

/** Whoever administers the scope a role belongs to may edit that role. */
async function assertRoleAdmin(
  db: PrismaClient,
  role: { organizationId: string | null; seriesId: string | null },
  userId: string,
): Promise<void> {
  if (role.organizationId) {
    await assertOrgPermission(
      db,
      role.organizationId,
      userId,
      Permission.ORG_STAFF_MANAGE,
    );
    return;
  }
  if (role.seriesId) {
    const { assertSeriesRole, SERIES_ADMIN_ROLES } = await import(
      "@/server/services/series-auth"
    );
    await assertSeriesRole(db, role.seriesId, userId, SERIES_ADMIN_ROLES);
    return;
  }
  throw new TRPCError({ code: "NOT_FOUND" });
}

/**
 * Nobody may grant a permission they do not hold themselves.
 *
 * Without this rule, `ORG_STAFF_MANAGE` is a straight path to every other
 * permission: create a role called "Superuser" holding everything, assign it
 * to yourself, and the permission system has been walked around in two clicks.
 */
async function assertCanGrant(
  db: PrismaClient,
  userId: string,
  wanted: Permission[],
  organizationId: string | null | undefined,
  seriesId: string | null | undefined,
): Promise<void> {
  let held: Permission[] = [];
  if (organizationId) {
    held = (await orgPermissions(db, organizationId, userId)).permissions;
  } else if (seriesId) {
    const { effectiveSeriesAccess } = await import(
      "@/server/services/series-auth"
    );
    held = (await effectiveSeriesAccess(db, seriesId, userId)).permissions;
  }

  const missing = wanted.filter((permission) => !held.includes(permission));
  if (missing.length > 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You cannot grant a permission you do not hold yourself: ${missing.join(", ")}.`,
    });
  }
}
