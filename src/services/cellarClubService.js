/**
 * Phase 4: Cellar Club Service
 *
 * Implements Section 5 of the functional requirements:
 * - Club creation & management (5.2)
 * - Membership (5.3)
 * - Game approval workflow (5.4)
 * - Season scoring & leaderboard (5.5)
 * - Season end flow with awards (5.6)
 * - Club activity feed (5.7)
 *
 * Phase 4 updates:
 * - calculateAwards() now includes mostImproved + precisionKing (async)
 * - createNotification() delegates to NotificationService for multi-channel delivery
 * - approveGame() tracks LEADERBOARD_CHANGE activity
 * - checkExpiredSeasons() handles FIXED_LENGTH seasons properly
 *
 * Timeline: Weeks 11–17 (Phase 3 base + Phase 4 stub completions)
 */

const prisma = require("../config/database");
const config = require("../config");
const { generateCode } = require("../utils/helpers");

// ═══════════════════════════════════════════
//  CLUB CREATION & MANAGEMENT (Section 5.2)
// ═══════════════════════════════════════════

/**
 * Create a new Cellar Club.
 * The creator becomes admin. First season is created automatically.
 *
 * @param {string} userId - creator's user ID
 * @param {object} data - { name, memberCap?, seasonType?, seasonStartDate?, seasonEndDate?, seasonLengthDays? }
 */
async function createClub(userId, data) {
  // Check email verification (Section 7.2: required before creating/joining a club)
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });
  if (!user.emailVerified) {
    throw Object.assign(new Error("Email verification required to create a Cellar Club"), { statusCode: 403 });
  }

  // Check club limits: free users can belong to 1 club (Section 5.3)
  if (user.subscriptionTier === "FREE") {
    const existingMemberships = await prisma.cellarMember.count({
      where: { userId, leftAt: null },
    });
    if (existingMemberships >= 1) {
      throw Object.assign(
        new Error("Free users can belong to 1 Cellar Club. Upgrade to Pro for unlimited."),
        { statusCode: 403 }
      );
    }
  }

  const inviteCode = generateCode(); // 6-char alphanumeric

  const club = await prisma.cellarClub.create({
    data: {
      adminId: userId,
      name: data.name,
      memberCap: data.memberCap || null,
      inviteCode,
      inviteLink: `${config.appUrl}/club/join/${inviteCode}`,
      members: {
        create: {
          userId,
          role: "ADMIN",
        },
      },
      seasons: {
        create: {
          name: data.seasonName || "Season 1",
          seasonType: data.seasonType || "FIXED_DATE",
          startDate: data.seasonStartDate ? new Date(data.seasonStartDate) : new Date(),
          endDate: data.seasonEndDate ? new Date(data.seasonEndDate) : null,
          lengthDays: data.seasonLengthDays || null,
          status: "ACTIVE",
        },
      },
      activities: {
        create: {
          type: "SEASON_STARTED",
          actorId: userId,
          data: { seasonName: data.seasonName || "Season 1" },
        },
      },
    },
    include: {
      members: { include: { user: { select: { id: true, displayName: true, avatarUrl: true } } } },
      seasons: true,
    },
  });

  return club;
}

/**
 * Get club details including current season, members, and recent activity.
 */
async function getClub(clubId, userId) {
  const club = await prisma.cellarClub.findUnique({
    where: { id: clubId },
    include: {
      admin: { select: { id: true, displayName: true, avatarUrl: true } },
      members: {
        where: { leftAt: null },
        include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
      },
      seasons: {
        where: { status: "ACTIVE" },
        take: 1,
      },
      games: {
        where: { status: "COMPLETED" },
        orderBy: { endedAt: "desc" },
        take: 10,
        include: {
          bottle: { select: { name: true, producer: true, imageUrl: true } },
          host: { select: { displayName: true } },
        },
      },
    },
  });

  if (!club) throw Object.assign(new Error("Club not found"), { statusCode: 404 });

  // Check membership
  const isMember = club.members.some((m) => m.userId === userId);
  if (!isMember) throw Object.assign(new Error("Not a member of this club"), { statusCode: 403 });

  // Get season leaderboard if active season exists
  let leaderboard = [];
  if (club.seasons.length > 0) {
    leaderboard = await getSeasonLeaderboard(clubId, club.seasons[0].id);
  }

  return {
    ...club,
    leaderboard,
    isAdmin: club.adminId === userId,
    activeSeason: club.seasons[0] || null,
  };
}

/**
 * List clubs the user belongs to.
 */
async function listUserClubs(userId) {
  const memberships = await prisma.cellarMember.findMany({
    where: { userId, leftAt: null },
    include: {
      club: {
        include: {
          admin: { select: { displayName: true } },
          members: { where: { leftAt: null }, select: { id: true } },
          seasons: { where: { status: "ACTIVE" }, take: 1 },
        },
      },
    },
  });

  return memberships.map((m) => ({
    clubId: m.club.id,
    name: m.club.name,
    role: m.role,
    adminName: m.club.admin.displayName,
    memberCount: m.club.members.length,
    hasActiveSeason: m.club.seasons.length > 0,
    joinedAt: m.joinedAt,
    archivedAt: m.club.archivedAt,
  }));
}

/**
 * Update club settings (admin only).
 */
async function updateClub(clubId, userId, data) {
  await requireAdmin(clubId, userId);

  const club = await prisma.cellarClub.update({
    where: { id: clubId },
    data: {
      name: data.name,
      memberCap: data.memberCap !== undefined ? data.memberCap : undefined,
    },
  });

  return club;
}

/**
 * Archive a club (admin only). Makes it read-only.
 */
async function archiveClub(clubId, userId) {
  await requireAdmin(clubId, userId);

  // End any active season
  await prisma.season.updateMany({
    where: { clubId, status: "ACTIVE" },
    data: { status: "ARCHIVED" },
  });

  const club = await prisma.cellarClub.update({
    where: { id: clubId },
    data: { archivedAt: new Date() },
  });

  await createActivity(clubId, "SEASON_ENDED", userId, { reason: "club_archived" });

  return club;
}

// ═══════════════════════════════════════════
//  MEMBERSHIP (Section 5.3)
// ═══════════════════════════════════════════

/**
 * Join a club via invite code or invite link.
 */
async function joinClub(userId, inviteCode) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

  // Email verification required (Section 7.2)
  if (!user.emailVerified) {
    throw Object.assign(new Error("Email verification required to join a Cellar Club"), { statusCode: 403 });
  }

  // Free tier: max 1 club
  if (user.subscriptionTier === "FREE") {
    const existingMemberships = await prisma.cellarMember.count({
      where: { userId, leftAt: null },
    });
    if (existingMemberships >= 1) {
      throw Object.assign(
        new Error("Free users can belong to 1 Cellar Club. Upgrade to Pro for unlimited."),
        { statusCode: 403 }
      );
    }
  }

  const club = await prisma.cellarClub.findUnique({
    where: { inviteCode },
    include: { members: { where: { leftAt: null } } },
  });

  if (!club) throw Object.assign(new Error("Invalid invite code"), { statusCode: 404 });
  if (club.archivedAt) throw Object.assign(new Error("This club has been archived"), { statusCode: 410 });

  // Check member cap
  if (club.memberCap && club.members.length >= club.memberCap) {
    throw Object.assign(new Error("Club is full"), { statusCode: 409 });
  }

  // Check if already a member (might have left and rejoining)
  const existingMember = await prisma.cellarMember.findUnique({
    where: { clubId_userId: { clubId: club.id, userId } },
  });

  let member;
  if (existingMember && existingMember.leftAt) {
    // Rejoin — reactivate membership
    member = await prisma.cellarMember.update({
      where: { id: existingMember.id },
      data: { leftAt: null, joinedAt: new Date() },
    });
  } else if (existingMember) {
    throw Object.assign(new Error("Already a member of this club"), { statusCode: 409 });
  } else {
    member = await prisma.cellarMember.create({
      data: { clubId: club.id, userId, role: "MEMBER" },
    });
  }

  await createActivity(club.id, "MEMBER_JOINED", userId, {
    displayName: user.displayName,
  });

  // Notify admin
  await createNotification(club.adminId, {
    type: "club_member_joined",
    title: "New member joined",
    body: `${user.displayName} joined ${club.name}`,
    data: { clubId: club.id },
  });

  return { clubId: club.id, clubName: club.name, member };
}

/**
 * Leave a club voluntarily (Section 5.3).
 * Historical scores remain on leaderboard.
 */
async function leaveClub(clubId, userId) {
  const member = await prisma.cellarMember.findUnique({
    where: { clubId_userId: { clubId, userId } },
  });

  if (!member || member.leftAt) {
    throw Object.assign(new Error("Not a member of this club"), { statusCode: 404 });
  }

  if (member.role === "ADMIN") {
    throw Object.assign(
      new Error("Club admin cannot leave. Transfer admin role or archive the club."),
      { statusCode: 409 }
    );
  }

  await prisma.cellarMember.update({
    where: { id: member.id },
    data: { leftAt: new Date() },
  });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  await createActivity(clubId, "MEMBER_LEFT", userId, { displayName: user.displayName });

  return { left: true };
}

/**
 * Admin removes a member from the club.
 */
async function removeMember(clubId, adminUserId, targetUserId) {
  await requireAdmin(clubId, adminUserId);

  if (adminUserId === targetUserId) {
    throw Object.assign(new Error("Cannot remove yourself"), { statusCode: 409 });
  }

  const member = await prisma.cellarMember.findUnique({
    where: { clubId_userId: { clubId, userId: targetUserId } },
  });

  if (!member || member.leftAt) {
    throw Object.assign(new Error("User is not an active member"), { statusCode: 404 });
  }

  await prisma.cellarMember.update({
    where: { id: member.id },
    data: { leftAt: new Date() },
  });

  const user = await prisma.user.findUnique({ where: { id: targetUserId }, select: { displayName: true } });
  await createActivity(clubId, "MEMBER_REMOVED", adminUserId, {
    displayName: user.displayName,
    targetUserId,
  });

  // Notify removed member
  await createNotification(targetUserId, {
    type: "club_removed",
    title: "Removed from club",
    body: "You have been removed from the club.",
    data: { clubId },
  });

  return { removed: true };
}

// ═══════════════════════════════════════════
//  GAME APPROVAL (Section 5.4)
// ═══════════════════════════════════════════

/**
 * Tag a game to a Cellar Club (sets approval status to PENDING).
 * Called when a completed game is submitted for approval.
 */
async function tagGameToClub(gameId, userId, clubId) {
  // Verify membership
  const member = await prisma.cellarMember.findUnique({
    where: { clubId_userId: { clubId, userId } },
  });
  if (!member || member.leftAt) {
    throw Object.assign(new Error("Not a member of this club"), { statusCode: 403 });
  }

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game) throw Object.assign(new Error("Game not found"), { statusCode: 404 });
  if (game.status !== "COMPLETED") {
    throw Object.assign(new Error("Only completed games can be tagged"), { statusCode: 400 });
  }
  if (game.cellarClubId) {
    throw Object.assign(new Error("Game already tagged to a club"), { statusCode: 409 });
  }

  // Check active season
  const activeSeason = await prisma.season.findFirst({
    where: { clubId, status: "ACTIVE" },
  });
  if (!activeSeason) {
    throw Object.assign(new Error("Club has no active season"), { statusCode: 400 });
  }

  const updatedGame = await prisma.game.update({
    where: { id: gameId },
    data: {
      cellarClubId: clubId,
      clubApprovalStatus: "PENDING",
    },
  });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  const bottle = await prisma.bottle.findUnique({ where: { id: game.bottleId }, select: { name: true } });

  await createActivity(clubId, "GAME_SUBMITTED", userId, {
    gameId,
    bottleName: bottle?.name,
    displayName: user.displayName,
  });

  // Notify admin (Section 5.4)
  const club = await prisma.cellarClub.findUnique({ where: { id: clubId } });
  await createNotification(club.adminId, {
    type: "club_game_submitted",
    title: "Game submitted for approval",
    body: `${user.displayName} submitted a ${bottle?.name || "game"} for ${club.name}`,
    data: { clubId, gameId },
  });

  return updatedGame;
}

/**
 * Admin approves a game — its scores count toward the season leaderboard.
 *
 * Phase 4: Now snapshots the leaderboard before/after approval to detect
 * and record LEADERBOARD_CHANGE activities for ±2 position shifts.
 */
async function approveGame(clubId, gameId, adminUserId) {
  await requireAdmin(clubId, adminUserId);

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      bottle: { select: { name: true } },
      host: { select: { displayName: true } },
    },
  });

  if (!game || game.cellarClubId !== clubId) {
    throw Object.assign(new Error("Game not found in this club"), { statusCode: 404 });
  }

  if (game.clubApprovalStatus !== "PENDING") {
    throw Object.assign(new Error("Game is not pending approval"), { statusCode: 400 });
  }

  // Phase 4: Snapshot leaderboard BEFORE approval for comparison
  const activeSeason = await prisma.season.findFirst({
    where: { clubId, status: "ACTIVE" },
  });

  let leaderboardBefore = [];
  if (activeSeason) {
    leaderboardBefore = await getSeasonLeaderboard(clubId, activeSeason.id);
  }

  // Approve the game
  await prisma.game.update({
    where: { id: gameId },
    data: { clubApprovalStatus: "APPROVED" },
  });

  await createActivity(clubId, "GAME_APPROVED", adminUserId, {
    gameId,
    bottleName: game.bottle?.name,
    hostName: game.host?.displayName,
  });

  // Phase 4: Compare leaderboard AFTER approval to detect position changes
  if (activeSeason) {
    const leaderboardAfter = await getSeasonLeaderboard(clubId, activeSeason.id);
    await trackLeaderboardChanges(clubId, leaderboardBefore, leaderboardAfter, adminUserId);
  }

  // Notify game participants
  const gamePlayers = await prisma.gamePlayer.findMany({
    where: { gameId },
    select: { userId: true },
  });

  for (const player of gamePlayers) {
    await createNotification(player.userId, {
      type: "club_game_approved",
      title: "Game approved!",
      body: `Your game (${game.bottle?.name || "Unknown"}) has been approved for the season.`,
      data: { clubId, gameId },
    });
  }

  return { status: "APPROVED", gameId };
}

/**
 * Admin rejects a game — it doesn't affect standings.
 */
async function rejectGame(clubId, gameId, adminUserId) {
  await requireAdmin(clubId, adminUserId);

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game || game.cellarClubId !== clubId) {
    throw Object.assign(new Error("Game not found in this club"), { statusCode: 404 });
  }
  if (game.clubApprovalStatus !== "PENDING") {
    throw Object.assign(new Error("Game is not pending approval"), { statusCode: 400 });
  }

  await prisma.game.update({
    where: { id: gameId },
    data: { clubApprovalStatus: "REJECTED" },
  });

  await createActivity(clubId, "GAME_REJECTED", adminUserId, { gameId });

  return { status: "REJECTED", gameId };
}

/**
 * Get list of games awaiting approval (admin only).
 */
async function getPendingGames(clubId, adminUserId) {
  await requireAdmin(clubId, adminUserId);

  const games = await prisma.game.findMany({
    where: {
      cellarClubId: clubId,
      clubApprovalStatus: "PENDING",
    },
    include: {
      bottle: { select: { name: true, producer: true, imageUrl: true } },
      host: { select: { displayName: true } },
      players: { include: { user: { select: { displayName: true } } } },
      guestPlayers: { select: { displayName: true } },
    },
    orderBy: { endedAt: "desc" },
  });

  return games;
}

// ═══════════════════════════════════════════
//  SEASON LEADERBOARD (Section 5.5)
// ═══════════════════════════════════════════

/**
 * Calculate the cumulative season leaderboard.
 * Sum of scores across all APPROVED games for the active season.
 */
async function getSeasonLeaderboard(clubId, seasonId) {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) throw Object.assign(new Error("Season not found"), { statusCode: 404 });

  // Get all approved games for this club within the season date range
  const approvedGames = await prisma.game.findMany({
    where: {
      cellarClubId: clubId,
      clubApprovalStatus: "APPROVED",
      status: "COMPLETED",
      endedAt: {
        gte: season.startDate,
        ...(season.endDate ? { lte: season.endDate } : {}),
      },
    },
    include: {
      players: {
        include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
      },
      guestPlayers: true,
    },
  });

  // Aggregate scores per registered player
  const playerScores = new Map();

  for (const game of approvedGames) {
    for (const player of game.players) {
      const existing = playerScores.get(player.userId) || {
        userId: player.userId,
        displayName: player.user.displayName,
        avatarUrl: player.user.avatarUrl,
        totalScore: 0,
        gamesPlayed: 0,
        averageScore: 0,
      };
      existing.totalScore += player.totalScore;
      existing.gamesPlayed += 1;
      existing.averageScore = Math.round((existing.totalScore / existing.gamesPlayed) * 10) / 10;
      playerScores.set(player.userId, existing);
    }
    // Note: guest players don't persist across games, so they don't appear on season leaderboards
  }

  // Sort by total score (descending), then by average score as tiebreaker
  const leaderboard = Array.from(playerScores.values())
    .sort((a, b) => b.totalScore - a.totalScore || b.averageScore - a.averageScore)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  return leaderboard;
}

// ═══════════════════════════════════════════
//  SEASON END (Section 5.6)
// ═══════════════════════════════════════════

/**
 * End a season and calculate awards/superlatives.
 * Can be triggered automatically (date reached) or manually by admin (rolling).
 *
 * Phase 4: calculateAwards() is now async (fetches game data for mostImproved/precisionKing).
 */
async function endSeason(clubId, seasonId, adminUserId) {
  await requireAdmin(clubId, adminUserId);

  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season || season.status !== "ACTIVE") {
    throw Object.assign(new Error("Season not found or already ended"), { statusCode: 400 });
  }

  const leaderboard = await getSeasonLeaderboard(clubId, seasonId);
  const awards = await calculateAwards(clubId, seasonId, leaderboard); // Phase 4: now async

  await prisma.season.update({
    where: { id: seasonId },
    data: {
      status: "ENDED",
      endDate: new Date(),
      finalStandings: leaderboard,
      awards,
    },
  });

  await createActivity(clubId, "SEASON_ENDED", adminUserId, {
    seasonId,
    seasonName: season.name,
    winner: leaderboard[0]?.displayName || null,
  });

  // Notify all club members
  const members = await prisma.cellarMember.findMany({
    where: { clubId, leftAt: null },
    select: { userId: true },
  });

  for (const m of members) {
    await createNotification(m.userId, {
      type: "season_ended",
      title: `${season.name || "Season"} has ended!`,
      body: leaderboard[0]
        ? `${leaderboard[0].displayName} wins with ${leaderboard[0].totalScore} points!`
        : "The season has ended.",
      data: { clubId, seasonId },
    });
  }

  return { season: { ...season, status: "ENDED" }, leaderboard, awards };
}

/**
 * Calculate season awards/superlatives (Section 5.6).
 *
 * Phase 4: Now async. Includes all 5 awards:
 *   - Champion (highest total score)
 *   - Sharpest Palate (highest average per game)
 *   - Iron Stomach (played every game)
 *   - Most Improved (score progression: 2nd-half avg − 1st-half avg)
 *   - Precision King (most specific variant bonuses across approved games)
 */
async function calculateAwards(clubId, seasonId, leaderboard) {
  if (leaderboard.length === 0) return {};

  const awards = {};

  // Champion — highest total score
  if (leaderboard[0]) {
    awards.champion = {
      userId: leaderboard[0].userId,
      displayName: leaderboard[0].displayName,
      value: leaderboard[0].totalScore,
    };
  }

  // Sharpest Palate — highest average per game
  const byAverage = [...leaderboard].sort((a, b) => b.averageScore - a.averageScore);
  if (byAverage[0]) {
    awards.sharpestPalate = {
      userId: byAverage[0].userId,
      displayName: byAverage[0].displayName,
      value: byAverage[0].averageScore,
    };
  }

  // Iron Stomach — played every game
  const maxGames = Math.max(...leaderboard.map((p) => p.gamesPlayed));
  const everyGamePlayers = leaderboard.filter((p) => p.gamesPlayed === maxGames);
  if (everyGamePlayers.length > 0) {
    awards.ironStomach = {
      userId: everyGamePlayers[0].userId,
      displayName: everyGamePlayers[0].displayName,
      value: maxGames,
    };
  }

  // ── Phase 4: Most Improved ──
  // Compares first-half vs second-half average scores across season games
  try {
    const season = await prisma.season.findUnique({ where: { id: seasonId } });
    const approvedGames = await prisma.game.findMany({
      where: {
        cellarClubId: clubId,
        clubApprovalStatus: "APPROVED",
        status: "COMPLETED",
        endedAt: {
          gte: season.startDate,
          ...(season.endDate ? { lte: season.endDate } : {}),
        },
      },
      orderBy: { endedAt: "asc" },
      include: {
        players: { select: { userId: true, totalScore: true } },
      },
    });

    if (approvedGames.length >= 4) {
      const midpoint = Math.floor(approvedGames.length / 2);
      const firstHalf = approvedGames.slice(0, midpoint);
      const secondHalf = approvedGames.slice(midpoint);

      let bestImprovement = -Infinity;
      let mostImprovedPlayer = null;

      for (const entry of leaderboard) {
        const firstHalfScores = firstHalf
          .flatMap((g) => g.players)
          .filter((p) => p.userId === entry.userId);
        const secondHalfScores = secondHalf
          .flatMap((g) => g.players)
          .filter((p) => p.userId === entry.userId);

        if (firstHalfScores.length === 0 || secondHalfScores.length === 0) continue;

        const firstAvg =
          firstHalfScores.reduce((sum, p) => sum + p.totalScore, 0) / firstHalfScores.length;
        const secondAvg =
          secondHalfScores.reduce((sum, p) => sum + p.totalScore, 0) / secondHalfScores.length;
        const improvement = secondAvg - firstAvg;

        if (improvement > bestImprovement) {
          bestImprovement = improvement;
          mostImprovedPlayer = entry;
        }
      }

      if (mostImprovedPlayer && bestImprovement > 0) {
        awards.mostImproved = {
          userId: mostImprovedPlayer.userId,
          displayName: mostImprovedPlayer.displayName,
          value: Math.round(bestImprovement * 10) / 10,
          label: `+${Math.round(bestImprovement * 10) / 10} pts avg improvement`,
        };
      }
    }
  } catch (err) {
    console.error("[CellarClub] Most Improved calculation failed:", err.message);
    // Non-fatal — award just won't be included
  }

  // ── Phase 4: Precision King ──
  // Player with the most specific variant bonuses (isSpecific=true correct guesses)
  try {
    const season = await prisma.season.findUnique({ where: { id: seasonId } });
    const specificGuessAgg = await prisma.guess.groupBy({
      by: ["gamePlayerId"],
      where: {
        isSpecific: true,
        points: { gt: 0 },
        round: {
          game: {
            cellarClubId: clubId,
            clubApprovalStatus: "APPROVED",
            status: "COMPLETED",
            endedAt: {
              gte: season.startDate,
              ...(season.endDate ? { lte: season.endDate } : {}),
            },
          },
        },
      },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 20,
    });

    if (specificGuessAgg.length > 0) {
      // Sum across all gamePlayer records for the same user
      const userSpecificCounts = new Map();

      for (const agg of specificGuessAgg) {
        const gp = await prisma.gamePlayer.findUnique({
          where: { id: agg.gamePlayerId },
          select: { userId: true, user: { select: { displayName: true } } },
        });
        if (!gp) continue;

        const existing = userSpecificCounts.get(gp.userId) || {
          userId: gp.userId,
          displayName: gp.user.displayName,
          count: 0,
        };
        existing.count += agg._count.id;
        userSpecificCounts.set(gp.userId, existing);
      }

      const sorted = Array.from(userSpecificCounts.values()).sort(
        (a, b) => b.count - a.count
      );

      if (sorted[0] && sorted[0].count > 0) {
        awards.precisionKing = {
          userId: sorted[0].userId,
          displayName: sorted[0].displayName,
          value: sorted[0].count,
          label: `${sorted[0].count} specific variant bonuses`,
        };
      }
    }
  } catch (err) {
    console.error("[CellarClub] Precision King calculation failed:", err.message);
  }

  return awards;
}

/**
 * Start a new season (after previous one ended).
 */
async function startNewSeason(clubId, adminUserId, data) {
  await requireAdmin(clubId, adminUserId);

  // Ensure no active season
  const activeSeason = await prisma.season.findFirst({
    where: { clubId, status: "ACTIVE" },
  });
  if (activeSeason) {
    throw Object.assign(new Error("Active season exists. End it before starting a new one."), { statusCode: 409 });
  }

  // Count existing seasons for naming
  const seasonCount = await prisma.season.count({ where: { clubId } });

  const season = await prisma.season.create({
    data: {
      clubId,
      name: data.name || `Season ${seasonCount + 1}`,
      seasonType: data.seasonType || "FIXED_DATE",
      startDate: data.startDate ? new Date(data.startDate) : new Date(),
      endDate: data.endDate ? new Date(data.endDate) : null,
      lengthDays: data.lengthDays || null,
      status: "ACTIVE",
    },
  });

  await createActivity(clubId, "SEASON_STARTED", adminUserId, {
    seasonId: season.id,
    seasonName: season.name,
  });

  return season;
}

/**
 * Get season history for a club.
 */
async function getSeasonHistory(clubId, userId) {
  // Verify membership
  const member = await prisma.cellarMember.findFirst({
    where: { clubId, userId, leftAt: null },
  });
  if (!member) throw Object.assign(new Error("Not a member"), { statusCode: 403 });

  const seasons = await prisma.season.findMany({
    where: { clubId },
    orderBy: { startDate: "desc" },
  });

  return seasons.map((s) => ({
    id: s.id,
    name: s.name,
    seasonType: s.seasonType,
    startDate: s.startDate,
    endDate: s.endDate,
    status: s.status,
    awards: s.awards,
    finalStandings: s.finalStandings,
  }));
}

// ═══════════════════════════════════════════
//  CLUB ACTIVITY FEED (Section 5.7)
// ═══════════════════════════════════════════

/**
 * Get the activity feed for a club.
 */
async function getActivityFeed(clubId, userId, { limit = 20, offset = 0 } = {}) {
  // Verify membership
  const member = await prisma.cellarMember.findFirst({
    where: { clubId, userId, leftAt: null },
  });
  if (!member) throw Object.assign(new Error("Not a member"), { statusCode: 403 });

  const activities = await prisma.clubActivity.findMany({
    where: { clubId },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });

  const total = await prisma.clubActivity.count({ where: { clubId } });

  return { activities, total, limit, offset };
}

// ═══════════════════════════════════════════
//  LEADERBOARD CHANGE TRACKING (Phase 4)
// ═══════════════════════════════════════════

/**
 * Phase 4: Track significant leaderboard position changes after game approval.
 * Records LEADERBOARD_CHANGE activity for players who moved ±2 or more positions.
 */
async function trackLeaderboardChanges(clubId, before, after, actorId) {
  const positionsBefore = new Map(before.map((p) => [p.userId, p.rank]));
  const SIGNIFICANT_CHANGE = 2; // positions moved to trigger activity

  for (const player of after) {
    const previousRank = positionsBefore.get(player.userId);
    if (previousRank === undefined) {
      // New entry on leaderboard
      await createActivity(clubId, "LEADERBOARD_CHANGE", actorId, {
        userId: player.userId,
        displayName: player.displayName,
        newRank: player.rank,
        previousRank: null,
        change: "new_entry",
      });
    } else {
      const change = previousRank - player.rank; // positive = moved up
      if (Math.abs(change) >= SIGNIFICANT_CHANGE) {
        await createActivity(clubId, "LEADERBOARD_CHANGE", actorId, {
          userId: player.userId,
          displayName: player.displayName,
          newRank: player.rank,
          previousRank,
          change: change > 0 ? "moved_up" : "moved_down",
          positions: Math.abs(change),
        });
      }
    }
  }
}

// ═══════════════════════════════════════════
//  CRON: EXPIRED SEASONS (Phase 4)
// ═══════════════════════════════════════════

/**
 * Check and auto-end seasons that have reached their end date.
 * Called hourly by the cron scheduler (cronScheduler.js).
 *
 * Phase 4: Now properly handles FIXED_LENGTH seasons by computing
 * endDate from startDate + lengthDays.
 */
async function checkExpiredSeasons() {
  const now = new Date();

  // FIXED_DATE seasons: endDate has passed
  const expiredFixedDate = await prisma.season.findMany({
    where: {
      status: "ACTIVE",
      seasonType: "FIXED_DATE",
      endDate: { lte: now },
    },
    include: { club: true },
  });

  // FIXED_LENGTH seasons: startDate + lengthDays has passed
  const fixedLengthSeasons = await prisma.season.findMany({
    where: {
      status: "ACTIVE",
      seasonType: "FIXED_LENGTH",
      lengthDays: { not: null },
    },
    include: { club: true },
  });

  const expiredFixedLength = fixedLengthSeasons.filter((season) => {
    const endDate = new Date(season.startDate);
    endDate.setDate(endDate.getDate() + season.lengthDays);
    return endDate <= now;
  });

  // Note: ROLLING seasons are never auto-ended — admin triggers manually
  const allExpired = [...expiredFixedDate, ...expiredFixedLength];

  for (const season of allExpired) {
    try {
      await endSeason(season.clubId, season.id, season.club.adminId);
      console.log(`[CellarClub] Auto-ended season ${season.id} for club ${season.clubId}`);
    } catch (err) {
      console.error(`[CellarClub] Failed to auto-end season ${season.id}:`, err.message);
    }
  }

  return allExpired.length;
}

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════

/**
 * Verify the user is the club admin.
 */
async function requireAdmin(clubId, userId) {
  const club = await prisma.cellarClub.findUnique({ where: { id: clubId } });
  if (!club) throw Object.assign(new Error("Club not found"), { statusCode: 404 });
  if (club.adminId !== userId) {
    throw Object.assign(new Error("Only the club admin can perform this action"), { statusCode: 403 });
  }
  return club;
}

/**
 * Create a club activity entry.
 */
async function createActivity(clubId, type, actorId, data = {}) {
  return prisma.clubActivity.create({
    data: { clubId, type, actorId, data },
  }).catch((err) => {
    console.error("[CellarClub] Activity creation failed:", err.message);
  });
}

/**
 * Create a notification with multi-channel delivery.
 * Phase 4: Delegates to NotificationService for push + email + in-app.
 * Falls back to in-app-only if NotificationService is unavailable.
 */
async function createNotification(userId, { type, title, body, data }) {
  try {
    const notificationService = require("./notificationService");
    return await notificationService.createNotification(userId, {
      type,
      title,
      body,
      data,
    });
  } catch (err) {
    // Fallback: create in-app notification only (same as Phase 3 behavior)
    console.error("[CellarClub] NotificationService unavailable, falling back to in-app:", err.message);
    return prisma.notification.create({
      data: { userId, type, title, body, data },
    }).catch((fallbackErr) => {
      console.error("[CellarClub] Notification fallback failed:", fallbackErr.message);
    });
  }
}

// ═══════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════

module.exports = {
  // Club CRUD
  createClub,
  getClub,
  listUserClubs,
  updateClub,
  archiveClub,
  // Membership
  joinClub,
  leaveClub,
  removeMember,
  // Game approval
  tagGameToClub,
  approveGame,
  rejectGame,
  getPendingGames,
  // Seasons
  getSeasonLeaderboard,
  endSeason,
  startNewSeason,
  getSeasonHistory,
  // Activity
  getActivityFeed,
  // Cron
  checkExpiredSeasons,
};
