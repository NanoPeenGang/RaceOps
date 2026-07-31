-- CreateEnum
CREATE TYPE "AccessZone" AS ENUM ('PADDOCK', 'GARAGE', 'PIT_LANE', 'GRID', 'TRACKSIDE', 'RACE_CONTROL', 'MEDIA_CENTRE', 'SCRUTINEERING', 'HOSPITALITY');

-- CreateEnum
CREATE TYPE "CredentialAudience" AS ENUM ('DRIVER', 'ENTRANT', 'VOLUNTEER', 'ORGANIZER');

-- AlterTable
ALTER TABLE "Credential" ADD COLUMN     "qrToken" TEXT;

-- AlterTable
ALTER TABLE "CredentialType" ADD COLUMN     "autoIssueTo" "CredentialAudience",
ADD COLUMN     "zones" "AccessZone"[];

-- CreateIndex
CREATE UNIQUE INDEX "Credential_qrToken_key" ON "Credential"("qrToken");

