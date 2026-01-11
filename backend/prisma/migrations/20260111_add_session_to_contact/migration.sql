-- Add sessionId to contacts and set up relation
ALTER TABLE "contacts"
ADD COLUMN "sessionId" TEXT;

-- Set sessionId to some default (manual step may be needed for existing data)
-- UPDATE "contacts" SET "sessionId" = '<default-session-id>' WHERE "sessionId" IS NULL;

ALTER TABLE "contacts"
ALTER COLUMN "sessionId" SET NOT NULL;

ALTER TABLE "contacts"
ADD CONSTRAINT "contacts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE;

-- Change unique constraint
DROP INDEX IF EXISTS "contacts_phoneNumber_key";
CREATE UNIQUE INDEX "contacts_phoneNumber_sessionId_key" ON "contacts" ("phoneNumber", "sessionId");
