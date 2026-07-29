"use client";

import { useState } from "react";
import { ProfileType } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [profileType, setProfileType] = useState<ProfileType | "">("");
  const [location, setLocation] = useState("");

  const results = api.search.profiles.useQuery({
    query: query || undefined,
    profileType: profileType || undefined,
    location: location || undefined,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Discover people</h1>
      <div className="flex flex-wrap gap-3">
        <input
          className="w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm sm:w-64"
          placeholder="Search names and bios…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="min-w-0 flex-1 rounded-md border border-brand-black/20 px-3 py-2 text-sm sm:flex-none"
          value={profileType}
          onChange={(e) => setProfileType(e.target.value as ProfileType | "")}
        >
          <option value="">All roles</option>
          {Object.values(ProfileType).map((type) => (
            <option key={type} value={type}>
              {type.replace("_", " ").toLowerCase()}
            </option>
          ))}
        </select>
        <input
          className="min-w-0 flex-1 rounded-md border border-brand-black/20 px-3 py-2 text-sm sm:w-48 sm:flex-none"
          placeholder="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>

      {results.isLoading && <p className="text-brand-black/60">Searching…</p>}
      {results.data?.users.length === 0 && (
        <p className="text-brand-black/60">No matching profiles yet.</p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {results.data?.users.map((user) => (
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
                  <Badge key={type}>{type.replace("_", " ").toLowerCase()}</Badge>
                ))}
              </div>
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
        ))}
      </div>
    </div>
  );
}
