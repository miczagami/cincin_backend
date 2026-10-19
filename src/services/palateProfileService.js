const prisma = require("../config/database");
const config = require("../config");
const { AppError } = require("../utils/helpers");

// ═══════════════════════════════════════════════════════════════
//  PALATE PROFILE SERVICE — Phase 4
//  Timeline ref: Weeks 14–15
//  Spec ref: Sections 6.1–6.6
//
//  Provides the full analytics dashboard API:
//    - Accuracy by flavour category
//    - Strengths (top 5) and weaknesses (bottom 5)
//    - Accuracy by drink type (wine, beer, spirits)
//    - Trend-over-time chart data (per-game accuracy snapshots)
//    - All-time and recent-form (last 10 games) views
//    - Palate Wrapped shareable card data
//    - Confidence indicators for thin data
// ═══════════════════════════════════════════════════════════════

const MIN_GAMES_FOR_PROFILE = 3; // Section 6.2: 3 games required
const MIN_GAMES_FOR_RANKING = 3; // Section 6.3.2: 3 games for top/bottom lists
const TOP_N = 5;                 // top 5 strengths, bottom 5 weaknesses
const RECENT_FORM_GAMES = 10;   // Section 6.4: last 10 games
const LOW_CONFIDENCE_THRESHOLD = 5; // Section 6.5: below 5 games = low confidence

/**
 * Get the full Palate Profile dashboard for a user.
 * Pro-only (Section 6.2). Requires 3+ games.
 *
 * @param {string} userId
 * @param {object} options - { view: 'all_time' | 'recent' }
 * @returns {object} Full profile data
 */
async function getProfile(userId, { view = "all_time" } = {}) {
  // Check Pro subscription (Section 6.2)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true, displayName: true, avatarUrl: true },
  });

  if (!user) throw new AppError("User not found", 404);

  if (user.subscriptionTier !== "PRO") {
    throw new AppError(
      "Palate Profile is a Pro feature. Upgrade to access your tasting analytics.",
      403
    );
  }

  // Count total games played
  const totalGamesPlayed = await prisma.gamePlayer.count({
    where: { userId, game: { status: "COMPLETED" } },
  });

  if (totalGamesPlayed < MIN_GAMES_FOR_PROFILE) {
    return {
      status: "locked",
      gamesPlayed: totalGamesPlayed,
      gamesRequired: MIN_GAMES_FOR_PROFILE,
      message: `Play ${MIN_GAMES_FOR_PROFILE - totalGamesPlayed} more game(s) to unlock your Palate Profile.`,
    };
  }

  // Build profile based on view mode
  const isRecent = view === "recent";

  const [
    categoryAccuracy,
    drinkTypeAccuracy,
    trendData,
    overallStats,
  ] = await Promise.all([
    getCategoryAccuracy(userId, isRecent),
    getDrinkTypeAccuracy(userId, isRecent),
    getTrendOverTime(userId),
    getOverallStats(userId, isRecent),
  ]);

  // Strengths & weaknesses (Section 6.3.2)
  const qualified = categoryAccuracy.filter(
    (c) => c.gamesAppearedIn >= MIN_GAMES_FOR_RANKING
  );
  const strengths = qualified
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, TOP_N);
  const weaknesses = qualified
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, TOP_N);

  return {
    status: "active",
    view,
    user: {
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
    },
    overall: overallStats,
    categoryAccuracy,
    strengths,
    weaknesses,
    drinkTypeAccuracy,
    trend: trendData,
    gamesPlayed: totalGamesPlayed,
  };
}

/**
 * Get accuracy by flavour category (Section 6.3.1).
 * Each category includes a confidence indicator.
 */
async function getCategoryAccuracy(userId, recentOnly = false) {
  if (recentOnly) {
    return getRecentCategoryAccuracy(userId);
  }

  // All-time from materialised PalateCategory records
  const categories = await prisma.palateCategory.findMany({
    where: { userId, drinkType: null }, // null drinkType = aggregated across all types
    orderBy: { accuracy: "desc" },
  });

  return categories.map((c) => ({
    category: c.category,
    accuracy: Math.round(c.accuracy * 10) / 10,
    totalGuesses: c.totalGuesses,
    correctGuesses: c.correctGuesses,
    gamesAppearedIn: c.gamesAppearedIn,
    confidence: c.gamesAppearedIn >= LOW_CONFIDENCE_THRESHOLD ? "high" : "low",
  }));
}

/**
 * Calculate recent-form category accuracy from last N games.
 */
async function getRecentCategoryAccuracy(userId) {
  const recentGames = await prisma.gamePlayer.findMany({
    where: { userId, game: { status: "COMPLETED" } },
    orderBy: { game: { endedAt: "desc" } },
    take: RECENT_FORM_GAMES,
    select: { id: true, gameId: true },
  });

  if (recentGames.length === 0) return [];

  const gamePlayerIds = recentGames.map((g) => g.id);

  // Get all guesses from these games with their tasting note categories
  const guesses = await prisma.guess.findMany({
    where: {
      gamePlayerId: { in: gamePlayerIds },
      guessText: { not: "[auto-skip]" },
    },
    include: {
      tastingNote: { select: { genericNote: true, note: true } },
      round: { select: { gameId: true } },
    },
  });

  return aggregateGuessesByCategory(guesses, recentGames);
}

/**
 * Aggregate guesses into per-category accuracy stats.
 */
function aggregateGuessesByCategory(guesses, games) {
  const categoryMap = new Map();
  const categoryGames = new Map(); // track unique games per category

  for (const guess of guesses) {
    const category = guess.tastingNote?.genericNote
      || guess.tastingNote?.note
      || null;

    if (!category) {
      // Wrong guess — try to infer category from guess text
      // (In production, would do taxonomy lookup; here we skip unmatched)
      continue;
    }

    const existing = categoryMap.get(category) || { total: 0, correct: 0, games: new Set() };
    existing.total += 1;
    existing.correct += guess.pointsAwarded > 0 ? 1 : 0;
    existing.games.add(guess.round.gameId);
    categoryMap.set(category, existing);
  }

  return Array.from(categoryMap.entries())
    .map(([category, stats]) => ({
      category,
      accuracy:
        stats.total > 0
          ? Math.round((stats.correct / stats.total) * 1000) / 10
          : 0,
      totalGuesses: stats.total,
      correctGuesses: stats.correct,
      gamesAppearedIn: stats.games.size,
      confidence:
        stats.games.size >= LOW_CONFIDENCE_THRESHOLD ? "high" : "low",
    }))
    .sort((a, b) => b.accuracy - a.accuracy);
}

/**
 * Accuracy by drink type (Section 6.3.3).
 */
async function getDrinkTypeAccuracy(userId, recentOnly = false) {
  if (recentOnly) {
    return getRecentDrinkTypeAccuracy(userId);
  }

  // All-time: query PalateCategory grouped by drinkType
  const stats = await prisma.palateCategory.groupBy({
    by: ["drinkType"],
    where: { userId, drinkType: { not: null } },
    _sum: { totalGuesses: true, correctGuesses: true },
    _count: true,
  });

  return stats
    .filter((s) => s.drinkType)
    .map((s) => ({
      drinkType: s.drinkType,
      accuracy:
        s._sum.totalGuesses > 0
          ? Math.round(
              (s._sum.correctGuesses / s._sum.totalGuesses) * 1000
            ) / 10
          : 0,
      totalGuesses: s._sum.totalGuesses,
      correctGuesses: s._sum.correctGuesses,
    }));
}

/**
 * Recent-form drink type accuracy from last N games.
 */
async function getRecentDrinkTypeAccuracy(userId) {
  const recentGames = await prisma.gamePlayer.findMany({
    where: { userId, game: { status: "COMPLETED" } },
    orderBy: { game: { endedAt: "desc" } },
    take: RECENT_FORM_GAMES,
    include: {
      game: { select: { bottle: { select: { category: true } } } },
      guesses: {
        where: { guessText: { not: "[auto-skip]" } },
        select: { pointsAwarded: true },
      },
    },
  });

  const drinkMap = new Map();

  for (const gp of recentGames) {
    const drinkType = gp.game.bottle.category;
    const existing = drinkMap.get(drinkType) || { total: 0, correct: 0 };
    for (const guess of gp.guesses) {
      existing.total += 1;
      existing.correct += guess.pointsAwarded > 0 ? 1 : 0;
    }
    drinkMap.set(drinkType, existing);
  }

  return Array.from(drinkMap.entries()).map(([drinkType, stats]) => ({
    drinkType,
    accuracy:
      stats.total > 0
        ? Math.round((stats.correct / stats.total) * 1000) / 10
        : 0,
    totalGuesses: stats.total,
    correctGuesses: stats.correct,
  }));
}

/**
 * Trend over time — per-game accuracy snapshots (Section 6.3.4).
 * Returns data points for the line chart.
 */
async function getTrendOverTime(userId) {
  const snapshots = await prisma.palateSnapshot.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      overallAccuracy: true,
      correctGuesses: true,
      totalGuesses: true,
      createdAt: true,
      gameId: true,
    },
  });

  return snapshots.map((s, index) => ({
    gameNumber: index + 1,
    accuracy: Math.round(s.overallAccuracy * 10) / 10,
    correctGuesses: s.correctGuesses,
    totalGuesses: s.totalGuesses,
    date: s.createdAt,
  }));
}

/**
 * Overall stats summary.
 */
async function getOverallStats(userId, recentOnly = false) {
  const whereClause = { userId, game: { status: "COMPLETED" } };

  let gamePlayers;
  if (recentOnly) {
    gamePlayers = await prisma.gamePlayer.findMany({
      where: whereClause,
      orderBy: { game: { endedAt: "desc" } },
      take: RECENT_FORM_GAMES,
      include: {
        guesses: { where: { guessText: { not: "[auto-skip]" } } },
      },
    });
  } else {
    gamePlayers = await prisma.gamePlayer.findMany({
      where: whereClause,
      include: {
        guesses: { where: { guessText: { not: "[auto-skip]" } } },
      },
    });
  }

  let totalGuesses = 0;
  let correctGuesses = 0;
  let totalScore = 0;

  for (const gp of gamePlayers) {
    totalScore += gp.totalScore;
    for (const guess of gp.guesses) {
      totalGuesses += 1;
      if (guess.pointsAwarded > 0) correctGuesses += 1;
    }
  }

  return {
    gamesPlayed: gamePlayers.length,
    totalGuesses,
    correctGuesses,
    overallAccuracy:
      totalGuesses > 0
        ? Math.round((correctGuesses / totalGuesses) * 1000) / 10
        : 0,
    totalScore,
    averageScore:
      gamePlayers.length > 0
        ? Math.round((totalScore / gamePlayers.length) * 10) / 10
        : 0,
  };
}

/**
 * Get progress towards unlocking the Palate Profile.
 * Visible to all users (free and Pro) as a conversion incentive (Section 6.2).
 */
async function getProgress(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true },
  });

  const gamesPlayed = await prisma.gamePlayer.count({
    where: { userId, game: { status: "COMPLETED" } },
  });

  return {
    gamesPlayed,
    gamesRequired: MIN_GAMES_FOR_PROFILE,
    isUnlocked: gamesPlayed >= MIN_GAMES_FOR_PROFILE,
    requiresPro: user?.subscriptionTier !== "PRO",
    progress: Math.min(1, gamesPlayed / MIN_GAMES_FOR_PROFILE),
  };
}

/**
 * Generate Palate Wrapped card data (Section 6.6).
 * Returns the data needed to render the shareable card.
 * Actual image generation is handled separately (S3 upload).
 */
async function generateWrappedCard(userId, { month, year } = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { subscriptionTier: true, displayName: true, avatarUrl: true },
  });

  if (!user) throw new AppError("User not found", 404);
  if (user.subscriptionTier !== "PRO") {
    throw new AppError("Palate Wrapped is a Pro feature.", 403);
  }

  // Determine period
  const now = new Date();
  const targetMonth = month !== undefined ? month : now.getMonth();
  const targetYear = year !== undefined ? year : now.getFullYear();

  const periodStart = new Date(targetYear, targetMonth, 1);
  const periodEnd = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59);

  // Get games within the period
  const gamePlayers = await prisma.gamePlayer.findMany({
    where: {
      userId,
      game: {
        status: "COMPLETED",
        endedAt: { gte: periodStart, lte: periodEnd },
      },
    },
    include: {
      game: { select: { bottle: { select: { category: true } } } },
      guesses: {
        where: { guessText: { not: "[auto-skip]" } },
        include: { tastingNote: { select: { genericNote: true, note: true } } },
      },
    },
  });

  if (gamePlayers.length === 0) {
    throw new AppError("No games played in this period.", 400);
  }

  // Calculate wrapped stats
  let totalGuesses = 0;
  let correctGuesses = 0;
  const categoryHits = new Map();
  const categoryMisses = new Map();
  const drinkTypeCounts = new Map();

  for (const gp of gamePlayers) {
    const drinkType = gp.game.bottle.category;
    drinkTypeCounts.set(drinkType, (drinkTypeCounts.get(drinkType) || 0) + 1);

    for (const guess of gp.guesses) {
      totalGuesses += 1;
      const category = guess.tastingNote?.genericNote || guess.tastingNote?.note;

      if (guess.pointsAwarded > 0) {
        correctGuesses += 1;
        if (category) {
          categoryHits.set(category, (categoryHits.get(category) || 0) + 1);
        }
      } else {
        if (category) {
          categoryMisses.set(category, (categoryMisses.get(category) || 0) + 1);
        }
      }
    }
  }

  // Top flavour hit
  const topHit = Array.from(categoryHits.entries())
    .sort((a, b) => b[1] - a[1])[0];

  // Biggest miss
  const topMiss = Array.from(categoryMisses.entries())
    .sort((a, b) => b[1] - a[1])[0];

  // Most scanned drink type
  const topDrinkType = Array.from(drinkTypeCounts.entries())
    .sort((a, b) => b[1] - a[1])[0];

  // Improvement trend: compare first half vs second half of month's games
  const midpoint = Math.floor(gamePlayers.length / 2);
  const firstHalf = gamePlayers.slice(0, midpoint);
  const secondHalf = gamePlayers.slice(midpoint);

  const firstHalfAcc = calculateAccuracy(firstHalf);
  const secondHalfAcc = calculateAccuracy(secondHalf);
  const improvementTrend = secondHalfAcc - firstHalfAcc;

  const wrappedData = {
    periodLabel: periodStart.toLocaleDateString("en-AU", {
      month: "long",
      year: "numeric",
    }),
    periodStart,
    periodEnd,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    gamesPlayed: gamePlayers.length,
    overallAccuracy:
      totalGuesses > 0
        ? Math.round((correctGuesses / totalGuesses) * 1000) / 10
        : 0,
    topFlavourHit: topHit ? { category: topHit[0], count: topHit[1] } : null,
    biggestMiss: topMiss ? { category: topMiss[0], count: topMiss[1] } : null,
    mostScannedDrinkType: topDrinkType
      ? { type: topDrinkType[0], count: topDrinkType[1] }
      : null,
    improvementTrend: Math.round(improvementTrend * 10) / 10,
  };

  // Store as engagement summary
  await prisma.engagementSummary.upsert({
    where: {
      userId_type_periodStart: {
        userId,
        type: "monthly_palate_wrapped",
        periodStart,
      },
    },
    update: { data: wrappedData, periodEnd },
    create: {
      userId,
      type: "monthly_palate_wrapped",
      periodStart,
      periodEnd,
      data: wrappedData,
    },
  });

  return wrappedData;
}

/**
 * Record a completed game in a player's palate profile:
 * per-category stats (aggregate row + per-drink-type row) and the
 * per-game accuracy snapshot used by the trend chart.
 * Called once per registered player from gameService.endGame().
 *
 * @param {string} userId
 * @param {string} gameId
 * @param {{ drinkType: string|null, guesses: { category: string, isCorrect: boolean }[] }} results
 */
async function recordGameResults(userId, gameId, { drinkType, guesses }) {
  if (guesses.length === 0) return; // opted out / skipped every turn — nothing to learn

  const byCategory = new Map();
  for (const { category, isCorrect } of guesses) {
    const counts = byCategory.get(category) || { total: 0, correct: 0 };
    counts.total += 1;
    if (isCorrect) counts.correct += 1;
    byCategory.set(category, counts);
  }

  for (const [category, counts] of byCategory) {
    await addCategoryStats(userId, category, null, counts);
    if (drinkType) await addCategoryStats(userId, category, drinkType, counts);
  }

  const correct = guesses.filter((g) => g.isCorrect).length;
  await recordGameSnapshot(userId, gameId, { correct, total: guesses.length });
}

/**
 * Record a per-game accuracy snapshot (percent) after game completion.
 */
async function recordGameSnapshot(userId, gameId, { correct, total }) {
  const accuracy = total > 0 ? (correct / total) * 100 : 0;

  await prisma.palateSnapshot.upsert({
    where: { userId_gameId: { userId, gameId } },
    update: { overallAccuracy: accuracy, correctGuesses: correct, totalGuesses: total },
    create: {
      userId,
      gameId,
      overallAccuracy: accuracy,
      correctGuesses: correct,
      totalGuesses: total,
    },
  });
}

/**
 * Internal: add one game's guesses to a palate category row.
 * drinkType null = the aggregate row across all drink types (what getCategoryAccuracy reads).
 * Accuracy is stored as a percentage.
 */
async function addCategoryStats(userId, category, drinkType, { total, correct }) {
  // findFirst rather than findUnique: the compound unique key can't express a NULL drinkType
  const existing = await prisma.palateCategory.findFirst({
    where: { userId, category, drinkType },
  });

  const totalGuesses = (existing?.totalGuesses || 0) + total;
  const correctGuesses = (existing?.correctGuesses || 0) + correct;
  const data = {
    totalGuesses,
    correctGuesses,
    accuracy: (correctGuesses / totalGuesses) * 100,
    gamesAppearedIn: (existing?.gamesAppearedIn || 0) + 1,
    lastUpdated: new Date(),
  };

  if (existing) {
    await prisma.palateCategory.update({ where: { id: existing.id }, data });
  } else {
    await prisma.palateCategory.create({ data: { userId, category, drinkType, ...data } });
  }
}

// ─── Helpers ───

function calculateAccuracy(gamePlayers) {
  let total = 0;
  let correct = 0;
  for (const gp of gamePlayers) {
    for (const guess of gp.guesses || []) {
      total += 1;
      if (guess.pointsAwarded > 0) correct += 1;
    }
  }
  return total > 0 ? (correct / total) * 100 : 0;
}

module.exports = {
  getProfile,
  getProgress,
  generateWrappedCard,
  recordGameResults,
};
