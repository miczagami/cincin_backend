-- Last AI note-writing attempt per bottle: limits paid synthesis calls to one per day
ALTER TABLE "bottles" ADD COLUMN "notesSynthesisedAt" TIMESTAMP(3);
