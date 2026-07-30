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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RoleTagPicker } from "@/components/role-tag-picker";

export function ProfileView() {
  const utils = api.useUtils();
  const me = api.user.me.useQuery();
  const [editingRoles, setEditingRoles] = useState(false);

  if (me.isLoading) {
    return <p className="text-brand-black/60">Loading…</p>;
  }

  if (!me.data) {
    return <OnboardingForm onDone={() => utils.user.me.invalidate()} />;
  }

  const profile = me.data.profile;
  const tags = profile ? roleTagsOf(profile) : [];

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

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">What I do</h2>
          <Button
            size="sm"
            variant={editingRoles ? "outline" : "primary"}
            onClick={() => setEditingRoles((v) => !v)}
          >
            {editingRoles ? "Cancel" : tags.length > 0 ? "Edit" : "Add roles"}
          </Button>
        </div>

        {editingRoles ? (
          <RoleTagEditor
            initialSimRoles={profile?.simRoles ?? []}
            initialRealWorldRoles={profile?.realWorldRoles ?? []}
            onSaved={() => {
              setEditingRoles(false);
              utils.user.me.invalidate();
            }}
          />
        ) : tags.length === 0 ? (
          <p className="text-sm text-brand-black/60">
            No role tags yet. Add them so teams and organizers looking for what
            you do can actually find you.
          </p>
        ) : (
          <RoleTagList tags={tags} />
        )}
      </section>

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

/**
 * Role tags, split so it is obvious which world each belongs to — the same
 * job title means different things across sim and real racing.
 */
export function RoleTagList({
  tags,
}: {
  tags: ReturnType<typeof roleTagsOf>;
}) {
  const sim = tags.filter((tag) => tag.domain === "sim");
  const real = tags.filter((tag) => tag.domain === "real");

  return (
    <div className="space-y-3">
      {sim.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
            Sim racing
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {sim.map((tag) => (
              <Badge key={tag.value}>{tag.label}</Badge>
            ))}
          </div>
        </div>
      )}
      {real.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-black/50">
            Real world
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {real.map((tag) => (
              <Badge key={tag.value} variant="verified">
                {tag.label}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RoleTagEditor({
  initialSimRoles,
  initialRealWorldRoles,
  onSaved,
}: {
  initialSimRoles: SimRole[];
  initialRealWorldRoles: RealWorldRole[];
  onSaved: () => void;
}) {
  const [simRoles, setSimRoles] = useState<SimRole[]>(initialSimRoles);
  const [realWorldRoles, setRealWorldRoles] =
    useState<RealWorldRole[]>(initialRealWorldRoles);

  const update = api.profile.update.useMutation({ onSuccess: onSaved });

  return (
    <Card>
      <CardContent className="space-y-6 p-5">
        <RoleTagPicker
          label="Sim racing"
          description="What you do on the sim side."
          groups={SIM_ROLE_GROUPS}
          labels={SIM_ROLE_LABELS}
          selected={simRoles}
          onChange={setSimRoles}
        />
        <RoleTagPicker
          label="Real world"
          description="What you do at a real circuit or in the industry."
          groups={REAL_WORLD_ROLE_GROUPS}
          labels={REAL_WORLD_ROLE_LABELS}
          selected={realWorldRoles}
          onChange={setRealWorldRoles}
        />
        {update.error && (
          <p className="text-sm text-brand-red">{update.error.message}</p>
        )}
        <Button
          variant="primary"
          disabled={update.isPending}
          onClick={() => update.mutate({ simRoles, realWorldRoles })}
        >
          {update.isPending ? "Saving…" : "Save roles"}
        </Button>
      </CardContent>
    </Card>
  );
}

function OnboardingForm({ onDone }: { onDone: () => void }) {
  const [displayName, setDisplayName] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<ProfileType[]>([]);
  const [simRoles, setSimRoles] = useState<SimRole[]>([]);
  const [realWorldRoles, setRealWorldRoles] = useState<RealWorldRole[]>([]);

  const utils = api.useUtils();
  // Onboarding creates the account; role tags are a follow-up update so the
  // profile exists before they are attached.
  const saveRoles = api.profile.update.useMutation({ onSuccess: onDone });
  const onboard = api.user.completeOnboarding.useMutation({
    onSuccess: async () => {
      await utils.user.me.invalidate();
      if (simRoles.length === 0 && realWorldRoles.length === 0) {
        onDone();
        return;
      }
      saveRoles.mutate({ simRoles, realWorldRoles });
    },
  });

  function toggleType(type: ProfileType) {
    setSelectedTypes((current) =>
      current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type],
    );
  }

  const isSaving = onboard.isPending || saveRoles.isPending;

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

        <div className="space-y-6 border-t border-brand-black/10 pt-4">
          <RoleTagPicker
            label="Sim racing roles"
            description="Optional — pick what you actually do so people can find you."
            groups={SIM_ROLE_GROUPS}
            labels={SIM_ROLE_LABELS}
            selected={simRoles}
            onChange={setSimRoles}
          />
          <RoleTagPicker
            label="Real-world roles"
            description="Optional."
            groups={REAL_WORLD_ROLE_GROUPS}
            labels={REAL_WORLD_ROLE_LABELS}
            selected={realWorldRoles}
            onChange={setRealWorldRoles}
          />
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
        {(onboard.error ?? saveRoles.error) && (
          <p className="text-sm text-brand-red">
            {onboard.error?.message ?? saveRoles.error?.message}
          </p>
        )}
        <Button
          variant="primary"
          disabled={
            isSaving ||
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
          {isSaving ? "Creating…" : "Create profile"}
        </Button>
      </CardContent>
    </Card>
  );
}
