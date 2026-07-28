"use client";

import { useState } from "react";
import { ProfileType } from "@prisma/client";
import { api } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PROFILE_TYPE_LABELS: Record<ProfileType, string> = {
  DRIVER: "Driver",
  CREW: "Crew",
  ENGINEER: "Engineer",
  SPONSOR: "Sponsor",
  TEAM_MANAGER: "Team manager",
  INDUSTRY_PRO: "Industry pro",
};

export function ProfileView() {
  const utils = api.useUtils();
  const me = api.user.me.useQuery();

  if (me.isLoading) {
    return <p className="text-brand-black/60">Loading…</p>;
  }

  if (!me.data) {
    return <OnboardingForm onDone={() => utils.user.me.invalidate()} />;
  }

  const profile = me.data.profile;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{profile?.displayName}</h1>
          <p className="text-brand-black/60">{profile?.location}</p>
        </div>
        {me.data.verificationStatus === "VERIFIED" && (
          <Badge variant="verified">Verified</Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {me.data.profileTypes.map((type) => (
          <Badge key={type}>{PROFILE_TYPE_LABELS[type]}</Badge>
        ))}
      </div>
      {profile?.bio && (
        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-brand-black/80">
              {profile.bio}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OnboardingForm({ onDone }: { onDone: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<ProfileType[]>([]);

  const onboard = api.user.completeOnboarding.useMutation({
    onSuccess: onDone,
  });

  function toggleType(type: ProfileType) {
    setSelectedTypes((current) =>
      current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type],
    );
  }

  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>Welcome to RaceOps — set up your profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block text-sm font-medium">
          Display name
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Alex Martins"
          />
        </label>
        <div>
          <span className="text-sm font-medium">I am a…</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {(Object.keys(PROFILE_TYPE_LABELS) as ProfileType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  selectedTypes.includes(type)
                    ? "border-brand-red bg-brand-red text-white"
                    : "border-brand-black/20 hover:border-brand-red"
                }`}
              >
                {PROFILE_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>
        <label className="block text-sm font-medium">
          Location
          <input
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Lisbon, Portugal"
          />
        </label>
        <label className="block text-sm font-medium">
          Bio
          <textarea
            className="mt-1 w-full rounded-md border border-brand-black/20 px-3 py-2 text-sm"
            rows={4}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="GT3 endurance driver, 3.2k iRating, ex-karting national champion…"
          />
        </label>
        {onboard.error && (
          <p className="text-sm text-brand-red">{onboard.error.message}</p>
        )}
        <Button
          variant="primary"
          disabled={
            onboard.isPending ||
            displayName.trim().length < 2 ||
            selectedTypes.length === 0
          }
          onClick={() =>
            onboard.mutate({
              displayName: displayName.trim(),
              profileTypes: selectedTypes,
              location: location.trim() || undefined,
              bio: bio.trim() || undefined,
            })
          }
        >
          {onboard.isPending ? "Creating…" : "Create profile"}
        </Button>
      </CardContent>
    </Card>
  );
}
