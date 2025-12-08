-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "variants" TEXT[] DEFAULT ARRAY[]::TEXT[];
