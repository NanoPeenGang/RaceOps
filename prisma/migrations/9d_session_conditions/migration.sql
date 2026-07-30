-- CreateEnum
CREATE TYPE "TrackState" AS ENUM ('DRY', 'DAMP', 'WET', 'STANDING_WATER', 'SNOW_ICE');

-- CreateEnum
CREATE TYPE "WeatherKind" AS ENUM ('CLEAR', 'CLOUDY', 'OVERCAST', 'LIGHT_RAIN', 'HEAVY_RAIN', 'FOG', 'SNOW', 'WINDY');

-- CreateTable
CREATE TABLE "SessionCondition" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" TEXT,
    "trackState" "TrackState" NOT NULL,
    "weather" "WeatherKind",
    "airTempC" DOUBLE PRECISION,
    "trackTempC" DOUBLE PRECISION,
    "humidityPct" INTEGER,
    "windKph" DOUBLE PRECISION,
    "windDirection" TEXT,
    "notes" TEXT,

    CONSTRAINT "SessionCondition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionCondition_sessionId_recordedAt_idx" ON "SessionCondition"("sessionId", "recordedAt");

-- AddForeignKey
ALTER TABLE "SessionCondition" ADD CONSTRAINT "SessionCondition_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "EventSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCondition" ADD CONSTRAINT "SessionCondition_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Invariants Prisma cannot express.

-- Percentages are percentages, and negative wind is a keying slip. Temperature
-- is deliberately unbounded below: winter club events run below zero.
ALTER TABLE "SessionCondition"
ADD CONSTRAINT "SessionCondition_humidity_range"
CHECK ("humidityPct" IS NULL OR ("humidityPct" >= 0 AND "humidityPct" <= 100));

ALTER TABLE "SessionCondition"
ADD CONSTRAINT "SessionCondition_wind_non_negative"
CHECK ("windKph" IS NULL OR "windKph" >= 0);
