"use client";

import { api } from "@/lib/trpc/client";
import { STATUS_LABELS } from "@/lib/applications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MyApplicationsPage() {
  const utils = api.useUtils();
  const applications = api.opportunity.myApplications.useQuery();
  const withdraw = api.opportunity.withdrawApplication.useMutation({
    onSuccess: () => utils.opportunity.myApplications.invalidate(),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">My applications</h1>
      {applications.isLoading && <p className="text-brand-black/60">Loading…</p>}
      {applications.data?.length === 0 && (
        <p className="text-brand-black/60">
          You haven&apos;t applied to anything yet — browse{" "}
          <a href="/opportunities" className="text-brand-red hover:underline">
            open opportunities
          </a>
          .
        </p>
      )}
      <div className="space-y-4">
        {applications.data?.map((application) => (
          <Card key={application.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{application.opportunity.title}</CardTitle>
                <Badge
                  variant={
                    application.status === "ACCEPTED" ? "verified" : "default"
                  }
                >
                  {STATUS_LABELS[application.status]}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <p className="text-xs text-brand-black/60">
                Applied {new Date(application.createdAt).toLocaleDateString()}
              </p>
              {["SUBMITTED", "REVIEWING"].includes(application.status) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={withdraw.isPending}
                  onClick={() =>
                    withdraw.mutate({ applicationId: application.id })
                  }
                >
                  Withdraw
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
