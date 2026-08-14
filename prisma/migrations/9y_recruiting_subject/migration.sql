-- AlterTable
ALTER TABLE "AccessRequest" ADD COLUMN     "subjectOrganizationId" TEXT,
ADD COLUMN     "subjectTeamId" TEXT;

-- CreateIndex
CREATE INDEX "AccessRequest_subjectTeamId_kind_status_idx" ON "AccessRequest"("subjectTeamId", "kind", "status");

-- CreateIndex
CREATE INDEX "AccessRequest_subjectOrganizationId_kind_status_idx" ON "AccessRequest"("subjectOrganizationId", "kind", "status");

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_subjectTeamId_fkey" FOREIGN KEY ("subjectTeamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_subjectOrganizationId_fkey" FOREIGN KEY ("subjectOrganizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A recruiting application is for exactly one body, and nothing else has one.
--
-- The scope is the whole point of this kind. An approval that pointed at
-- neither would be a grant to nobody, and one pointing at both would be
-- ambiguous the moment a team moved between organizations. The other kinds
-- create the thing they are about, so there is nothing to point at yet.
ALTER TABLE "AccessRequest"
  ADD CONSTRAINT "AccessRequest_subject_matches_kind"
  CHECK (
    ("kind" = 'RECRUITING' AND (
      ("subjectTeamId" IS NOT NULL AND "subjectOrganizationId" IS NULL)
      OR ("subjectTeamId" IS NULL AND "subjectOrganizationId" IS NOT NULL)
    ))
    OR ("kind" <> 'RECRUITING'
        AND "subjectTeamId" IS NULL
        AND "subjectOrganizationId" IS NULL)
  );

-- Recruiting permission is a standing grant, never spent.
--
-- The creating kinds burn their approval on the thing they make; this one is
-- ongoing, like SPONSOR. A fulfilled recruiting row would read as used up and
-- silently stop a team being able to advertise.
ALTER TABLE "AccessRequest"
  ADD CONSTRAINT "AccessRequest_recruiting_is_not_spent"
  CHECK ("kind" <> 'RECRUITING' OR "fulfilledEntityId" IS NULL);
