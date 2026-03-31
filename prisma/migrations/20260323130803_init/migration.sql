-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('EMAIL', 'GOOGLE', 'APPLE');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'PRO');

-- CreateEnum
CREATE TYPE "DrinkCategory" AS ENUM ('WINE', 'BEER', 'SPIRITS', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceTier" AS ENUM ('PRODUCER', 'CRITIC', 'AI_SYNTHESISED');

-- CreateEnum
CREATE TYPE "ScanMethod" AS ENUM ('CAMERA', 'BARCODE', 'MANUAL_SEARCH');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('LOBBY', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('COMPETITIVE', 'PARALLEL');

-- CreateEnum
CREATE TYPE "MultiplayerType" AS ENUM ('PASS_THE_PHONE', 'MULTI_DEVICE', 'REMOTE');

-- CreateEnum
CREATE TYPE "OptOutTiming" AS ENUM ('ANY_MOMENT', 'START_OF_ROUND', 'AFTER_RESULTS');

-- CreateEnum
CREATE TYPE "GameEndReason" AS ENUM ('ALL_OPTED_OUT', 'ALL_NOTES_CLAIMED', 'MAX_ROUNDS_REACHED', 'HOST_ENDED', 'HOST_DISCONNECTED');

-- CreateEnum
CREATE TYPE "GamePlayerStatus" AS ENUM ('ACTIVE', 'OPTED_OUT', 'DISCONNECTED', 'FROZEN');

-- CreateEnum
CREATE TYPE "GuessMatchType" AS ENUM ('EXACT', 'GENERIC_MATCH', 'SYNONYM', 'AI_EVALUATED');

-- CreateEnum
CREATE TYPE "ClubApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClubActivityType" AS ENUM ('GAME_SUBMITTED', 'GAME_APPROVED', 'GAME_REJECTED', 'MEMBER_JOINED', 'MEMBER_LEFT', 'MEMBER_REMOVED', 'SEASON_STARTED', 'SEASON_ENDED', 'LEADERBOARD_CHANGE');

-- CreateEnum
CREATE TYPE "ClubRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "SeasonType" AS ENUM ('FIXED_DATE', 'FIXED_LENGTH', 'ROLLING');

-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('ACTIVE', 'ENDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "bio" VARCHAR(160),
    "location" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "ageVerified" BOOLEAN NOT NULL DEFAULT false,
    "ageVerifiedAt" TIMESTAMP(3),
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "authProvider" "AuthProvider" NOT NULL DEFAULT 'EMAIL',
    "socialProviderId" TEXT,
    "subscriptionTier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "subscriptionId" TEXT,
    "stripeCustomerId" TEXT,
    "subscriptionStatus" TEXT,
    "subscriptionPlan" TEXT,
    "subscriptionCurrentPeriodEnd" TIMESTAMP(3),
    "trialUsed" BOOLEAN NOT NULL DEFAULT false,
    "trialStartedAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "trialEligible" BOOLEAN NOT NULL DEFAULT true,
    "monthlyScansUsed" INTEGER NOT NULL DEFAULT 0,
    "scanResetDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "drinkPreferences" "DrinkCategory"[],
    "b2bDataOptIn" BOOLEAN NOT NULL DEFAULT false,
    "notifGameInvites" BOOLEAN NOT NULL DEFAULT true,
    "notifCellarClubActivity" BOOLEAN NOT NULL DEFAULT true,
    "notifSeasonReminders" BOOLEAN NOT NULL DEFAULT true,
    "notifPalateUpdates" BOOLEAN NOT NULL DEFAULT false,
    "notifWeeklyDigests" BOOLEAN NOT NULL DEFAULT false,
    "notifEmail" BOOLEAN NOT NULL DEFAULT true,
    "notifPush" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bottles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "producer" TEXT,
    "vintage" TEXT,
    "region" TEXT,
    "subRegion" TEXT,
    "country" TEXT,
    "category" "DrinkCategory" NOT NULL DEFAULT 'WINE',
    "subcategory" TEXT,
    "varietal" TEXT,
    "barcode" TEXT,
    "imageUrl" TEXT,
    "description" TEXT,
    "abv" DOUBLE PRECISION,
    "volume" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bottles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasting_notes" (
    "id" TEXT NOT NULL,
    "bottleId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "genericNote" TEXT,
    "sourceTier" "SourceTier" NOT NULL DEFAULT 'AI_SYNTHESISED',
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasting_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bottle_scans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bottleId" TEXT,
    "method" "ScanMethod" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "rawResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bottle_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_links" (
    "id" TEXT NOT NULL,
    "bottleId" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'AUD',

    CONSTRAINT "affiliate_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_clicks" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "affiliateLinkId" TEXT NOT NULL,
    "bottleId" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'buy_tab',
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flavour_nodes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isGeneric" BOOLEAN NOT NULL DEFAULT false,
    "drinkTypes" "DrinkCategory"[],
    "aiExtended" BOOLEAN NOT NULL DEFAULT false,
    "approved" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "flavour_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "bottleId" TEXT NOT NULL,
    "gameCode" VARCHAR(6) NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'LOBBY',
    "mode" "GameMode" NOT NULL DEFAULT 'PARALLEL',
    "multiplayerType" "MultiplayerType" NOT NULL DEFAULT 'PASS_THE_PHONE',
    "roundTimerSecs" INTEGER NOT NULL DEFAULT 60,
    "maxRounds" INTEGER NOT NULL DEFAULT 20,
    "optOutTiming" "OptOutTiming" NOT NULL DEFAULT 'START_OF_ROUND',
    "scoreboardVisible" BOOLEAN NOT NULL DEFAULT true,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" "GameEndReason",
    "currentTurnPlayerId" TEXT,
    "currentTurnOrder" INTEGER,
    "roundStartedAt" TIMESTAMP(3),
    "roundSubmissions" INTEGER NOT NULL DEFAULT 0,
    "cellarClubId" TEXT,
    "clubApprovalStatus" "ClubApprovalStatus",
    "createdOffline" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3),
    "shareToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_players" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinOrder" INTEGER NOT NULL DEFAULT 0,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "status" "GamePlayerStatus" NOT NULL DEFAULT 'ACTIVE',
    "optedOutAt" TIMESTAMP(3),
    "socketId" TEXT,
    "lastPingAt" TIMESTAMP(3),

    CONSTRAINT "game_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_players" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "joinOrder" INTEGER NOT NULL DEFAULT 0,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "status" "GamePlayerStatus" NOT NULL DEFAULT 'ACTIVE',
    "optedOutAt" TIMESTAMP(3),

    CONSTRAINT "guest_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guesses" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "gamePlayerId" TEXT NOT NULL,
    "tastingNoteId" TEXT,
    "guessText" TEXT NOT NULL,
    "matchType" "GuessMatchType",
    "isSpecific" BOOLEAN NOT NULL DEFAULT false,
    "points" INTEGER NOT NULL DEFAULT 0,
    "aiEvaluation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_guesses" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "guestPlayerId" TEXT NOT NULL,
    "tastingNoteId" TEXT,
    "guessText" TEXT NOT NULL,
    "matchType" "GuessMatchType",
    "isSpecific" BOOLEAN NOT NULL DEFAULT false,
    "points" INTEGER NOT NULL DEFAULT 0,
    "aiEvaluation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_guesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_sync_queue" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameData" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_sync_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cellar_clubs" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memberCap" INTEGER,
    "inviteCode" VARCHAR(6) NOT NULL,
    "inviteLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "cellar_clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cellar_members" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ClubRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "cellar_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seasons" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "name" TEXT,
    "seasonType" "SeasonType" NOT NULL DEFAULT 'FIXED_DATE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "lengthDays" INTEGER,
    "status" "SeasonStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "awards" JSONB,
    "finalStandings" JSONB,

    CONSTRAINT "seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_activities" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "type" "ClubActivityType" NOT NULL,
    "actorId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "palate_categories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "drinkType" TEXT,
    "totalGuesses" INTEGER NOT NULL DEFAULT 0,
    "correctGuesses" INTEGER NOT NULL DEFAULT 0,
    "accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gamesAppearedIn" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "palate_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "palate_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "overallAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "correctGuesses" INTEGER NOT NULL DEFAULT 0,
    "totalGuesses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "palate_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "pushSent" BOOLEAN NOT NULL DEFAULT false,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'web',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sponsored_tastings" (
    "id" TEXT NOT NULL,
    "bottleId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "badgeText" TEXT NOT NULL DEFAULT 'Sponsored',
    "doublePoints" BOOLEAN NOT NULL DEFAULT true,
    "targetRegions" TEXT[],
    "targetDrinkTypes" TEXT[],
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "gameStarts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsored_tastings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_feed_items" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'trending',
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "imageUrl" TEXT,
    "bottleId" TEXT,
    "linkUrl" TEXT,
    "data" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_feed_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_summaries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "shareableCardUrl" TEXT,
    "deliveredEmail" BOOLEAN NOT NULL DEFAULT false,
    "deliveredPush" BOOLEAN NOT NULL DEFAULT false,
    "deliveredInApp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_subscriptionTier_idx" ON "users"("subscriptionTier");

-- CreateIndex
CREATE INDEX "users_stripeCustomerId_idx" ON "users"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_token_idx" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_token_key" ON "password_resets"("token");

-- CreateIndex
CREATE INDEX "password_resets_token_idx" ON "password_resets"("token");

-- CreateIndex
CREATE INDEX "password_resets_userId_idx" ON "password_resets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "bottles_barcode_key" ON "bottles"("barcode");

-- CreateIndex
CREATE INDEX "bottles_name_idx" ON "bottles"("name");

-- CreateIndex
CREATE INDEX "bottles_barcode_idx" ON "bottles"("barcode");

-- CreateIndex
CREATE INDEX "bottles_category_idx" ON "bottles"("category");

-- CreateIndex
CREATE INDEX "tasting_notes_bottleId_idx" ON "tasting_notes"("bottleId");

-- CreateIndex
CREATE INDEX "tasting_notes_sourceTier_idx" ON "tasting_notes"("sourceTier");

-- CreateIndex
CREATE UNIQUE INDEX "tasting_notes_bottleId_note_key" ON "tasting_notes"("bottleId", "note");

-- CreateIndex
CREATE INDEX "bottle_scans_userId_idx" ON "bottle_scans"("userId");

-- CreateIndex
CREATE INDEX "bottle_scans_bottleId_idx" ON "bottle_scans"("bottleId");

-- CreateIndex
CREATE INDEX "affiliate_links_bottleId_idx" ON "affiliate_links"("bottleId");

-- CreateIndex
CREATE INDEX "affiliate_clicks_userId_idx" ON "affiliate_clicks"("userId");

-- CreateIndex
CREATE INDEX "affiliate_clicks_affiliateLinkId_idx" ON "affiliate_clicks"("affiliateLinkId");

-- CreateIndex
CREATE INDEX "affiliate_clicks_clickedAt_idx" ON "affiliate_clicks"("clickedAt");

-- CreateIndex
CREATE INDEX "flavour_nodes_parentId_idx" ON "flavour_nodes"("parentId");

-- CreateIndex
CREATE INDEX "flavour_nodes_name_idx" ON "flavour_nodes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "flavour_nodes_name_parentId_key" ON "flavour_nodes"("name", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "games_gameCode_key" ON "games"("gameCode");

-- CreateIndex
CREATE UNIQUE INDEX "games_shareToken_key" ON "games"("shareToken");

-- CreateIndex
CREATE INDEX "games_hostId_idx" ON "games"("hostId");

-- CreateIndex
CREATE INDEX "games_bottleId_idx" ON "games"("bottleId");

-- CreateIndex
CREATE INDEX "games_gameCode_idx" ON "games"("gameCode");

-- CreateIndex
CREATE INDEX "games_status_idx" ON "games"("status");

-- CreateIndex
CREATE INDEX "games_shareToken_idx" ON "games"("shareToken");

-- CreateIndex
CREATE INDEX "games_cellarClubId_idx" ON "games"("cellarClubId");

-- CreateIndex
CREATE INDEX "game_players_gameId_idx" ON "game_players"("gameId");

-- CreateIndex
CREATE INDEX "game_players_userId_idx" ON "game_players"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "game_players_gameId_userId_key" ON "game_players"("gameId", "userId");

-- CreateIndex
CREATE INDEX "guest_players_gameId_idx" ON "guest_players"("gameId");

-- CreateIndex
CREATE INDEX "rounds_gameId_idx" ON "rounds"("gameId");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_gameId_number_key" ON "rounds"("gameId", "number");

-- CreateIndex
CREATE INDEX "guesses_roundId_idx" ON "guesses"("roundId");

-- CreateIndex
CREATE INDEX "guesses_gamePlayerId_idx" ON "guesses"("gamePlayerId");

-- CreateIndex
CREATE INDEX "guesses_tastingNoteId_idx" ON "guesses"("tastingNoteId");

-- CreateIndex
CREATE INDEX "guest_guesses_roundId_idx" ON "guest_guesses"("roundId");

-- CreateIndex
CREATE INDEX "guest_guesses_guestPlayerId_idx" ON "guest_guesses"("guestPlayerId");

-- CreateIndex
CREATE INDEX "offline_sync_queue_userId_idx" ON "offline_sync_queue"("userId");

-- CreateIndex
CREATE INDEX "offline_sync_queue_status_idx" ON "offline_sync_queue"("status");

-- CreateIndex
CREATE UNIQUE INDEX "cellar_clubs_inviteCode_key" ON "cellar_clubs"("inviteCode");

-- CreateIndex
CREATE INDEX "cellar_clubs_inviteCode_idx" ON "cellar_clubs"("inviteCode");

-- CreateIndex
CREATE INDEX "cellar_clubs_adminId_idx" ON "cellar_clubs"("adminId");

-- CreateIndex
CREATE INDEX "cellar_members_clubId_idx" ON "cellar_members"("clubId");

-- CreateIndex
CREATE INDEX "cellar_members_userId_idx" ON "cellar_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "cellar_members_clubId_userId_key" ON "cellar_members"("clubId", "userId");

-- CreateIndex
CREATE INDEX "seasons_clubId_idx" ON "seasons"("clubId");

-- CreateIndex
CREATE INDEX "seasons_status_idx" ON "seasons"("status");

-- CreateIndex
CREATE INDEX "club_activities_clubId_createdAt_idx" ON "club_activities"("clubId", "createdAt");

-- CreateIndex
CREATE INDEX "palate_categories_userId_idx" ON "palate_categories"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "palate_categories_userId_category_drinkType_key" ON "palate_categories"("userId", "category", "drinkType");

-- CreateIndex
CREATE INDEX "palate_snapshots_userId_idx" ON "palate_snapshots"("userId");

-- CreateIndex
CREATE INDEX "palate_snapshots_createdAt_idx" ON "palate_snapshots"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "palate_snapshots_userId_gameId_key" ON "palate_snapshots"("userId", "gameId");

-- CreateIndex
CREATE INDEX "notifications_userId_read_idx" ON "notifications"("userId", "read");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "push_tokens_userId_idx" ON "push_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_userId_token_key" ON "push_tokens"("userId", "token");

-- CreateIndex
CREATE INDEX "sponsored_tastings_isActive_startDate_endDate_idx" ON "sponsored_tastings"("isActive", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "sponsored_tastings_bottleId_idx" ON "sponsored_tastings"("bottleId");

-- CreateIndex
CREATE INDEX "discovery_feed_items_isActive_priority_idx" ON "discovery_feed_items"("isActive", "priority");

-- CreateIndex
CREATE INDEX "engagement_summaries_userId_idx" ON "engagement_summaries"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "engagement_summaries_userId_type_periodStart_key" ON "engagement_summaries"("userId", "type", "periodStart");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasting_notes" ADD CONSTRAINT "tasting_notes_bottleId_fkey" FOREIGN KEY ("bottleId") REFERENCES "bottles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bottle_scans" ADD CONSTRAINT "bottle_scans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bottle_scans" ADD CONSTRAINT "bottle_scans_bottleId_fkey" FOREIGN KEY ("bottleId") REFERENCES "bottles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_bottleId_fkey" FOREIGN KEY ("bottleId") REFERENCES "bottles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_affiliateLinkId_fkey" FOREIGN KEY ("affiliateLinkId") REFERENCES "affiliate_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flavour_nodes" ADD CONSTRAINT "flavour_nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "flavour_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_bottleId_fkey" FOREIGN KEY ("bottleId") REFERENCES "bottles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_cellarClubId_fkey" FOREIGN KEY ("cellarClubId") REFERENCES "cellar_clubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_players" ADD CONSTRAINT "guest_players_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_gamePlayerId_fkey" FOREIGN KEY ("gamePlayerId") REFERENCES "game_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guesses" ADD CONSTRAINT "guesses_tastingNoteId_fkey" FOREIGN KEY ("tastingNoteId") REFERENCES "tasting_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_guesses" ADD CONSTRAINT "guest_guesses_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_guesses" ADD CONSTRAINT "guest_guesses_guestPlayerId_fkey" FOREIGN KEY ("guestPlayerId") REFERENCES "guest_players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_guesses" ADD CONSTRAINT "guest_guesses_tastingNoteId_fkey" FOREIGN KEY ("tastingNoteId") REFERENCES "tasting_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cellar_clubs" ADD CONSTRAINT "cellar_clubs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cellar_members" ADD CONSTRAINT "cellar_members_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "cellar_clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cellar_members" ADD CONSTRAINT "cellar_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "cellar_clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_activities" ADD CONSTRAINT "club_activities_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "cellar_clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "palate_categories" ADD CONSTRAINT "palate_categories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "palate_snapshots" ADD CONSTRAINT "palate_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "palate_snapshots" ADD CONSTRAINT "palate_snapshots_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sponsored_tastings" ADD CONSTRAINT "sponsored_tastings_bottleId_fkey" FOREIGN KEY ("bottleId") REFERENCES "bottles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_feed_items" ADD CONSTRAINT "discovery_feed_items_bottleId_fkey" FOREIGN KEY ("bottleId") REFERENCES "bottles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_summaries" ADD CONSTRAINT "engagement_summaries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
