"use client";

import { use } from "react";
import Link from "next/link";
import { Permission } from "@prisma/client";
import type { inferRouterOutputs } from "@trpc/server";
import { api } from "@/lib/trpc/client";
import type { AppRouter } from "@/server/trpc/root";
import { resolveBranding } from "@/lib/branding";
import { ORG_ROLE_LABELS } from "@/lib/permissions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, Section } from "@/components/ui/page";
import { Tabs } from "@/components/ui/tabs";
import { BrandHeader, BrandTheme } from "@/components/brand-theme";
import { BrandingEditor } from "@/components/branding-editor";
import { StaffPanel } from "./staff-panel";
import { PageSkeleton } from "@/components/ui/skeleton";

/**
 * An organization's page: public front, management behind tabs.
 *
 * Tabs rather than one long scroll — the console has four unrelated jobs, and
 * stacking them means an owner scrolls past the staff list every time they
 * want the branding editor.
 */
export default function OrganizationPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const organization = api.organization.bySlug.useQuery(
    { slug },
    { meta: { silenceError: true } },
  );

  if (organization.isLoading) {
    return <PageSkeleton />;
  }
  if (organization.error) {
    return <p className="text-brand-red">{organization.error.message}</p>;
  }

  const data = organization.data!;
  const branding = resolveBranding(data.branding);
  const canManage = data.myPermissions.includes(Permission.ORG_MANAGE);
  const canManageStaff = data.myPermissions.includes(
    Permission.ORG_STAFF_MANAGE,
  );

  return (
    <BrandTheme branding={branding} className="space-y-6">
      <BrandHeader
        branding={branding}
        name={data.name}
        eyebrow="Organization"
        meta={[data.location, data.websiteUrl].filter(Boolean).join(" · ")}
        actions={
          data.myRole ? (
            <Badge variant="verified">{ORG_ROLE_LABELS[data.myRole]}</Badge>
          ) : null
        }
      />

      <Tabs
        tabs={[
          {
            id: "overview",
            label: "Overview",
            content: <Overview data={data} />,
          },
          {
            id: "staff",
            label: "Staff & roles",
            visible: canManageStaff,
            badge: undefined,
            content: <StaffPanel organizationId={data.id} />,
          },
          {
            id: "branding",
            label: "Look and feel",
            visible: canManage,
            content: (
              <BrandingEditor
                scope={{ organizationId: data.id }}
                name={data.name}
                description="Series and teams under this organization inherit anything you set here."
              />
            ),
          },
        ]}
      />
    </BrandTheme>
  );
}

type OrgData = inferRouterOutputs<AppRouter>["organization"]["bySlug"];

function Overview({ data }: { data: OrgData }) {
  return (
    <div className="space-y-8">
      {data.description && (
        <p className="max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-brand-black/80">
          {data.description}
        </p>
      )}

      <Section title="Series">
        {data.series.length === 0 ? (
          <EmptyState
            title="No series yet"
            description="Create a series, then link it here from its settings."
            action={
              <Link href="/series">
                <Button size="sm" variant="primary">
                  Go to series
                </Button>
              </Link>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.series.map((series) => (
              <Link key={series.id} href={`/series/${series.slug}`}>
                <Card className="h-full transition-colors hover:border-brand-black/25">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Avatar
                      src={series.branding?.logoUrl ?? series.logoUrl}
                      name={series.name}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{series.name}</p>
                      <p className="text-xs text-brand-black/60">
                        {series._count.events} event
                        {series._count.events === 1 ? "" : "s"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </Section>

      {data.teams.length > 0 && (
        <Section title="Teams">
          <div className="grid gap-3 sm:grid-cols-2">
            {data.teams.map((team) => (
              <Link key={team.id} href={`/teams/${team.slug}`}>
                <Card className="h-full transition-colors hover:border-brand-black/25">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Avatar
                      src={team.branding?.logoUrl ?? team.logoUrl}
                      name={team.name}
                      size="sm"
                    />
                    <p className="truncate font-medium">{team.name}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
