"use client";

import { useState } from "react";
import { ProfileType, RealWorldRole, SimRole } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import {
  PROFILE_TYPE_LABELS,
  REAL_WORLD_ROLE_GROUPS,
  REAL_WORLD_ROLE_LABELS,
  SIM_ROLE_GROUPS,
  SIM_ROLE_LABELS,
  roleTagsOf,
} from "@/lib/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RoleGroup } from "@/lib/roles";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [profileType, setProfileType] = useState<ProfileType | "">("");
  const [simRole, setSimRole] = useState<SimRole | "">("");
  const [realWorldRole, setRealWorldRole] = useState<RealWorldRole | "">("");
  const [location, setLocation] = useState("");

  const results = api.search.profiles.useQuery({
    query: query || undefined,
    profileType: profileType || undefined,
    simRole: simRole || undefined,
    realWorldRole: realWorldRole || undefined,
    location: location || undefined,
  });

  const hasRoleFilter = simRole !== "" || realWorldRole !== "";

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Discover people</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <input
          className="rounded-md border border-brand-black/20 px-3 py-2 text-sm"
          placeholder="Search names and bios…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="rounded-md border border-brand-black/20 px-3 py-2 text-sm"
          value={profileType}
          onChange={(e) => setProfileType(e.target.value as ProfileType | "")}
        >
          <option value="">All categories</option>
          {Object.values(ProfileType).map((type) => (
            <option key={type} value={type}>
              {PROFILE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <input
          className="rounded-md border border-brand-black/20 px-3 py-2 text-sm"
          placeholder="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <GroupedRoleSelect
          placeholder="Any sim role"
          groups={SIM_ROLE_GROUPS}
          labels={SIM_ROLE_LABELS}
          value={simRole}
          onChange={setSimRole}
        />
        <GroupedRoleSelect
          placeholder="Any real-world role"
          groups={REAL_WORLD_ROLE_GROUPS}
          labels={REAL_WORLD_ROLE_LABELS}
          value={realWorldRole}
          onChange={setRealWorldRole}
        />
        {hasRoleFilter && (
          <Button
            variant="outline"
            onClick={() => {
              setSimRole("");
              setRealWorldRole("");
            }}
          >
            Clear role filters
          </Button>
        )}
      </div>

      {results.isLoading && <p className="text-brand-black/60">Searching…</p>}
      {results.error && (
        <p className="text-sm text-brand-red">{results.error.message}</p>
      )}
      {results.data?.users.length === 0 && (
        <p className="text-brand-black/60">No matching profiles yet.</p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {results.data?.users.map((user) => {
          const tags = user.profile ? roleTagsOf(user.profile) : [];
          return (
            <Card key={user.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{user.profile?.displayName}</CardTitle>
                  {user.verificationStatus === "VERIFIED" && (
                    <Badge variant="verified">Verified</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {user.profileTypes.map((type) => (
                    <Badge key={type}>{PROFILE_TYPE_LABELS[type]}</Badge>
                  ))}
                </div>
                {tags.length > 0 && (
                  <p className="text-xs text-brand-black/70">
                    {tags.map((tag) => tag.label).join(" · ")}
                  </p>
                )}
                {user.profile?.location && (
                  <p className="text-xs text-brand-black/60">
                    {user.profile.location}
                  </p>
                )}
                {user.profile?.bio && (
                  <p className="line-clamp-3 text-sm text-brand-black/80">
                    {user.profile.bio}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** A single-select over grouped roles, using native optgroups. */
function GroupedRoleSelect<T extends string>({
  placeholder,
  groups,
  labels,
  value,
  onChange,
}: {
  placeholder: string;
  groups: RoleGroup<T>[];
  labels: Record<T, string>;
  value: T | "";
  onChange: (next: T | "") => void;
}) {
  return (
    <select
      className="rounded-md border border-brand-black/20 px-3 py-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value as T | "")}
    >
      <option value="">{placeholder}</option>
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.roles.map((role) => (
            <option key={role} value={role}>
              {labels[role]}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
