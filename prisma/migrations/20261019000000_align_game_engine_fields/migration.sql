-- Align column names with the game engine (gameService / socketServer / scanService)
-- and add the columns it relies on. Renames preserve existing data.

-- bottle_scans
ALTER TABLE "bottle_scans" RENAME COLUMN "method" TO "inputMethod";
ALTER TABLE "bottle_scans" RENAME COLUMN "rawResult" TO "aiResponse";
ALTER TABLE "bottle_scans" ADD COLUMN "rawImageUrl" TEXT;

-- games
ALTER TABLE "games" ADD COLUMN "lobbyExpiresAt" TIMESTAMP(3);

-- game_players
ALTER TABLE "game_players" RENAME COLUMN "joinOrder" TO "playerOrder";
ALTER TABLE "game_players" ADD COLUMN "disconnectedAt" TIMESTAMP(3),
ADD COLUMN "reconnectedAt" TIMESTAMP(3);

-- guest_players
ALTER TABLE "guest_players" RENAME COLUMN "joinOrder" TO "playerOrder";

-- rounds
ALTER TABLE "rounds" RENAME COLUMN "number" TO "roundNumber";
ALTER TABLE "rounds" ADD COLUMN "endedAt" TIMESTAMP(3);
ALTER INDEX "rounds_gameId_number_key" RENAME TO "rounds_gameId_roundNumber_key";

-- guesses
ALTER TABLE "guesses" RENAME COLUMN "matchType" TO "matchedVia";
ALTER TABLE "guesses" RENAME COLUMN "points" TO "pointsAwarded";
ALTER TABLE "guesses" ADD COLUMN "isCorrect" BOOLEAN NOT NULL DEFAULT false;
UPDATE "guesses" SET "isCorrect" = true WHERE "tastingNoteId" IS NOT NULL;

-- guest_guesses
ALTER TABLE "guest_guesses" RENAME COLUMN "matchType" TO "matchedVia";
ALTER TABLE "guest_guesses" RENAME COLUMN "points" TO "pointsAwarded";
ALTER TABLE "guest_guesses" ADD COLUMN "isCorrect" BOOLEAN NOT NULL DEFAULT false;
UPDATE "guest_guesses" SET "isCorrect" = true WHERE "tastingNoteId" IS NOT NULL;

-- offline_sync_queue
ALTER TABLE "offline_sync_queue" RENAME COLUMN "gameData" TO "gamePayload";
