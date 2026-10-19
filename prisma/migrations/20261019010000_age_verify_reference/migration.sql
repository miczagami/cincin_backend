-- Link provider age-verification results back to users via a stored reference
ALTER TABLE "users" ADD COLUMN "ageVerifyRef" TEXT,
ADD COLUMN "ageVerifyRegion" TEXT;

CREATE UNIQUE INDEX "users_ageVerifyRef_key" ON "users"("ageVerifyRef");
