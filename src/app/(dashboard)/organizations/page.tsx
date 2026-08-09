"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/trpc/client";
import { ORG_ROLE_LABELS } from "@/lib/permissions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { ListSkeleton } from "@/components/ui/skeleton";

/**
 * Organizations the caller belongs to.
 *
 * The empty state carries the explanation, because "organization" is the one
 * concept here that is genuinely optional and people reasonably wonder whether
 * they are supposed to make one.
 */
export default function OrganizationsPage() {
  const organizations = api.organization.mine.useQuery();
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Organizations"
        description="The club, promoter or company behind your series and teams."
        actions={
          <Button variant="primary" onClick={() => setCreating((v) => !v)}>
            {creating ? "Cancel" : "New organization"}
          </Button>
        }
      />

      {creating && <CreateForm onCreated={() => setCreating(false)} />}

      {organizations.isLoading && <ListSkeleton />}

      {organizations.data?.length === 0 && !creating && (
        <EmptyState
          title="You are not in an organization"
          description="You do not need one. Series and teams work perfectly well on their own — create an organization when several people share the work, or when one body runs several series and you want one staff list and one look across them."
          action={
            <Button variant="primary" onClick={() => setCreating(true)}>
              Create one
            </Button>
          }
        />
      )}

      {organizations.data && organizations.data.length > 0 && (
        <Section title="Your organizations">
          <div className="grid gap-3 sm:grid-cols-2">
            {organizations.data.map((organization) => (
              <Link
                key={organization.id}
                href={`/organizations/${organization.slug}`}
              >
                <Card className="h-full transition-colors hover:border-brand-black/25">
                  <CardContent className="flex items-start gap-3 p-4">
                    <Avatar
                      src={organization.branding?.logoUrl}
                      name={organization.name}
                      size="md"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">
                          {organization.name}
                        </p>
                        <Badge>{ORG_ROLE_LABELS[organization.myRole]}</Badge>
                      </div>
                      {organization.myTitle && (
                        <p className="text-xs text-brand-black/60">
                          {organization.myTitle}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-brand-black/60">
                        {[
                          `${organization._count.members} staff`,
                          `${organization._count.series} series`,
                          `${organization._count.teams} teams`,
                        ].join(" · ")}
                      </p>
                    </div>
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

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const utils = api.useUtils();
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const create = api.organization.create.useMutation({
    meta: { silenceError: true },
    onSuccess: async () => {
      await utils.organization.mine.invalidate();
      onCreated();
    },
  });

  return (
    <Card className="max-w-xl">
      <CardContent className="space-y-4 p-5">
        <Form
          busy={create.isPending}
          onSubmit={() =>
            create.mutate({
              name: name.trim(),
              location: location.trim() || undefined,
              contactEmail: contactEmail.trim() || undefined,
            })
          }
          className="space-y-3"
        >
          <p className="text-sm text-brand-black/60">
            You will be the owner. A starter set of roles — Clerk of the Course,
            Chief Scrutineer, Steward and so on — is created with it, all
            editable.
          </p>
          <label className="block text-sm font-medium">
            Name
            <input
              className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Apex Motorsport Club"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              Location
              <input
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              Contact email
              <input
                type="email"
                className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </label>
          </div>
          {create.error && (
            <p className="text-sm text-brand-red">{create.error.message}</p>
          )}
          <Button
            variant="primary"
            disabled={create.isPending || name.trim().length < 2}
            type="submit"
          >
            {create.isPending ? "Creating…" : "Create organization"}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}
