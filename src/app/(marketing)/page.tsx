import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const PILLARS = [
  {
    title: "Verified cross-domain profiles",
    body: "One profile for your sim stats, real-world licenses, and industry experience — verified, portable, and searchable.",
  },
  {
    title: "Opportunities marketplace",
    body: "Seats, crew jobs, and sponsorships posted by real teams. Apply in one click, track every application.",
  },
  {
    title: "Pit Wall strategy tools",
    body: "Stint planning, fuel strategy, and driver rotation calculators — standalone or shared with your team.",
  },
];

export default function LandingPage() {
  return (
    <main>
      <section className="mx-auto max-w-6xl px-4 py-24 text-center">
        <h1 className="mx-auto max-w-3xl text-5xl font-bold tracking-tight text-brand-black">
          Where sim racing meets{" "}
          <span className="text-brand-red">real motorsport careers</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-brand-black/70">
          RaceOps unifies sim racers, drivers, crew, engineers, and sponsors in
          one networking, opportunity, and strategy platform — with a
          sim-to-real credibility pipeline no one else offers.
        </p>
        <div className="mt-10 flex justify-center gap-4">
          <Link href="/sign-up">
            <Button variant="primary" size="lg">
              Build your profile
            </Button>
          </Link>
          <Link href="/opportunities">
            <Button variant="outline" size="lg">
              Browse opportunities
            </Button>
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 pb-24 md:grid-cols-3">
        {PILLARS.map((pillar) => (
          <Card key={pillar.title}>
            <CardHeader>
              <CardTitle>{pillar.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-brand-black/70">{pillar.body}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
