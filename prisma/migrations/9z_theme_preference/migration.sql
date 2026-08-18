-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "theme" "ThemePreference" NOT NULL DEFAULT 'SYSTEM';

